use codex_protocol::config_types::{ReasoningEffort, ReasoningSummary};
use codex_protocol::protocol::{
    ApplyPatchApprovalRequestEvent,
    AskForApproval,
    Event,
    EventMsg,
    ExecApprovalRequestEvent,
    ExecCommandBeginEvent,
    ExecCommandEndEvent,
    ExecCommandOutputDeltaEvent,
    ExecOutputStream,
    FileChange,
    InputItem,
    Op,
    ReviewDecision,
    SandboxPolicy,
    Submission,
    TokenCountEvent,
    TokenUsage,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

struct PermissionContext {
    submission_id: String,
    kind: PermissionKind,
}

enum PermissionKind {
    Exec,
    Patch,
}

#[derive(Default)]
struct ReasoningEntry {
    buffer: String,
    sequence: u32,
}

#[derive(Clone)]
struct SharedState {
    session_model: Arc<Mutex<Option<String>>>,
    reasoning_buffers: Arc<Mutex<HashMap<String, ReasoningEntry>>>,
    pending_permissions: Arc<Mutex<HashMap<String, PermissionContext>>>,
    pending_edits: Arc<Mutex<HashMap<String, Vec<String>>>>,
}

#[derive(Deserialize, Default)]
struct CodexOptionsPayload {
    #[serde(rename = "showReasoning")]
    show_reasoning: Option<bool>,
}

#[derive(Deserialize)]
struct SendPayload {
    #[serde(rename = "currentMessage")]
    current_message: String,
    #[serde(default)]
    codex_options: Option<CodexOptionsPayload>,
    #[serde(default)]
    images: Vec<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    effort: Option<String>,
    #[serde(rename = "approvalPolicy")]
    #[serde(default)]
    approval_policy: Option<String>,
    #[serde(rename = "sandboxMode")]
    #[serde(default)]
    sandbox_mode: Option<String>,
}

/// Bridge for communicating with the Codex CLI (proto mode).
pub struct CodexBridge {
    process: Option<Child>,
    stdin: Option<ChildStdin>,
    app_handle: AppHandle,
    project_dir: PathBuf,
    shared: SharedState,
    stdout_thread: Option<thread::JoinHandle<()>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
}

impl CodexBridge {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            process: None,
            stdin: None,
            app_handle,
            project_dir: PathBuf::new(),
            shared: SharedState {
                session_model: Arc::new(Mutex::new(None)),
                reasoning_buffers: Arc::new(Mutex::new(HashMap::new())),
                pending_permissions: Arc::new(Mutex::new(HashMap::new())),
                pending_edits: Arc::new(Mutex::new(HashMap::new())),
            },
            stdout_thread: None,
            stderr_thread: None,
        }
    }

    pub fn start(&mut self, project_dir: &str) -> Result<(), String> {
        self.stop()?;
        self.project_dir = PathBuf::from(project_dir);
        {
            let mut model = self.shared.session_model.lock().unwrap();
            *model = None;
        }
        self.shared.reasoning_buffers.lock().unwrap().clear();
        self.shared.pending_permissions.lock().unwrap().clear();
        self.shared.pending_edits.lock().unwrap().clear();

        let (mut child, child_stdin) = self.spawn_codex_process()?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex stdout not available".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Codex stderr not available".to_string())?;

        let shared = self.shared.clone();
        let app = self.app_handle.clone();
        let project_path = self.project_dir.clone();
        let stdout_handle = thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(raw) => {
                        if let Err(err) = handle_proto_line(&raw, &app, &shared, &project_path) {
                            eprintln!("[CodexBridge] Failed to process line: {}", err);
                        }
                    }
                    Err(err) => {
                        eprintln!("[CodexBridge] Stdout read error: {}", err);
                        break;
                    }
                }
            }
        });

        let err_app = self.app_handle.clone();
        let stderr_handle = thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(l) = line {
                    eprintln!("[CodexBridge stderr]: {}", l);
                    let event = json!({
                        "type": "stderr",
                        "message": l,
                        "ts": timestamp_ms(),
                    });
                    let _ = err_app.emit("codex:error", event);
                }
            }
        });

        self.stdin = child_stdin;
        self.process = Some(child);
        self.stdout_thread = Some(stdout_handle);
        self.stderr_thread = Some(stderr_handle);
        Ok(())
    }

    pub fn send_message(&mut self, input: &str) -> Result<(), String> {
        if self.project_dir.as_os_str().is_empty() {
            return Err("Project directory not set. Call start_codex first.".into());
        }

        let payload = match serde_json::from_str::<SendPayload>(input) {
            Ok(p) => p,
            Err(_) => SendPayload {
                current_message: input.to_string(),
                codex_options: None,
                images: Vec::new(),
                model: None,
                effort: None,
                approval_policy: None,
                sandbox_mode: None,
            },
        };

        let submission_id = Uuid::new_v4().to_string();
        let summary_pref = payload
            .codex_options
            .as_ref()
            .and_then(|opts| opts.show_reasoning)
            .map(|flag| if flag { ReasoningSummary::Auto } else { ReasoningSummary::None })
            .unwrap_or(ReasoningSummary::Auto);

        let mut items: Vec<InputItem> = Vec::new();
        items.push(InputItem::Text {
            text: payload.current_message.clone(),
        });
        for image in payload.images {
            items.push(InputItem::LocalImage {
                path: PathBuf::from(image),
            });
        }

        let model = if let Some(model_override) = payload.model.clone() {
            let mut guard = self.shared.session_model.lock().unwrap();
            *guard = Some(model_override.clone());
            model_override
        } else {
            let guard = self.shared.session_model.lock().unwrap();
            guard.clone().unwrap_or_else(|| "gpt-5.1-mini".to_string())
        };

        let approval_policy = payload
            .approval_policy
            .as_deref()
            .and_then(|value| match value {
                "on-request" => Some(AskForApproval::OnRequest),
                "on-failure" => Some(AskForApproval::OnFailure),
                "never" => Some(AskForApproval::Never),
                "unless-trusted" => Some(AskForApproval::UnlessTrusted),
                _ => None,
            })
            .unwrap_or(AskForApproval::OnRequest);

        let sandbox_policy = match payload.sandbox_mode.as_deref() {
            Some("danger-full-access") => SandboxPolicy::DangerFullAccess,
            Some("read-only") => SandboxPolicy::ReadOnly,
            _ => SandboxPolicy::WorkspaceWrite {
                writable_roots: vec![self.project_dir.clone()],
                network_access: true,
                exclude_tmpdir_env_var: false,
                exclude_slash_tmp: false,
            },
        };

        let effort = payload
            .effort
            .as_deref()
            .and_then(|level| match level {
                "minimal" => Some(ReasoningEffort::Minimal),
                "low" => Some(ReasoningEffort::Low),
                "medium" => Some(ReasoningEffort::Medium),
                "high" => Some(ReasoningEffort::High),
                _ => None,
            });

        let submission = Submission {
            id: submission_id.clone(),
            op: Op::UserTurn {
                items,
                cwd: self.project_dir.clone(),
                approval_policy,
                sandbox_policy,
                model,
                effort,
                summary: summary_pref,
            },
        };

        self.shared
            .reasoning_buffers
            .lock()
            .unwrap()
            .insert(submission_id.clone(), ReasoningEntry::default());
        self.write_submission(submission)
    }

    pub fn resolve_permission(
        &mut self,
        request_id: &str,
        allow: bool,
        scope: &str,
    ) -> Result<(), String> {
        let context = self
            .shared
            .pending_permissions
            .lock()
            .unwrap()
            .remove(request_id)
            .ok_or_else(|| format!("Unknown permission id: {}", request_id))?;

        let decision = if allow {
            match scope {
                "session" | "project" => ReviewDecision::ApprovedForSession,
                _ => ReviewDecision::Approved,
            }
        } else {
            ReviewDecision::Denied
        };

        let submission = match context.kind {
            PermissionKind::Exec => Submission {
                id: format!("approval-{}", Uuid::new_v4()),
                op: Op::ExecApproval {
                    id: context.submission_id,
                    decision,
                },
            },
            PermissionKind::Patch => Submission {
                id: format!("patch-{}", Uuid::new_v4()),
                op: Op::PatchApproval {
                    id: context.submission_id,
                    decision,
                },
            },
        };

        self.write_submission(submission)
    }

    pub fn interrupt(&mut self) -> Result<(), String> {
        if self.stdin.is_none() {
            return Err("Codex process not running".into());
        }

        let submission = Submission {
            id: Uuid::new_v4().to_string(),
            op: Op::Interrupt,
        };

        self.write_submission(submission)
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.stdin = None;
        if let Some(handle) = self.stdout_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }
        Ok(())
    }

    fn spawn_codex_process(&self) -> Result<(Child, Option<ChildStdin>), String> {
        let mut primary = Command::new("codex");
        primary
            .arg("proto")
            .current_dir(&self.project_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match primary.spawn() {
            Ok(mut child) => {
                let stdin = child.stdin.take();
                return Ok((child, stdin));
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                eprintln!("[CodexBridge] codex binary not found in PATH, falling back to node runner");
            }
            Err(err) => return Err(format!("Failed to spawn codex: {}", err)),
        }

        let script_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../vendors/codex/codex-cli/bin/codex.js");
        if !script_path.exists() {
            return Err(format!("Codex CLI script not found at {:?}", script_path));
        }

        let mut node_cmd = Command::new("node");
        node_cmd
            .arg(script_path)
            .arg("proto")
            .current_dir(&self.project_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = node_cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn node codex: {}", e))?;
        let stdin = child.stdin.take();
        Ok((child, stdin))
    }

    fn write_submission(&mut self, submission: Submission) -> Result<(), String> {
        let payload = serde_json::to_string(&submission)
            .map_err(|e| format!("Failed to serialize submission: {}", e))?;
        if let Some(stdin) = self.stdin.as_mut() {
            stdin
                .write_all(payload.as_bytes())
                .map_err(|e| format!("Failed to write to codex stdin: {}", e))?;
            stdin
                .write_all(b"\n")
                .map_err(|e| format!("Failed to flush codex stdin: {}", e))?;
        } else {
            return Err("Codex stdin unavailable".into());
        }
        Ok(())
    }
}

fn handle_proto_line(
    line: &str,
    app: &AppHandle,
    shared: &SharedState,
    project_dir: &Path,
) -> Result<(), String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let event: Event = match serde_json::from_str(trimmed) {
        Ok(ev) => ev,
        Err(err) => {
            eprintln!("[CodexBridge] Non-JSON proto line: {}", trimmed);
            return Err(err.to_string());
        }
    };

    let submission_id = event.id.clone();

    match event.msg {
        EventMsg::SessionConfigured(cfg) => {
            {
                let mut model = shared.session_model.lock().unwrap();
                *model = Some(cfg.model.clone());
            }
            let payload = json!({
                "type": "model:update",
                "model": cfg.model,
                "ts": timestamp_ms(),
            });
            let _ = app.emit("codex:stream", payload);
        }
        EventMsg::AgentMessageDelta(delta) => {
            let payload = json!({
                "type": "assistant:delta",
                "chunk": delta.delta,
                "id": submission_id,
                "ts": timestamp_ms(),
            });
            let _ = app.emit("codex:stream", payload);
        }
        EventMsg::AgentMessage(msg) => {
            let payload = json!({
                "type": "assistant:complete",
                "text": msg.message,
                "id": submission_id,
                "ts": timestamp_ms(),
            });
            let _ = app.emit("codex:stream", payload);
        }
        EventMsg::AgentReasoningDelta(delta) => {
            emit_reasoning_chunk(app, shared, &submission_id, &delta.delta, false);
        }
        EventMsg::AgentReasoningRawContentDelta(delta) => {
            emit_reasoning_chunk(app, shared, &submission_id, &delta.delta, false);
        }
        EventMsg::AgentReasoning(reason) => {
            emit_reasoning_chunk(app, shared, &submission_id, &reason.text, true);
        }
        EventMsg::AgentReasoningRawContent(reason) => {
            emit_reasoning_chunk(app, shared, &submission_id, &reason.text, true);
        }
        EventMsg::AgentReasoningSectionBreak(_) => {
            emit_reasoning_chunk(app, shared, &submission_id, "\n\n", false);
        }
        EventMsg::ExecCommandBegin(begin) => {
            emit_exec_begin(app, &submission_id, &begin);
        }
        EventMsg::ExecCommandOutputDelta(delta) => {
            emit_exec_output(app, delta);
        }
        EventMsg::ExecCommandEnd(end) => {
            emit_exec_end(app, end);
        }
        EventMsg::ExecApprovalRequest(req) => {
            emit_exec_permission(app, shared, project_dir, &submission_id, &req);
        }
        EventMsg::ApplyPatchApprovalRequest(req) => {
            emit_patch_permission(app, shared, project_dir, &submission_id, &req);
        }
        EventMsg::PatchApplyEnd(end) => {
            handle_patch_apply_end(app, shared, end);
        }
        EventMsg::TokenCount(data) => {
            emit_token_stats(app, data);
        }
        EventMsg::Error(err) => {
            let payload = json!({
                "type": "assistant:complete",
                "text": format!("⚠️ {}", err.message),
                "id": submission_id,
                "ts": timestamp_ms(),
            });
            let _ = app.emit("codex:stream", payload);
        }
        EventMsg::TaskComplete(task) => {
            if let Some(last) = task.last_agent_message {
                let payload = json!({
                    "type": "assistant:complete",
                    "text": last,
                    "id": submission_id,
                    "ts": timestamp_ms(),
                });
                let _ = app.emit("codex:stream", payload);
            }
        }
        other => {
            let payload = json!({
                "type": "raw",
                "payload": json!({
                    "id": submission_id,
                    "event": other,
                }),
                "ts": timestamp_ms(),
            });
            let _ = app.emit("codex:stream", payload);
        }
    }

    Ok(())
}

fn emit_reasoning_chunk(app: &AppHandle, shared: &SharedState, id: &str, chunk: &str, done: bool) {
    let (sequence, full_text) = {
        let mut buffers = shared.reasoning_buffers.lock().unwrap();
        let entry = buffers.entry(id.to_string()).or_default();
        entry.sequence += 1;
        entry.buffer.push_str(chunk);
        let seq = entry.sequence;
        let snapshot = entry.buffer.clone();
        if done {
            buffers.remove(id);
        }
        (seq, snapshot)
    };

    let payload = json!({
        "type": "thinking",
        "id": format!("{}::{}", id, sequence),
        "parentId": id,
        "sequence": sequence,
        "text": chunk,
        "fullText": full_text,
        "done": done,
        "ts": timestamp_ms(),
    });
    let _ = app.emit("codex:stream", payload);
}

fn emit_exec_begin(app: &AppHandle, submission_id: &str, begin: &ExecCommandBeginEvent) {
    let command = shlex::try_join(begin.command.iter().map(|s| s.as_str()))
        .unwrap_or_else(|_| begin.command.join(" "));
    let cwd = begin.cwd.to_string_lossy().to_string();
    let payload = json!({
        "type": "tool:start",
        "id": begin.call_id,
        "tool": "bash",
        "args": {
            "command": command,
            "cwd": cwd,
            "submissionId": submission_id,
        },
        "ts": timestamp_ms(),
    });
    let _ = app.emit("codex:stream", payload);
}

fn emit_exec_output(app: &AppHandle, delta: ExecCommandOutputDeltaEvent) {
    let chunk = String::from_utf8_lossy(&delta.chunk).to_string();
    let stream = match delta.stream {
        ExecOutputStream::Stdout => "stdout",
        ExecOutputStream::Stderr => "stderr",
    };
    let payload = json!({
        "type": "tool:output",
        "id": delta.call_id,
        "chunk": chunk,
        "stream": stream,
        "ts": timestamp_ms(),
    });
    let _ = app.emit("codex:stream", payload);
}

fn emit_exec_end(app: &AppHandle, end: ExecCommandEndEvent) {
    let mut chunk = if !end.formatted_output.is_empty() {
        end.formatted_output
    } else if !end.aggregated_output.is_empty() {
        end.aggregated_output
    } else if !end.stdout.is_empty() {
        end.stdout
    } else {
        end.stderr
    };
    if chunk.is_empty() {
        chunk = format!("Command exited with code {}", end.exit_code);
    }
    let payload = json!({
        "type": "tool:output",
        "id": end.call_id,
        "chunk": chunk,
        "done": true,
        "exitCode": end.exit_code,
        "ts": timestamp_ms(),
    });
    let _ = app.emit("codex:stream", payload);
}

fn emit_exec_permission(
    app: &AppHandle,
    shared: &SharedState,
    project_dir: &Path,
    submission_id: &str,
    req: &ExecApprovalRequestEvent,
) {
    let permission_id = format!("exec:{}:{}", submission_id, req.call_id);
    shared
        .pending_permissions
        .lock()
        .unwrap()
        .insert(
            permission_id.clone(),
            PermissionContext {
                submission_id: submission_id.to_string(),
                kind: PermissionKind::Exec,
            },
        );

    let command = shlex::try_join(req.command.iter().map(|s| s.as_str()))
        .unwrap_or_else(|_| req.command.join(" "));
    let payload = json!({
        "type": "permission:request",
        "id": permission_id,
        "tools": ["bash"],
        "scope": "session",
        "ts": timestamp_ms(),
        "details": {
            "command": command,
            "cwd": format_path(&req.cwd, project_dir),
            "reason": req.reason.clone(),
        }
    });
    let _ = app.emit("codex:stream", payload);
}

fn emit_patch_permission(
    app: &AppHandle,
    shared: &SharedState,
    project_dir: &Path,
    submission_id: &str,
    req: &ApplyPatchApprovalRequestEvent,
) {
    let permission_id = format!("patch:{}:{}", submission_id, req.call_id);
    shared
        .pending_permissions
        .lock()
        .unwrap()
        .insert(
            permission_id.clone(),
            PermissionContext {
                submission_id: submission_id.to_string(),
                kind: PermissionKind::Patch,
            },
        );

    let mut edit_ids = Vec::new();
    for (path, change) in &req.changes {
        let file = format_path(path, project_dir);
        let (before, after) = match change {
            FileChange::Add { content } => (String::new(), content.clone()),
            FileChange::Delete { content } => (content.clone(), String::new()),
            FileChange::Update { unified_diff, .. } => (String::new(), unified_diff.clone()),
        };
        let edit_id = format!("edit-{}", Uuid::new_v4());
        edit_ids.push(edit_id.clone());
        let payload = json!({
            "type": "edit:proposed",
            "id": edit_id,
            "file": file,
            "before": before,
            "after": after,
            "ts": timestamp_ms(),
        });
        let _ = app.emit("codex:stream", payload);
    }
    shared
        .pending_edits
        .lock()
        .unwrap()
        .insert(req.call_id.clone(), edit_ids);

    let affected: Vec<String> = req
        .changes
        .keys()
        .map(|p| format_path(p, project_dir))
        .collect();

    let payload = json!({
        "type": "permission:request",
        "id": permission_id,
        "tools": ["write"],
        "scope": "session",
        "ts": timestamp_ms(),
        "details": {
            "files": affected,
            "reason": req.reason.clone(),
            "grantRoot": req
                .grant_root
                .as_ref()
                .map(|p| format_path(p, project_dir)),
        }
    });
    let _ = app.emit("codex:stream", payload);
}

fn handle_patch_apply_end(
    app: &AppHandle,
    shared: &SharedState,
    end: codex_protocol::protocol::PatchApplyEndEvent,
) {
    let ids = shared
        .pending_edits
        .lock()
        .unwrap()
        .remove(&end.call_id)
        .unwrap_or_default();
    for edit_id in ids {
        let event_type = if end.success { "edit:applied" } else { "edit:rejected" };
        let payload = json!({
            "type": event_type,
            "id": edit_id,
            "ts": timestamp_ms(),
        });
        let _ = app.emit("codex:stream", payload);
    }
}

fn emit_token_stats(app: &AppHandle, data: TokenCountEvent) {
    if let Some(info) = data.info {
        let last_usage = info.last_token_usage.clone();
        let tokens_in = last_usage.input_tokens + last_usage.cached_input_tokens;
        let tokens_out = last_usage.output_tokens + last_usage.reasoning_output_tokens;

        let context_window = info.model_context_window;
        let (effective_window, used_tokens, remaining_tokens, used_pct, remaining_pct) =
            context_window
                .map(|window| compute_context_usage(&last_usage, window))
                .unwrap_or((None, None, None, None, None));

        let payload = json!({
            "type": "telemetry:tokens",
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "tokenUsage": {
                "input": last_usage.input_tokens,
                "cachedInput": last_usage.cached_input_tokens,
                "output": last_usage.output_tokens,
                "reasoning": last_usage.reasoning_output_tokens,
                "total": last_usage.total_tokens,
            },
            "contextWindow": context_window,
            "contextEffective": effective_window,
            "contextUsedTokens": used_tokens,
            "contextRemainingTokens": remaining_tokens,
            "contextUsedPct": used_pct,
            "contextRemainingPct": remaining_pct,
            "ts": timestamp_ms(),
        });
        let _ = app.emit("codex:stream", payload);
    }
}

fn compute_context_usage(
    usage: &TokenUsage,
    context_window: u64,
) -> (Option<u64>, Option<u64>, Option<u64>, Option<f64>, Option<f64>) {
    const BASELINE_TOKENS: u64 = 12_000;

    if context_window <= BASELINE_TOKENS {
        return (Some(0), Some(0), Some(0), None, None);
    }

    let effective_window = context_window.saturating_sub(BASELINE_TOKENS);
    if effective_window == 0 {
        return (Some(0), Some(0), Some(0), None, None);
    }

    let tokens_in_context = usage
        .total_tokens
        .saturating_sub(usage.reasoning_output_tokens);
    let used_tokens = tokens_in_context
        .saturating_sub(BASELINE_TOKENS)
        .min(effective_window);
    let remaining_tokens = effective_window.saturating_sub(used_tokens);

    let remaining_pct = (remaining_tokens as f64 / effective_window as f64) * 100.0;
    let used_pct = 100.0 - remaining_pct;

    (
        Some(effective_window),
        Some(used_tokens),
        Some(remaining_tokens),
        Some(used_pct),
        Some(remaining_pct),
    )
}

fn format_path(path: &Path, project_dir: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(project_dir) {
        rel.display().to_string()
    } else {
        path.display().to_string()
    }
}

fn timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_millis(0))
        .as_millis() as i64
}

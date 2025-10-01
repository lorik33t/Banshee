use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
#[cfg_attr(mobile, tauri::mobile_entry_point)]
use std::sync::Mutex;
use std::thread;
use tauri::{Emitter, Manager};

mod codex_bridge;
use codex_bridge::CodexBridge;

mod terminal;
use terminal::{LspManager, TerminalManager};

mod checkpoint;
use checkpoint::*;

mod codex_repo;
mod codex_run;
use codex_repo::codex_repo;
use codex_run::codex_run;

trait ModelHandler: Send {
    fn start(&mut self, app: tauri::AppHandle, project_dir: &str) -> Result<(), String>;
    fn send(&mut self, input: &str) -> Result<(), String>;
    fn stop(&mut self) -> Result<(), String>;
}

struct NodeModelHandler {
    model: &'static str,
    script: &'static str,
    child: Option<Child>,
}

impl NodeModelHandler {
    fn new(model: &'static str, script: &'static str) -> Self {
        Self {
            model,
            script,
            child: None,
        }
    }
}

impl ModelHandler for NodeModelHandler {
    fn start(&mut self, app: tauri::AppHandle, project_dir: &str) -> Result<(), String> {
        if self.child.is_some() {
            return Ok(());
        }

        let mut handler_path = app.path().resource_dir().map_err(|e| {
            eprintln!("[RUST] Failed to get resource dir: {}", e);
            format!("Failed to get resource dir: {}", e)
        })?;
        handler_path.push(self.script);
        if !handler_path.exists() {
            handler_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(self.script);
        }
        if !handler_path.exists() {
            eprintln!("[RUST] Handler file does not exist at {:?}", handler_path);
            return Err(format!("Handler file not found: {:?}", handler_path));
        }

        let mut cmd = Command::new("node");
        cmd.arg(&handler_path)
            .current_dir(project_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        eprintln!(
            "[RUST] Spawning persistent handler: node {:?} in dir {:?}",
            handler_path, project_dir
        );
        let mut child = cmd.spawn().map_err(|e| {
            eprintln!("[RUST] Failed to spawn handler: {}", e);
            format!("Failed to spawn handler: {}", e)
        })?;
        eprintln!(
            "[RUST] Persistent handler process spawned successfully for model {}",
            self.model
        );

        if let Some(stdout) = child.stdout.take() {
            let app_handle = app.clone();
            let model_clone = self.model.to_string();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        if !l.trim().is_empty() {
                            let event_name = format!("{}:stream", model_clone);
                            let _ = app_handle.emit(&event_name, l);
                        }
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let app_handle = app.clone();
            let model_clone = self.model.to_string();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        let event_name = format!("{}:error", model_clone);
                        let _ = app_handle.emit(&event_name, l);
                    }
                }
            });
        }

        self.child = Some(child);
        Ok(())
    }

    fn send(&mut self, input: &str) -> Result<(), String> {
        if let Some(child) = self.child.as_mut() {
            if let Some(stdin) = child.stdin.as_mut() {
                stdin
                    .write_all(input.as_bytes())
                    .map_err(|e| e.to_string())?;
                stdin.write_all(b"\n").map_err(|e| e.to_string())?;
                stdin.flush().map_err(|e| e.to_string())?;
                Ok(())
            } else {
                Err("Handler stdin unavailable".into())
            }
        } else {
            Err("Handler not started".into())
        }
    }

    fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
        }
        Ok(())
    }
}

static TERMINAL_MANAGER: Lazy<TerminalManager> = Lazy::new(|| TerminalManager::new());
static LSP_MANAGER: Lazy<LspManager> = Lazy::new(|| LspManager::new());
// Registry of model handlers
static MODEL_HANDLERS: Lazy<Mutex<HashMap<String, Box<dyn ModelHandler + Send + 'static>>>> =
    Lazy::new(|| {
        let mut m: HashMap<String, Box<dyn ModelHandler + Send + 'static>> = HashMap::new();
        m.insert(
            "codex".into(),
            Box::new(NodeModelHandler::new(
                "codex",
                "model_handlers/codex-handler.js",
            )),
        );
        Mutex::new(m)
    });

struct SessionRuntime {
    project_dir: String,
    codex: Option<CodexBridge>,
    terminal_id: Option<String>,
}

impl SessionRuntime {
    fn new(project_dir: String) -> Self {
        Self {
            project_dir,
            codex: None,
            terminal_id: None,
        }
    }
}

static SESSION_MANAGER: Lazy<Mutex<HashMap<String, SessionRuntime>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) fn get_session_project_dir(session_id: &str) -> Option<String> {
    SESSION_MANAGER
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).map(|s| s.project_dir.clone()))
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        })
}

#[derive(serde::Deserialize)]
struct CloneArgs {
    url: String,
    #[serde(alias = "dest_dir", alias = "destDir")]
    dest_dir: String,
}

#[tauri::command]
async fn clone_repo(args: CloneArgs) -> Result<String, String> {
    let url = args.url;
    let dest_dir = args.dest_dir;
    // Run blocking process off the main thread so UI stays responsive
    let url_clone = url.clone();
    let dest_clone = dest_dir.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        Command::new("git")
            .arg("clone")
            .arg("--depth")
            .arg("1")
            .arg(&url_clone)
            .arg(&dest_clone)
            .status()
    })
    .await
    .map_err(|e| format!("failed to join clone task: {}", e))
    .and_then(|res| res.map_err(|e| format!("failed to spawn git: {}", e)))?;

    if !status.success() {
        return Err(format!("git clone failed with status: {}", status));
    }
    Ok(dest_dir)
}

#[tauri::command]
fn start_codex(
    app: tauri::AppHandle,
    session_id: String,
    project_dir: String,
) -> Result<(), String> {
    let resolved_dir = if project_dir.trim().is_empty() {
        std::env::current_dir().map_err(|e| format!("Failed to resolve current dir: {}", e))?
    } else {
        PathBuf::from(&project_dir)
    };
    let resolved_str = resolved_dir
        .canonicalize()
        .unwrap_or_else(|_| resolved_dir.clone())
        .to_string_lossy()
        .to_string();

    eprintln!(
        "[start_codex] session={} incoming={} resolved={}",
        session_id, project_dir, resolved_str
    );
    let mut sessions = SESSION_MANAGER.lock().unwrap();
    let entry = sessions
        .entry(session_id.clone())
        .or_insert_with(|| SessionRuntime::new(resolved_str.clone()));

    // If Codex is already running for this session and the project path is unchanged,
    // treat this as an idempotent call and return early to avoid thrashing the process.
    let already_running_same_dir =
        entry.codex.as_ref().is_some() && entry.project_dir == resolved_str;
    entry.project_dir = resolved_str.clone();

    if already_running_same_dir {
        return Ok(());
    }

    if let Some(mut bridge) = entry.codex.take() {
        let _ = bridge.stop();
    }

    let mut bridge = CodexBridge::new(app, session_id.clone());
    bridge.start(&resolved_str)?;
    entry.codex = Some(bridge);

    Ok(())
}

#[tauri::command]
fn send_to_codex(app: tauri::AppHandle, session_id: String, input: String) -> Result<(), String> {
    let mut sessions = SESSION_MANAGER.lock().unwrap();
    let entry = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Codex session not initialized".to_string())?;

    if entry.codex.is_none() {
        let mut bridge = CodexBridge::new(app.clone(), session_id.clone());
        bridge.start(&entry.project_dir)?;
        entry.codex = Some(bridge);
    }

    let result = entry
        .codex
        .as_mut()
        .ok_or_else(|| "Codex session not initialized".to_string())?
        .send_message(&input);
    if let Err(err) = &result {
        eprintln!(
            "[send_to_codex] session={} project={} error={}",
            session_id, entry.project_dir, err
        );
    } else {
        eprintln!(
            "[send_to_codex] session={} project={} ok",
            session_id, entry.project_dir
        );
    }
    result
}

#[tauri::command]
fn interrupt_codex(session_id: String) -> Result<(), String> {
    let mut sessions = SESSION_MANAGER.lock().unwrap();
    let entry = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Codex session not initialized".to_string())?;
    if let Some(bridge) = entry.codex.as_mut() {
        bridge.interrupt()
    } else {
        Err("Codex bridge not initialized. Please ensure a project is open.".into())
    }
}

#[tauri::command]
fn resolve_codex_permission(
    session_id: String,
    request_id: String,
    allow: bool,
    scope: String,
) -> Result<(), String> {
    let mut sessions = SESSION_MANAGER.lock().unwrap();
    let entry = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Codex session not initialized".to_string())?;
    if let Some(bridge) = entry.codex.as_mut() {
        bridge.resolve_permission(&request_id, allow, &scope)
    } else {
        Err("Codex bridge not initialized. Please ensure a project is open.".into())
    }
}

#[tauri::command]
fn restart_codex(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let project_dir = {
        let sessions = SESSION_MANAGER.lock().unwrap();
        let entry = sessions
            .get(&session_id)
            .ok_or_else(|| "Codex session not initialized".to_string())?;
        entry.project_dir.clone()
    };

    stop_codex(session_id.clone())?;
    start_codex(app, session_id, project_dir)
}

#[tauri::command]
fn send_to_model(
    app: tauri::AppHandle,
    session_id: String,
    input: String,
    model: String,
) -> Result<(), String> {
    let model = model.to_lowercase();
    eprintln!("[RUST] send_to_model called with model: {}", model);
    eprintln!("[RUST] Input length: {}", input.len());

    let project_dir = {
        let sessions = SESSION_MANAGER.lock().unwrap();
        let entry = sessions
            .get(&session_id)
            .ok_or_else(|| "Codex session not initialized".to_string())?;
        entry.project_dir.clone()
    };
    if project_dir.is_empty() {
        eprintln!("[RUST] Error: Project directory not set");
        return Err("Project directory not set.".into());
    }
    eprintln!("[RUST] Project directory: {}", project_dir);

    let mut registry = MODEL_HANDLERS.lock().unwrap();
    let handler = registry.get_mut(&model).ok_or_else(|| {
        eprintln!("[RUST] Error: Unknown model: {}", model);
        format!("Unknown model: {}", model)
    })?;
    handler.start(app, &project_dir)?;
    handler.send(&input)?;
    Ok(())
}

#[tauri::command]
fn stop_codex(session_id: String) -> Result<(), String> {
    {
        let mut registry = MODEL_HANDLERS.lock().unwrap();
        for handler in registry.values_mut() {
            let _ = handler.stop();
        }
    }

    let mut sessions = SESSION_MANAGER.lock().unwrap();
    if let Some(runtime) = sessions.get_mut(&session_id) {
        // Close terminal if exists
        if let Some(term_id) = runtime.terminal_id.take() {
            let _ = TERMINAL_MANAGER.close_terminal(&term_id);
        }

        // Stop codex bridge
        if let Some(mut bridge) = runtime.codex.take() {
            let _ = bridge.stop();
        }
    }

    Ok(())
}

#[tauri::command]
fn stop_model(model: String) -> Result<(), String> {
    let m = model.to_lowercase();
    let mut registry = MODEL_HANDLERS.lock().unwrap();
    if let Some(handler) = registry.get_mut(&m) {
        handler.stop()?;
    }
    Ok(())
}

#[tauri::command]
fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct CommandResult {
    output: String,
    exit_code: i32,
    cwd: String,
}

#[tauri::command]
async fn run_command(command: String, cwd: Option<String>) -> Result<CommandResult, String> {
    use std::env;

    let working_dir = cwd.unwrap_or_else(|| {
        env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .to_string_lossy()
            .to_string()
    });

    // Handle cd commands specially
    let (new_cwd, actual_command) = if command.trim().starts_with("cd ") {
        let target = command.trim().strip_prefix("cd ").unwrap_or("").trim();
        let target_path = if target.is_empty() || target == "~" {
            dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."))
        } else if target.starts_with("~/") {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(&target[2..])
        } else if target.starts_with('/') {
            std::path::PathBuf::from(target)
        } else {
            std::path::PathBuf::from(&working_dir).join(target)
        };

        // Check if directory exists
        if target_path.is_dir() {
            let new_cwd = target_path
                .canonicalize()
                .unwrap_or(target_path)
                .to_string_lossy()
                .to_string();
            return Ok(CommandResult {
                output: String::new(),
                exit_code: 0,
                cwd: new_cwd,
            });
        } else {
            return Ok(CommandResult {
                output: format!("cd: no such file or directory: {}\n", target),
                exit_code: 1,
                cwd: working_dir,
            });
        }
    } else {
        (working_dir.clone(), command.as_str())
    };

    let working_dir_for_spawn = working_dir.clone();
    let new_cwd_for_spawn = new_cwd.clone();
    let actual_command_owned = actual_command.to_string();

    // Execute the command
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("sh")
            .arg("-c")
            .arg(actual_command_owned)
            .current_dir(&working_dir_for_spawn)
            .output()
    })
    .await
    .map_err(|e| format!("Failed to join command task: {}", e))?
    .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    let combined_output = if stderr.is_empty() {
        stdout
    } else if stdout.is_empty() {
        stderr
    } else {
        format!("{}{}", stdout, stderr)
    };

    Ok(CommandResult {
        output: combined_output,
        exit_code,
        cwd: new_cwd_for_spawn,
    })
}

#[tauri::command]
async fn execute_command(session_id: String, command: String) -> Result<String, String> {
    let project_dir = {
        let sessions = SESSION_MANAGER.lock().unwrap();
        sessions
            .get(&session_id)
            .map(|s| s.project_dir.clone())
            .unwrap_or_default()
    };

    let working_dir = if project_dir.is_empty() {
        String::from(".")
    } else {
        project_dir.clone()
    };

    let command_owned = command.clone();
    let working_dir_for_spawn = working_dir.clone();

    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("sh")
            .arg("-c")
            .arg(command_owned)
            .current_dir(&working_dir_for_spawn)
            .output()
    })
    .await
    .map_err(|e| format!("Failed to join command task: {}", e))?
    .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Ok(format!("{}{}", stdout, stderr))
    }
}

#[tauri::command]
fn create_terminal(
    app: tauri::AppHandle,
    session_id: String,
    id: String,
    working_dir: Option<String>,
) -> Result<(), String> {
    let working_dir = {
        let mut sessions = SESSION_MANAGER.lock().unwrap();
        let runtime = sessions.get_mut(&session_id);

        let provided_dir = working_dir
            .as_ref()
            .map(|dir| dir.trim())
            .filter(|dir| !dir.is_empty())
            .map(|dir| dir.to_string());

        if let Some(runtime) = runtime {
            runtime.terminal_id = Some(id.clone());

            match provided_dir {
                Some(dir) => Some(dir),
                None => {
                    let trimmed = runtime.project_dir.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                }
            }
        } else {
            provided_dir
        }
    };

    TERMINAL_MANAGER.create_terminal(id, app, working_dir)
}

#[tauri::command]
fn write_to_terminal(id: String, data: String) -> Result<(), String> {
    TERMINAL_MANAGER.write_to_terminal(&id, &data)
}

#[tauri::command]
fn resize_terminal(id: String, rows: u16, cols: u16) -> Result<(), String> {
    TERMINAL_MANAGER.resize_terminal(&id, rows, cols)
}

#[tauri::command]
fn close_terminal(session_id: String, id: String) -> Result<(), String> {
    // Clear terminal ID from session
    let mut sessions = SESSION_MANAGER.lock().unwrap();
    if let Some(runtime) = sessions.get_mut(&session_id) {
        if runtime.terminal_id.as_ref() == Some(&id) {
            runtime.terminal_id = None;
        }
    }

    TERMINAL_MANAGER.close_terminal(&id)
}

#[tauri::command]
fn get_session_terminal_id(session_id: String) -> Result<Option<String>, String> {
    let sessions = SESSION_MANAGER.lock().unwrap();
    Ok(sessions
        .get(&session_id)
        .and_then(|s| s.terminal_id.clone()))
}

#[derive(serde::Deserialize)]
struct LspRequest {
    language: String,
    cmd: String,
    request: String,
}

#[tauri::command]
fn lsp_proxy(args: LspRequest) -> Result<String, String> {
    LSP_MANAGER.send_request(&args.language, &args.cmd, &args.request)
}

// Terminal session persistence
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct TerminalSession {
    entries: Vec<TerminalEntry>,
    working_dir: String,
    command_history: Vec<String>,
    last_updated: u64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct TerminalEntry {
    command: String,
    output: String,
    exit_code: i32,
    timestamp: u64,
}

fn get_terminal_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    let data_dir = home.join(".claude-code").join("terminal");

    // Ensure directory exists
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create terminal data directory: {}", e))?;

    Ok(data_dir)
}

#[tauri::command]
fn save_terminal_session(
    entries: Vec<TerminalEntry>,
    working_dir: String,
    command_history: Vec<String>,
) -> Result<(), String> {
    eprintln!(
        "Saving terminal session with {} entries to {:?}",
        entries.len(),
        working_dir
    );
    let data_dir = get_terminal_data_dir()?;
    let session_file = data_dir.join("session.json");
    eprintln!("Session file path: {:?}", session_file);

    let session = TerminalSession {
        entries,
        working_dir,
        command_history,
        last_updated: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    };

    let json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;

    fs::write(&session_file, json).map_err(|e| format!("Failed to write session file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn load_terminal_session() -> Result<Option<TerminalSession>, String> {
    let data_dir = get_terminal_data_dir()?;
    let session_file = data_dir.join("session.json");
    eprintln!("Loading terminal session from: {:?}", session_file);

    if !session_file.exists() {
        eprintln!("Session file does not exist");
        return Ok(None);
    }

    let json = fs::read_to_string(&session_file)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let session: TerminalSession =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse session file: {}", e))?;

    eprintln!("Loaded session with {} entries", session.entries.len());
    Ok(Some(session))
}

#[tauri::command]
fn clear_terminal_session() -> Result<(), String> {
    let data_dir = get_terminal_data_dir()?;
    let session_file = data_dir.join("session.json");

    if session_file.exists() {
        fs::remove_file(&session_file)
            .map_err(|e| format!("Failed to clear session file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn load_settings() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").map_err(|e| format!("Failed to get HOME: {}", e))?;
    let settings_path = std::path::Path::new(&home).join(".config/claude/settings.json");

    if !settings_path.exists() {
        // Return empty object if settings file doesn't exist
        return Ok(serde_json::json!({}));
    }

    let contents = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;

    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse settings: {}", e))
}

#[tauri::command]
fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|e| format!("Failed to get HOME: {}", e))?;
    let config_dir = std::path::Path::new(&home).join(".config/claude");

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let settings_path = config_dir.join("settings.json");
    let contents = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(&settings_path, contents)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}

#[tauri::command]
fn save_temp_image(base64_data: String, filename: String) -> Result<String, String> {
    // Remove data URL prefix if present
    let data = if base64_data.starts_with("data:") {
        base64_data.split(',').nth(1).unwrap_or(&base64_data)
    } else {
        &base64_data
    };

    // Decode base64
    use base64::{engine::general_purpose, Engine as _};
    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Create temp directory if it doesn't exist
    let temp_dir = std::env::temp_dir().join("claude-code-ui-images");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Save file
    let file_path = temp_dir.join(&filename);
    std::fs::write(&file_path, bytes).map_err(|e| format!("Failed to write image file: {}", e))?;

    // Return the file path
    file_path
        .to_str()
        .ok_or_else(|| "Failed to convert path to string".to_string())
        .map(|s| s.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let _ = app.handle().plugin(tauri_plugin_dialog::init());
            let _ = app.handle().plugin(tauri_plugin_fs::init());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_codex,
            send_to_codex,
            interrupt_codex,
            resolve_codex_permission,
            restart_codex,
            send_to_model,
            stop_codex,
            stop_model,
            get_cwd,
            run_command,
            execute_command,
            create_terminal,
            write_to_terminal,
            resize_terminal,
            close_terminal,
            get_session_terminal_id,
            lsp_proxy,
            save_terminal_session,
            load_terminal_session,
            clear_terminal_session,
            load_settings,
            save_settings,
            save_checkpoint_files,
            restore_checkpoint,
            delete_checkpoint,
            list_checkpoint_files,
            get_checkpoint_metadata,
            get_git_info,
            get_checkpoint_file,
            restore_checkpoint_files,
            restore_checkpoint_with_mode,
            clean_old_checkpoints,
            list_checkpoints,
            save_temp_image,
            clone_repo,
            codex_repo,
            codex_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

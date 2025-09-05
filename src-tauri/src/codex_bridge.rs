use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter};

/// Bridge for communicating with the Codex CLI.
pub struct CodexBridge {
    process: Option<Child>,
    app_handle: AppHandle,
    project_dir: String,
    has_active_session: bool,
}

impl CodexBridge {
    /// Create a new bridge instance.
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            process: None,
            app_handle,
            project_dir: String::new(),
            has_active_session: false,
        }
    }

    /// Initialize the bridge for a given project directory.
    pub fn start(&mut self, project_dir: &str) -> Result<(), String> {
        self.project_dir = project_dir.to_string();
        self.has_active_session = false;
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
        }
        eprintln!("[CodexBridge] Initialized. Project: {}", self.project_dir);
        Ok(())
    }

    /// Send a message to Codex.
    pub fn send_message(&mut self, input: &str) -> Result<(), String> {
        eprintln!("[CodexBridge] send_message with payload size: {}", input.len());

        if self.project_dir.is_empty() {
            return Err("Project directory not set. Call start_codex first.".into());
        }

        // Ensure any existing process is terminated before starting a new one
        if let Some(mut existing) = self.process.take() {
            eprintln!("[CodexBridge] Terminating existing Codex process before spawning a new one");
            #[cfg(unix)]
            unsafe {
                libc::kill(existing.id() as i32, libc::SIGINT);
            }
            let _ = existing.kill();
            let _ = existing.wait();
        }

        // Parse JSON to extract currentMessage
        let mut prompt: Option<String> = None;
        match serde_json::from_str::<serde_json::Value>(input) {
            Ok(v) => {
                if let Some(msg) = v.get("currentMessage").and_then(|m| m.as_str()) {
                    prompt = Some(msg.to_string());
                }
            }
            Err(e) => {
                eprintln!("[CodexBridge] Failed to parse JSON input, using raw as prompt: {}", e);
                prompt = Some(input.to_string());
            }
        }

        let prompt = prompt.ok_or_else(|| "Missing 'currentMessage' in input".to_string())?;

        // Build args for Codex CLI
        let mut args: Vec<String> = Vec::new();
        args.push("exec".to_string());
        args.push("--sandbox".to_string());
        args.push("workspace-write".to_string());
        args.push(prompt.clone());

        // Spawn codex process
        eprintln!("[CodexBridge] Spawning: codex {:?} (cwd: {})", args, self.project_dir);
        let mut child = Command::new("codex")
            .args(&args)
            .current_dir(&self.project_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn Codex: {}", e))?;

        // Stream stdout with de-duplication of consecutive identical lines
        if let Some(stdout) = child.stdout.take() {
            let app_handle = self.app_handle.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                let mut last_line: Option<String> = None;
                for line in reader.lines() {
                    if let Ok(l) = line {
                        if !l.trim().is_empty() {
                            let trimmed = l.trim().to_string();
                            let is_dup =
                                last_line.as_ref().map(|x| x == &trimmed).unwrap_or(false);
                            if !is_dup {
                                let _ = app_handle.emit("codex:stream", trimmed.clone());
                                last_line = Some(trimmed);
                            }
                        }
                    }
                }
            });
        }

        // Stream stderr
        if let Some(stderr) = child.stderr.take() {
            let app_handle = self.app_handle.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        eprintln!("[CodexBridge stderr]: {}", l);
                        let _ = app_handle.emit("codex:error", l);
                    }
                }
            });
        }

        // Keep handle to allow stop(); mark session as active after first run
        self.process = Some(child);
        self.has_active_session = true;
        Ok(())
    }

    /// Stop the Codex process if running.
    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.process.take() {
            #[cfg(unix)]
            {
                let pid = child.id();
                unsafe {
                    libc::kill(pid as i32, libc::SIGINT);
                }
                let timeout = std::time::Duration::from_millis(1000);
                match child.try_wait() {
                    Ok(Some(_)) => return Ok(()),
                    Ok(None) => {
                        std::thread::sleep(timeout);
                        if let Ok(Some(_)) = child.try_wait() {
                            return Ok(());
                        }
                    }
                    Err(_) => {}
                }
                let _ = child.kill();
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill();
            }
        }
        Ok(())
    }
}


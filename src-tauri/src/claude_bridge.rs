use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter};
use crate::claude_binary::{create_command_with_env, find_claude_binary};

pub struct ClaudeBridge {
    process: Option<Child>,
    app_handle: AppHandle,
    project_dir: String,
    has_active_session: bool,
}

impl ClaudeBridge {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            process: None,
            app_handle,
            project_dir: String::new(),
            has_active_session: false,
        }
    }

    pub fn start(&mut self, project_dir: &str) -> Result<(), String> {
        // Store project directory and reset state. No child process is started here.
        self.project_dir = project_dir.to_string();
        self.has_active_session = false;
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
        }
        eprintln!("[ClaudeBridge] Initialized (direct spawn). Project: {}", self.project_dir);
        Ok(())
    }

    pub fn send_message(&mut self, input: &str) -> Result<(), String> {
        eprintln!("[ClaudeBridge] send_message (direct) with payload size: {}", input.len());

        if self.project_dir.is_empty() {
            return Err("Project directory not set. Call start_claude first.".into());
        }

        // Ensure any existing process is terminated before starting a new one to avoid double streams
        if let Some(mut existing) = self.process.take() {
            eprintln!("[ClaudeBridge] Terminating existing Claude process before spawning a new one");
            #[cfg(unix)]
            unsafe { libc::kill(existing.id() as i32, libc::SIGINT); }
            let _ = existing.kill();
            let _ = existing.wait();
        }

        // Parse JSON to extract currentMessage and optional model
        let mut prompt: Option<String> = None;
        let mut model: Option<String> = None;
        match serde_json::from_str::<serde_json::Value>(input) {
            Ok(v) => {
                if let Some(msg) = v.get("currentMessage").and_then(|m| m.as_str()) {
                    prompt = Some(msg.to_string());
                }
                if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
                    model = Some(m.to_string());
                }
            }
            Err(e) => {
                eprintln!("[ClaudeBridge] Failed to parse JSON input, using raw as prompt: {}", e);
                prompt = Some(input.to_string());
            }
        }

        let prompt = prompt.ok_or_else(|| "Missing 'currentMessage' in input".to_string())?;

        // Build args similar to Claudia
        let mut args: Vec<String> = Vec::new();
        if self.has_active_session {
            args.push("-c".to_string());
        }
        args.push("-p".to_string());
        args.push(prompt.clone());
        if let Some(m) = model.clone() {
            args.push("--model".to_string());
            args.push(m);
        }
        args.push("--output-format".to_string());
        args.push("stream-json".to_string());
        args.push("--verbose".to_string());
        args.push("--dangerously-skip-permissions".to_string());

        // Find claude binary and create command
        let claude_path = find_claude_binary(&self.app_handle)?;
        eprintln!("[ClaudeBridge] Using Claude binary: {}", claude_path);
        let mut cmd = create_command_with_env(&claude_path);
        cmd.args(&args)
            .current_dir(&self.project_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        eprintln!("[ClaudeBridge] Spawning: {} {:?} (cwd: {})", claude_path, args, self.project_dir);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn Claude: {}", e))?;

        // Stream stdout with simple de-duplication of consecutive identical lines
        if let Some(stdout) = child.stdout.take() {
            let app_handle = self.app_handle.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                let mut last_line: Option<String> = None;
                for line in reader.lines() {
                    if let Ok(l) = line {
                        if !l.trim().is_empty() {
                            let trimmed = l.trim().to_string();
                            let is_dup = last_line.as_ref().map(|x| x == &trimmed).unwrap_or(false);
                            if !is_dup {
                                let _ = app_handle.emit("claude:stream", trimmed.clone());
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
                        eprintln!("[ClaudeBridge stderr]: {}", l);
                        let _ = app_handle.emit("claude:error", l);
                    }
                }
            });
        }

        // Keep handle to allow stop(); mark session as active after first run
        self.process = Some(child);
        self.has_active_session = true;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.process.take() {
            // Try to send SIGTERM first for graceful shutdown
            #[cfg(unix)]
            {
                let pid = child.id();
                
                // Send SIGINT first (like Ctrl+C)
                unsafe {
                    libc::kill(pid as i32, libc::SIGINT);
                }
                
                // Wait briefly for graceful shutdown
                let timeout = std::time::Duration::from_millis(1000);
                match child.try_wait() {
                    Ok(Some(_)) => return Ok(()), // Process exited gracefully
                    Ok(None) => {
                        // Still running, wait a bit
                        std::thread::sleep(timeout);
                        if let Ok(Some(_)) = child.try_wait() {
                            return Ok(()); // Exited after waiting
                        }
                    }
                    Err(_) => {}
                }
                
                // Force kill if still running
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
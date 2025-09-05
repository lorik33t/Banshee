use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, Child};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child as ProcessChild, ChildStdout, Command as StdCommand, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use std::thread;

pub struct Terminal {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader_thread: Option<thread::JoinHandle<()>>,
}

pub struct TerminalManager {
    terminals: Arc<Mutex<HashMap<String, Terminal>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        TerminalManager {
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_terminal(&self, id: String, app: AppHandle) -> Result<(), String> {
        let pty_system = native_pty_system();
        
        // Create a new PTY with a specific size
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to create PTY: {}", e))?;

        // Get the user's shell or default to bash
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        eprintln!("Starting shell: {}", shell);
        
        // Get project directory
        let project_dir = crate::PROJECT_DIR.lock().unwrap().clone();
        
        // Build the command with interactive flags
        let mut cmd = CommandBuilder::new(&shell);
        
        // Add interactive flag for the shell
        if shell.contains("bash") {
            cmd.args(&["-i"]);  // Interactive mode
        } else if shell.contains("zsh") {
            cmd.args(&["-i"]);  // Interactive mode
        } else if shell.contains("fish") {
            cmd.args(&["-i"]);  // Interactive mode
        }
        
        if !project_dir.is_empty() {
            cmd.cwd(&project_dir);
        }
        
        // Critical: Set TERM before spawning to ensure proper terminal setup
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        
        // Pass through PATH and other essential environment
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }
        if let Ok(user) = std::env::var("USER") {
            cmd.env("USER", user);
        }
        
        // Spawn the shell process
        let child = pair.slave.spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Get a reader for the master PTY
        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;

        // Start a thread to read output
        let terminal_id = id.clone();
        let app_handle = app.clone();
        let reader_thread = thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // EOF - shell has exited
                        let _ = app_handle.emit(&format!("terminal:exit:{}", terminal_id), "");
                        break;
                    }
                    Ok(n) => {
                        let output = String::from_utf8_lossy(&buffer[..n]).to_string();
                        // Debug what we're sending back
                        eprintln!("PTY output: {:?} (bytes: {:?})", output, &buffer[..n]);
                        let _ = app_handle.emit(&format!("terminal:output:{}", terminal_id), output);
                    }
                    Err(e) => {
                        eprintln!("Error reading from PTY: {}", e);
                        break;
                    }
                }
            }
        });

        let terminal = Terminal {
            master: pair.master,
            child,
            reader_thread: Some(reader_thread),
        };

        self.terminals.lock().unwrap().insert(id, terminal);
        Ok(())
    }

    pub fn write_to_terminal(&self, id: &str, data: &str) -> Result<(), String> {
        // Debug log what we're receiving
        eprintln!("write_to_terminal received: {:?} (bytes: {:?})", data, data.as_bytes());
        
        let mut terminals = self.terminals.lock().unwrap();
        let terminal = terminals.get_mut(id)
            .ok_or_else(|| "Terminal not found".to_string())?;

        let mut writer = terminal.master.take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;
        
        // Write data to the terminal
        writer.write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to terminal: {}", e))?;
        
        // Flush to ensure data is sent immediately
        writer.flush()
            .map_err(|e| format!("Failed to flush terminal: {}", e))?;
        
        Ok(())
    }

    pub fn resize_terminal(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let terminals = self.terminals.lock().unwrap();
        let terminal = terminals.get(id)
            .ok_or_else(|| "Terminal not found".to_string())?;

        terminal.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Failed to resize terminal: {}", e))?;
        
        Ok(())
    }

    pub fn close_terminal(&self, id: &str) -> Result<(), String> {
        let mut terminals = self.terminals.lock().unwrap();
        if let Some(mut terminal) = terminals.remove(id) {
            // Kill the child process
            terminal.child.kill()
                .map_err(|e| format!("Failed to kill terminal process: {}", e))?;
            
            // Wait for reader thread to finish
            if let Some(thread) = terminal.reader_thread.take() {
                let _ = thread.join();
            }
        }
        Ok(())
    }
}

pub struct LspServer {
    child: ProcessChild,
    reader: BufReader<ChildStdout>,
}

pub struct LspManager {
    servers: Mutex<HashMap<String, LspServer>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
        }
    }

    pub fn send_request(
        &self,
        lang: &str,
        cmd: &str,
        request: &str,
    ) -> Result<String, String> {
        let mut servers = self.servers.lock().unwrap();
        if !servers.contains_key(lang) {
            let mut child = StdCommand::new(cmd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn LSP server: {}", e))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "Failed to take stdout".to_string())?;
            let reader = BufReader::new(stdout);
            servers.insert(lang.to_string(), LspServer { child, reader });
        }

        let server = servers.get_mut(lang).unwrap();
        let stdin = server
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| "Failed to get stdin".to_string())?;
        let msg = format!("Content-Length: {}\r\n\r\n{}", request.len(), request);
        stdin
            .write_all(msg.as_bytes())
            .map_err(|e| format!("Failed to write to LSP server: {}", e))?;
        stdin.flush().ok();

        let mut header = String::new();
        loop {
            let mut line = String::new();
            server
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("Failed to read LSP response: {}", e))?;
            if line == "\r\n" || line == "\n" {
                break;
            }
            header.push_str(&line);
        }
        let len = header
            .lines()
            .find_map(|l| l.strip_prefix("Content-Length: "))
            .and_then(|s| s.trim().parse::<usize>().ok())
            .ok_or_else(|| "Missing Content-Length".to_string())?;
        let mut buf = vec![0u8; len];
        server
            .reader
            .read_exact(&mut buf)
            .map_err(|e| format!("Failed to read LSP body: {}", e))?;
        let resp = String::from_utf8(buf).map_err(|e| format!("Invalid UTF-8: {}", e))?;
        Ok(resp)
    }
}

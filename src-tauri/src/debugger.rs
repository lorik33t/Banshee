use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct Debugger {
    child: Child,
    stdin: Option<ChildStdin>,
}

pub struct DebuggerManager {
    debuggers: Arc<Mutex<HashMap<String, Debugger>>>,
}

impl DebuggerManager {
    pub fn new() -> Self {
        Self {
            debuggers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_debugger(&self, id: String, adapter: String, args: Vec<String>, app: AppHandle) -> Result<(), String> {
        let mut cmd = Command::new(adapter);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn debugger: {}", e))?;

        let stdout = child.stdout.take().ok_or_else(|| "Failed to capture stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "Failed to capture stderr".to_string())?;
        let app_clone = app.clone();
        let id_clone = id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = app_clone.emit(&format!("debugger:output:{}", id_clone), l);
                }
            }
        });

        let app_clone = app.clone();
        let id_clone = id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = app_clone.emit(&format!("debugger:error:{}", id_clone), l);
                }
            }
        });

        let dbg = Debugger { stdin: child.stdin.take(), child };
        self.debuggers.lock().unwrap().insert(id, dbg);
        Ok(())
    }

    pub fn send(&self, id: &str, message: &str) -> Result<(), String> {
        let mut map = self.debuggers.lock().unwrap();
        let dbg = map.get_mut(id).ok_or_else(|| "Debugger not found".to_string())?;
        if let Some(stdin) = dbg.stdin.as_mut() {
            stdin
                .write_all(message.as_bytes())
                .map_err(|e| format!("Failed to write to debugger: {}", e))?;
        }
        Ok(())
    }

    pub fn stop(&self, id: &str) -> Result<(), String> {
        let mut map = self.debuggers.lock().unwrap();
        if let Some(mut dbg) = map.remove(id) {
            dbg.child
                .kill()
                .map_err(|e| format!("Failed to kill debugger: {}", e))?;
        }
        Ok(())
    }
}

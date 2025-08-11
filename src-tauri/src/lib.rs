#[cfg_attr(mobile, tauri::mobile_entry_point)]
use std::{io::{BufRead, BufReader}, process::{Command, Stdio}, sync::Mutex, thread};
use once_cell::sync::Lazy;
use tauri::Emitter;

static CLAUDE_PROC: Lazy<Mutex<Option<std::process::Child>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
fn start_claude(app: tauri::AppHandle, project_dir: String) -> Result<(), String> {
  let mut guard = CLAUDE_PROC.lock().unwrap();
  if guard.is_some() {
    return Ok(());
  }
  let mut cmd = Command::new("claude");
  cmd.current_dir(project_dir)
    .arg("-p")
    .arg("--output-format=stream-json")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
  let mut child = cmd.spawn().map_err(|e| format!("failed to spawn claude: {}", e))?;

  let stdout = child.stdout.take().ok_or("no stdout")?;
  let app_handle = app.clone();
  thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
      if let Ok(l) = line { let _ = app_handle.emit("claude:stream", l); }
    }
  });

  *guard = Some(child);
  Ok(())
}

#[tauri::command]
fn send_to_claude(input: String) -> Result<(), String> {
  let mut guard = CLAUDE_PROC.lock().unwrap();
  if let Some(child) = guard.as_mut() {
    if let Some(stdin) = child.stdin.as_mut() {
      use std::io::Write;
      stdin.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
      stdin.write_all(b"\n").map_err(|e| e.to_string())?;
      return Ok(());
    }
  }
  Err("claude not running".into())
}

#[tauri::command]
fn stop_claude() -> Result<(), String> {
  let mut guard = CLAUDE_PROC.lock().unwrap();
  if let Some(mut child) = guard.take() {
    let _ = child.kill();
  }
  Ok(())
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
      app.handle().plugin(tauri_plugin_dialog::init());
      app.handle().plugin(tauri_plugin_fs::init());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![start_claude, send_to_claude, stop_claude])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
use std::sync::Mutex;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio, Child};
use std::thread;
use std::fs;
use std::path::PathBuf;
use once_cell::sync::Lazy;
use tauri::{Emitter, Manager};
use std::collections::HashMap;

mod claude_bridge;
use claude_bridge::ClaudeBridge;

mod claude_binary;

mod terminal;
use terminal::TerminalManager;

mod checkpoint;
use checkpoint::*;

static PROJECT_DIR: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static CLAUDE: Lazy<Mutex<Option<ClaudeBridge>>> = Lazy::new(|| Mutex::new(None));
static TERMINAL_MANAGER: Lazy<TerminalManager> = Lazy::new(|| TerminalManager::new());
// Legacy single active process (used by older flows); kept for compatibility
static ACTIVE_MODEL_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
// Persistent per-model handler processes (Gemini, Qwen, Codex)
static MODEL_PROCESSES: Lazy<Mutex<HashMap<String, Child>>> = Lazy::new(|| Mutex::new(HashMap::new()));

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
        .arg("--depth").arg("1")
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
fn start_claude(app: tauri::AppHandle, project_dir: String) -> Result<(), String> {
  // Store the project directory for later use
  {
    let mut dir_guard = PROJECT_DIR.lock().unwrap();
    *dir_guard = project_dir.clone();
  }

  // Always restart Claude bridge for new project directory to ensure proper isolation
  let mut guard = CLAUDE.lock().unwrap();

  // Stop existing bridge if it exists and project dir changed
  if let Some(mut bridge) = guard.take() {
    let _ = bridge.stop();
  }

  // Create and start new bridge for the current project
  let mut bridge = ClaudeBridge::new(app);
  bridge.start(&project_dir)?;
  *guard = Some(bridge);

  Ok(())
}

#[tauri::command]
fn send_to_claude(_app: tauri::AppHandle, input: String) -> Result<(), String> {
  eprintln!("[RUST] send_to_claude called with input length: {}", input.len());
  
  // Use the persistent Claude bridge
  let mut bridge_guard = CLAUDE.lock().unwrap();
  if let Some(bridge) = bridge_guard.as_mut() {
    // Send message to the persistent Claude process
    bridge.send_message(&input)?;
    Ok(())
  } else {
    eprintln!("[RUST] Error: Claude bridge not initialized");
    Err("Claude bridge not initialized. Please ensure a project is open.".into())
  }
}

#[tauri::command]
fn send_to_model(app: tauri::AppHandle, input: String, model: String) -> Result<(), String> {
  eprintln!("[RUST] send_to_model called with model: {}", model);
  eprintln!("[RUST] Input length: {}", input.len());
  
  // For Claude, use the persistent bridge
  if model == "claude" {
    return send_to_claude(app, input);
  }
  
  // For other models, use or start a persistent handler process and write the line to stdin
  
  let project_dir = PROJECT_DIR.lock().unwrap().clone();
  if project_dir.is_empty() { 
    eprintln!("[RUST] Error: Project directory not set");
    return Err("Project directory not set.".into()); 
  }
  eprintln!("[RUST] Project directory: {}", project_dir);

  // Select handler based on model
  let handler_name = match model.as_str() {
    "claude" => "claude-handler.js",
    "gemini" => "gemini-handler.js",
    "qwen" => "qwen-handler.js",
    "codex" => "codex-handler.js",
    _ => {
      eprintln!("[RUST] Error: Unknown model: {}", model);
      return Err(format!("Unknown model: {}", model))
    }
  };
  eprintln!("[RUST] Selected handler: {}", handler_name);

  // Resolve handler path
  let mut handler_path = app.path().resource_dir().map_err(|e| {
    eprintln!("[RUST] Failed to get resource dir: {}", e);
    format!("Failed to get resource dir: {}", e)
  })?;
  handler_path.push(handler_name);
  if !handler_path.exists() {
    eprintln!("[RUST] Handler not found at {:?}, trying CARGO_MANIFEST_DIR", handler_path);
    handler_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(handler_name);
  }
  eprintln!("[RUST] Handler path: {:?}", handler_path);
  
  if !handler_path.exists() {
    eprintln!("[RUST] Error: Handler file does not exist at {:?}", handler_path);
    return Err(format!("Handler file not found: {:?}", handler_path));
  }

  // Ensure persistent handler exists for this model
  let mut processes = MODEL_PROCESSES.lock().unwrap();
  let needs_spawn = !processes.contains_key(&model);
  if needs_spawn {
    let mut cmd = Command::new("node");
    cmd.arg(&handler_path)
      .current_dir(&project_dir)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());
    eprintln!("[RUST] Spawning persistent handler: node {:?} in dir {:?}", handler_path, project_dir);
    let mut child = cmd.spawn().map_err(|e| {
      eprintln!("[RUST] Failed to spawn handler: {}", e);
      format!("Failed to spawn handler: {}", e)
    })?;
    eprintln!("[RUST] Persistent handler process spawned successfully for model {}", model);

    // Stream stdout lines to UI as they arrive
    if let Some(stdout) = child.stdout.take() {
      let app_handle = app.clone();
      let model_clone = model.clone();
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

    // Forward stderr as error events
    if let Some(stderr) = child.stderr.take() {
      let app_handle = app.clone();
      let model_clone = model.clone();
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

    processes.insert(model.clone(), child);
  }

  // Write input line to the persistent handler stdin
  if let Some(child) = processes.get_mut(&model) {
    if let Some(stdin) = child.stdin.as_mut() {
      eprintln!("[RUST] Writing {} bytes to persistent handler stdin for {}", input.len(), model);
      stdin.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
      stdin.write_all(b"\n").map_err(|e| e.to_string())?;
      stdin.flush().map_err(|e| e.to_string())?;
    } else {
      eprintln!("[RUST] Handler stdin not available for model {}", model);
      return Err("Handler stdin unavailable".into());
    }
  }

  Ok(())
}

#[tauri::command]
fn stop_claude() -> Result<(), String> {
  // First, kill the active model process if any
  {
    let mut process_guard = ACTIVE_MODEL_PROCESS.lock().unwrap();
    if let Some(mut child) = process_guard.take() {
      eprintln!("[RUST] Killing active model process");
      let _ = child.kill();
    }
  }

  // Then stop the Claude bridge if it's running
  let mut guard = CLAUDE.lock().unwrap();
  if let Some(mut bridge) = guard.take() {
    eprintln!("[RUST] Stopping Claude bridge");
    let _ = bridge.stop();
  }

  // Clear project directory
  let mut dir_guard = PROJECT_DIR.lock().unwrap();
  dir_guard.clear();
  eprintln!("[RUST] Claude stopped and project directory cleared");
  Ok(())
}

#[tauri::command]
fn stop_model(model: String) -> Result<(), String> {
  let m = model.to_lowercase();
  if m == "claude" {
    return stop_claude();
  }

  let mut processes = MODEL_PROCESSES.lock().unwrap();
  if let Some(mut child) = processes.remove(&m) {
    eprintln!("[RUST] Stopping handler for model: {}", m);
    let _ = child.kill();
  }
  Ok(())
}

#[tauri::command]
fn restart_claude(app: tauri::AppHandle, project_dir: String) -> Result<(), String> {
  eprintln!("[RUST] Restarting Claude for project: {}", project_dir);

  // First, stop current Claude instance completely
  stop_claude()?;

  // Then start new instance
  start_claude(app, project_dir)
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
fn run_command(command: String, cwd: Option<String>) -> Result<CommandResult, String> {
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
      let new_cwd = target_path.canonicalize()
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
  
  // Execute the command
  let output = Command::new("sh")
    .arg("-c")
    .arg(actual_command)
    .current_dir(&working_dir)
    .output()
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
    cwd: new_cwd,
  })
}

#[tauri::command]
fn execute_command(command: String) -> Result<String, String> {
  let project_dir = PROJECT_DIR.lock().unwrap().clone();
  
  let output = Command::new("sh")
    .arg("-c")
    .arg(&command)
    .current_dir(if project_dir.is_empty() { "." } else { &project_dir })
    .output()
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
fn terminal_create(app: tauri::AppHandle, id: String) -> Result<(), String> {
  TERMINAL_MANAGER.create_terminal(id, app)
}

#[tauri::command]
fn terminal_write(id: String, data: String) -> Result<(), String> {
  TERMINAL_MANAGER.write_to_terminal(&id, &data)
}

#[tauri::command]
fn terminal_resize(id: String, rows: u16, cols: u16) -> Result<(), String> {
  TERMINAL_MANAGER.resize_terminal(&id, rows, cols)
}

#[tauri::command]
fn terminal_close(id: String) -> Result<(), String> {
  TERMINAL_MANAGER.close_terminal(&id)
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
  command_history: Vec<String>
) -> Result<(), String> {
  eprintln!("Saving terminal session with {} entries to {:?}", entries.len(), working_dir);
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
  
  fs::write(&session_file, json)
    .map_err(|e| format!("Failed to write session file: {}", e))?;
  
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
  
  let session: TerminalSession = serde_json::from_str(&json)
    .map_err(|e| format!("Failed to parse session file: {}", e))?;
  
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
  
  serde_json::from_str(&contents)
    .map_err(|e| format!("Failed to parse settings: {}", e))
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
  use base64::{Engine as _, engine::general_purpose};
  let bytes = general_purpose::STANDARD
    .decode(data)
    .map_err(|e| format!("Failed to decode base64: {}", e))?;
  
  // Create temp directory if it doesn't exist
  let temp_dir = std::env::temp_dir().join("claude-code-ui-images");
  std::fs::create_dir_all(&temp_dir)
    .map_err(|e| format!("Failed to create temp directory: {}", e))?;
  
  // Save file
  let file_path = temp_dir.join(&filename);
  std::fs::write(&file_path, bytes)
    .map_err(|e| format!("Failed to write image file: {}", e))?;
  
  // Return the file path
  file_path.to_str()
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
      start_claude, send_to_claude, send_to_model, stop_claude, restart_claude, stop_model,
      get_cwd, run_command, execute_command,
      terminal_create, terminal_write, terminal_resize, terminal_close,
      save_terminal_session, load_terminal_session, clear_terminal_session,
      load_settings, save_settings,
      save_checkpoint_files, restore_checkpoint, delete_checkpoint,
      list_checkpoint_files, get_checkpoint_metadata, get_git_info,
      get_checkpoint_file, restore_checkpoint_files, restore_checkpoint_with_mode,
      clean_old_checkpoints, list_checkpoints, save_temp_image, clone_repo
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

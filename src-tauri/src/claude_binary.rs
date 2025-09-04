use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

// Find the Claude CLI binary path.
// Order: CLAUDE_BINARY_PATH env -> `which claude` -> common paths (Homebrew, system, user, NVM) -> fallback "claude"
pub fn find_claude_binary(_app_handle: &AppHandle) -> Result<String, String> {
  // 1) Environment override
  if let Ok(path) = std::env::var("CLAUDE_BINARY_PATH") {
    let p = PathBuf::from(&path);
    if p.exists() && p.is_file() {
      return Ok(path);
    }
  }

  // 2) which claude
  if let Ok(output) = Command::new("which").arg("claude").output() {
    if output.status.success() {
      let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
      if !found.is_empty() {
        let p = PathBuf::from(&found);
        if p.exists() && p.is_file() {
          return Ok(found);
        }
      }
    }
  }

  // 3) Standard locations + user dirs
  let mut candidates: Vec<PathBuf> = vec![
    PathBuf::from("/usr/local/bin/claude"),
    PathBuf::from("/opt/homebrew/bin/claude"),
    PathBuf::from("/usr/bin/claude"),
    PathBuf::from("/bin/claude"),
  ];

  if let Ok(home) = std::env::var("HOME") {
    candidates.push(PathBuf::from(format!("{}/.claude/local/claude", home)));
    candidates.push(PathBuf::from(format!("{}/.local/bin/claude", home)));
    candidates.push(PathBuf::from(format!("{}/.npm-global/bin/claude", home)));
    candidates.push(PathBuf::from(format!("{}/.yarn/bin/claude", home)));
    candidates.push(PathBuf::from(format!("{}/.bun/bin/claude", home)));
    candidates.push(PathBuf::from(format!("{}/bin/claude", home)));

    // NVM node versions
    let nvm_dir = PathBuf::from(&home).join(".nvm").join("versions").join("node");
    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
      for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
          let candidate = entry.path().join("bin").join("claude");
          candidates.push(candidate);
        }
      }
    }
  }

  for c in candidates {
    if c.exists() && c.is_file() {
      return Ok(c.to_string_lossy().to_string());
    }
  }

  // 4) Fallback to name in PATH
  Ok("claude".to_string())
}

// Create a std::process::Command with inherited env and helpful PATH augmentations.
pub fn create_command_with_env(program: &str) -> Command {
  let mut cmd = Command::new(program);

  // Inherit key env vars
  for (key, value) in std::env::vars() {
    if key == "PATH"
      || key == "HOME"
      || key == "USER"
      || key == "SHELL"
      || key == "LANG"
      || key == "LC_ALL"
      || key.starts_with("LC_")
      || key == "NODE_PATH"
      || key == "NVM_DIR"
      || key == "NVM_BIN"
      || key == "HOMEBREW_PREFIX"
      || key == "HOMEBREW_CELLAR"
      || key == "HTTP_PROXY"
      || key == "HTTPS_PROXY"
      || key == "NO_PROXY"
      || key == "ALL_PROXY"
    {
      cmd.env(&key, &value);
    }
  }

  // If the program is inside an NVM or Homebrew dir, prepend that bin path to PATH
  if let Some(parent) = std::path::Path::new(program).parent() {
    let parent_str = parent.to_string_lossy();
    let path = std::env::var("PATH").unwrap_or_default();
    if !path.contains(parent_str.as_ref()) {
      let new_path = format!("{}:{}", parent_str, path);
      cmd.env("PATH", new_path);
    }
  }

  cmd
}

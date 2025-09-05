use std::process::Command;

#[tauri::command]
pub async fn codex_repo(args: Vec<String>) -> Result<String, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("codex")
            .arg("repo")
            .args(&args)
            .output()
    })
    .await
    .map_err(|e| format!("failed to join codex repo task: {}", e))?
    .map_err(|e| format!("failed to spawn codex repo: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.is_empty() {
            "codex repo failed".into()
        } else {
            stderr
        })
    }
}


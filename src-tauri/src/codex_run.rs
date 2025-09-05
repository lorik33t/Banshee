use std::process::Command;

#[tauri::command]
pub async fn codex_run(args: Vec<String>) -> Result<String, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("codex").arg("run").args(&args).output()
    })
    .await
    .map_err(|e| format!("failed to join codex run task: {}", e))?
    .map_err(|e| format!("failed to spawn codex run: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.is_empty() {
            "codex run failed".into()
        } else {
            stderr
        })
    }
}

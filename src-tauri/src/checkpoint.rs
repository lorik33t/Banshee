use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

use crate::get_session_project_dir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSnapshot {
    pub path: String,
    pub original_content: String,
    pub current_content: String,
    pub checksum: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckpointMetadata {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub name: Option<String>,
    pub checkpoint_type: String,
    pub trigger: Option<String>,
    pub file_count: usize,
    pub git_branch: Option<String>,
    pub git_commit: Option<String>,
}

fn project_root_for(session_id: &str) -> Result<PathBuf, String> {
    match get_session_project_dir(session_id) {
        Some(dir) => {
            let trimmed = dir.trim();
            if trimmed.is_empty() {
                std::env::current_dir().map_err(|e| format!("Failed to resolve current dir: {}", e))
            } else {
                Ok(PathBuf::from(trimmed))
            }
        }
        None => {
            std::env::current_dir().map_err(|e| format!("Failed to resolve current dir: {}", e))
        }
    }
}

fn checkpoints_dir(session_id: &str) -> Result<PathBuf, String> {
    let base = project_root_for(session_id)?;
    Ok(base
        .join(".conductor")
        .join("hartford")
        .join(".checkpoints"))
}

fn ensure_checkpoints_dir(session_id: &str) -> Result<PathBuf, String> {
    let path = checkpoints_dir(session_id)?;
    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|e| format!("Failed to create checkpoints directory: {}", e))?;
    }
    Ok(path)
}

fn checkpoint_dir(session_id: &str, checkpoint_id: &str) -> Result<PathBuf, String> {
    Ok(ensure_checkpoints_dir(session_id)?.join(checkpoint_id))
}

fn resolve_target_path(base: &Path, file_path: &str) -> PathBuf {
    let rel = Path::new(file_path);
    if rel.is_absolute() {
        rel.strip_prefix(base)
            .map(|p| base.join(p))
            .unwrap_or_else(|_| {
                rel.file_name()
                    .map(|name| base.join(name))
                    .unwrap_or_else(|| base.to_path_buf())
            })
    } else {
        base.join(rel)
    }
}

#[command]
pub async fn save_checkpoint_files(
    session_id: String,
    checkpoint_id: String,
    files: Vec<FileSnapshot>,
    trigger: Option<String>,
) -> Result<(), String> {
    let checkpoint_dir = checkpoint_dir(&session_id, &checkpoint_id)?;

    fs::create_dir_all(&checkpoint_dir)
        .map_err(|e| format!("Failed to create checkpoint directory: {}", e))?;

    let git_base = project_root_for(&session_id).ok();

    let metadata = CheckpointMetadata {
        id: checkpoint_id.clone(),
        timestamp: Utc::now(),
        name: None,
        checkpoint_type: "auto".to_string(),
        trigger,
        file_count: files.len(),
        git_branch: git_base.as_ref().and_then(|base| get_git_branch(base).ok()),
        git_commit: git_base.as_ref().and_then(|base| get_git_commit(base).ok()),
    };

    let metadata_path = checkpoint_dir.join("metadata.json");
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    let files_dir = checkpoint_dir.join("files");
    fs::create_dir_all(&files_dir)
        .map_err(|e| format!("Failed to create files directory: {}", e))?;

    for (index, file) in files.iter().enumerate() {
        let safe_name = format!("file_{}.json", index);
        let file_path = files_dir.join(safe_name);

        let file_json = serde_json::to_string_pretty(&file)
            .map_err(|e| format!("Failed to serialize file snapshot: {}", e))?;
        fs::write(file_path, file_json)
            .map_err(|e| format!("Failed to write file snapshot: {}", e))?;

        let content_name = format!("content_{}.txt", index);
        let content_path = files_dir.join(content_name);
        fs::write(content_path, &file.current_content)
            .map_err(|e| format!("Failed to write file content: {}", e))?;
    }

    let mapping: HashMap<String, usize> = files
        .iter()
        .enumerate()
        .map(|(i, f)| (f.path.clone(), i))
        .collect();

    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = serde_json::to_string_pretty(&mapping)
        .map_err(|e| format!("Failed to serialize file mapping: {}", e))?;
    fs::write(mapping_path, mapping_json)
        .map_err(|e| format!("Failed to write file mapping: {}", e))?;

    Ok(())
}

#[command]
pub async fn restore_checkpoint(session_id: String, checkpoint_id: String) -> Result<(), String> {
    let checkpoint_dir = checkpoint_dir(&session_id, &checkpoint_id)?;

    if !checkpoint_dir.exists() {
        return Err(format!("Checkpoint {} not found", checkpoint_id));
    }

    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(&mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;

    let files_dir = checkpoint_dir.join("files");
    let project_base = project_root_for(&session_id)?;
    for (file_path, index) in mapping.iter() {
        let snapshot_path = files_dir.join(format!("file_{}.json", index));
        let snapshot_json = fs::read_to_string(&snapshot_path)
            .map_err(|e| format!("Failed to read file snapshot: {}", e))?;
        let snapshot: FileSnapshot = serde_json::from_str(&snapshot_json)
            .map_err(|e| format!("Failed to parse file snapshot: {}", e))?;

        let target_path = resolve_target_path(&project_base, file_path);

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }

        fs::write(&target_path, &snapshot.original_content)
            .map_err(|e| format!("Failed to restore file {}: {}", file_path, e))?;
    }

    Ok(())
}

#[derive(Serialize)]
pub struct CheckpointFileData {
    pub path: String,
    pub original_content: String,
    pub current_content: String,
}

#[tauri::command]
pub async fn get_checkpoint_file(
    session_id: String,
    checkpoint_id: String,
    file_path: String,
) -> Result<CheckpointFileData, String> {
    let checkpoint_dir = checkpoint_dir(&session_id, &checkpoint_id)?;
    if !checkpoint_dir.exists() {
        return Err(format!("Checkpoint {} not found", checkpoint_id));
    }

    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(&mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;

    let index = mapping
        .get(&file_path)
        .ok_or_else(|| format!("File not found in checkpoint: {}", file_path))?;

    let files_dir = checkpoint_dir.join("files");
    let snapshot_path = files_dir.join(format!("file_{}.json", index));
    let snapshot_json = fs::read_to_string(&snapshot_path)
        .map_err(|e| format!("Failed to read file snapshot: {}", e))?;
    let snapshot: FileSnapshot = serde_json::from_str(&snapshot_json)
        .map_err(|e| format!("Failed to parse file snapshot: {}", e))?;

    Ok(CheckpointFileData {
        path: snapshot.path,
        original_content: snapshot.original_content,
        current_content: snapshot.current_content,
    })
}

#[tauri::command]
pub async fn restore_checkpoint_with_mode(
    session_id: String,
    checkpoint_id: String,
    mode: String,
) -> Result<(), String> {
    let checkpoint_dir = checkpoint_dir(&session_id, &checkpoint_id)?;
    if !checkpoint_dir.exists() {
        return Err(format!("Checkpoint {} not found", checkpoint_id));
    }

    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(&mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;

    let project_base = project_root_for(&session_id)?;
    let files_dir = checkpoint_dir.join("files");
    for (file_path, index) in mapping.iter() {
        let snapshot_path = files_dir.join(format!("file_{}.json", index));
        let snapshot_json = fs::read_to_string(&snapshot_path)
            .map_err(|e| format!("Failed to read file snapshot: {}", e))?;
        let snapshot: FileSnapshot = serde_json::from_str(&snapshot_json)
            .map_err(|e| format!("Failed to parse file snapshot: {}", e))?;

        let target_path = resolve_target_path(&project_base, file_path);

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }

        let content = if mode == "current" {
            &snapshot.current_content
        } else {
            &snapshot.original_content
        };
        fs::write(&target_path, content)
            .map_err(|e| format!("Failed to restore file {}: {}", file_path, e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn restore_checkpoint_files(
    session_id: String,
    checkpoint_id: String,
    files: Vec<String>,
    mode: String,
) -> Result<(), String> {
    let checkpoint_dir = checkpoint_dir(&session_id, &checkpoint_id)?;
    if !checkpoint_dir.exists() {
        return Err(format!("Checkpoint {} not found", checkpoint_id));
    }

    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(&mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;

    let project_base = project_root_for(&session_id)?;
    let files_dir = checkpoint_dir.join("files");
    for file_path in files.iter() {
        if let Some(index) = mapping.get(file_path) {
            let snapshot_path = files_dir.join(format!("file_{}.json", index));
            let snapshot_json = fs::read_to_string(&snapshot_path)
                .map_err(|e| format!("Failed to read file snapshot: {}", e))?;
            let snapshot: FileSnapshot = serde_json::from_str(&snapshot_json)
                .map_err(|e| format!("Failed to parse file snapshot: {}", e))?;

            let target_path = resolve_target_path(&project_base, file_path);

            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
            }

            let content = if mode == "current" {
                &snapshot.current_content
            } else {
                &snapshot.original_content
            };
            fs::write(&target_path, content)
                .map_err(|e| format!("Failed to restore file {}: {}", file_path, e))?;
        } else {
            return Err(format!("File not found in checkpoint: {}", file_path));
        }
    }
    Ok(())
}

#[command]
pub async fn delete_checkpoint(session_id: String, checkpoint_id: String) -> Result<(), String> {
    let dir = checkpoints_dir(&session_id)?;
    let checkpoint_dir = dir.join(&checkpoint_id);

    if checkpoint_dir.exists() {
        fs::remove_dir_all(&checkpoint_dir)
            .map_err(|e| format!("Failed to delete checkpoint: {}", e))?;
    }

    Ok(())
}

#[command]
pub async fn list_checkpoint_files(
    session_id: String,
    checkpoint_id: String,
) -> Result<Vec<String>, String> {
    let dir = checkpoints_dir(&session_id)?;
    let checkpoint_dir = dir.join(&checkpoint_id);

    if !checkpoint_dir.exists() {
        return Err(format!("Checkpoint {} not found", checkpoint_id));
    }

    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;

    Ok(mapping.keys().cloned().collect())
}

#[command]
pub async fn get_checkpoint_metadata(
    session_id: String,
    checkpoint_id: String,
) -> Result<CheckpointMetadata, String> {
    let dir = checkpoints_dir(&session_id)?;
    let checkpoint_dir = dir.join(&checkpoint_id);

    let metadata_path = checkpoint_dir.join("metadata.json");

    let metadata_json = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let metadata: CheckpointMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;

    Ok(metadata)
}

fn get_git_branch(base: &Path) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(base)
        .output()
        .map_err(|e| format!("Failed to run git command: {}", e))?;

    if !output.status.success() {
        return Err("Git command failed".to_string());
    }

    String::from_utf8(output.stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to parse git output: {}", e))
}

fn get_git_commit(base: &Path) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(base)
        .output()
        .map_err(|e| format!("Failed to run git command: {}", e))?;

    if !output.status.success() {
        return Err("Git command failed".to_string());
    }

    String::from_utf8(output.stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to parse git output: {}", e))
}

#[command]
pub async fn get_git_info(session_id: String) -> Result<HashMap<String, String>, String> {
    let mut info = HashMap::new();
    let base = match project_root_for(&session_id) {
        Ok(path) => path,
        Err(err) => {
            eprintln!("get_git_info: {}", err);
            return Ok(info);
        }
    };

    if let Ok(branch) = get_git_branch(&base) {
        info.insert("branch".to_string(), branch);
    }

    if let Ok(commit) = get_git_commit(&base) {
        info.insert("commit".to_string(), commit);
    }

    Ok(info)
}

#[command]
pub async fn clean_old_checkpoints(session_id: String, keep_count: usize) -> Result<(), String> {
    let dir = match checkpoints_dir(&session_id) {
        Ok(path) => path,
        Err(_) => return Ok(()),
    };

    if !dir.exists() {
        return Ok(());
    }

    let mut checkpoints: Vec<(PathBuf, DateTime<Utc>)> = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let metadata_path = entry.path().join("metadata.json");
                if metadata_path.exists() {
                    if let Ok(metadata_json) = fs::read_to_string(&metadata_path) {
                        if let Ok(metadata) =
                            serde_json::from_str::<CheckpointMetadata>(&metadata_json)
                        {
                            checkpoints.push((entry.path(), metadata.timestamp));
                        }
                    }
                }
            }
        }
    }

    checkpoints.sort_by(|a, b| b.1.cmp(&a.1));

    for (path, _) in checkpoints.iter().skip(keep_count) {
        fs::remove_dir_all(path).map_err(|e| format!("Failed to delete old checkpoint: {}", e))?;
    }

    Ok(())
}

#[command]
pub async fn list_checkpoints(session_id: String) -> Result<Vec<CheckpointMetadata>, String> {
    let dir = match checkpoints_dir(&session_id) {
        Ok(path) => path,
        Err(_) => return Ok(Vec::new()),
    };

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut out: Vec<CheckpointMetadata> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let meta_path = entry.path().join("metadata.json");
                if meta_path.exists() {
                    if let Ok(json) = fs::read_to_string(&meta_path) {
                        if let Ok(md) = serde_json::from_str::<CheckpointMetadata>(&json) {
                            out.push(md);
                        }
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(out)
}

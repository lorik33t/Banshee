use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use tauri::command;
use chrono::{DateTime, Utc};

// Use the project directory stored in lib.rs
use crate::PROJECT_DIR;

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

// Get the checkpoints directory
fn get_checkpoints_dir() -> PathBuf {
    let project_dir = PROJECT_DIR.lock().unwrap().clone();
    let base = if project_dir.is_empty() { ".".into() } else { PathBuf::from(project_dir) };
    let path = base.join(".conductor").join("hartford").join(".checkpoints");
    if !path.exists() {
        if let Err(e) = fs::create_dir_all(&path) {
            eprintln!("Failed to create checkpoints directory: {}", e);
        }
    }
    path
}

// Get checkpoint-specific directory
fn get_checkpoint_dir(checkpoint_id: &str) -> PathBuf {
    get_checkpoints_dir().join(checkpoint_id)
}

#[command]
pub async fn save_checkpoint_files(
    checkpoint_id: String,
    files: Vec<FileSnapshot>,
    trigger: Option<String>
) -> Result<(), String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    
    // Create checkpoint directory
    fs::create_dir_all(&checkpoint_dir)
        .map_err(|e| format!("Failed to create checkpoint directory: {}", e))?;
    
    // Save metadata
    let metadata = CheckpointMetadata {
        id: checkpoint_id.clone(),
        timestamp: Utc::now(),
        name: None,
        checkpoint_type: "auto".to_string(),
        trigger,
        file_count: files.len(),
        git_branch: get_git_branch().ok(),
        git_commit: get_git_commit().ok(),
    };
    
    let metadata_path = checkpoint_dir.join("metadata.json");
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;
    
    // Save file snapshots
    let files_dir = checkpoint_dir.join("files");
    fs::create_dir_all(&files_dir)
        .map_err(|e| format!("Failed to create files directory: {}", e))?;
    
    for (index, file) in files.iter().enumerate() {
        // Create a safe filename from the path
        let safe_name = format!("file_{}.json", index);
        let file_path = files_dir.join(safe_name);
        
        // Save file snapshot as JSON
        let file_json = serde_json::to_string_pretty(&file)
            .map_err(|e| format!("Failed to serialize file snapshot: {}", e))?;
        fs::write(file_path, file_json)
            .map_err(|e| format!("Failed to write file snapshot: {}", e))?;
        
        // Also save the actual file content separately for easier access
        let content_name = format!("content_{}.txt", index);
        let content_path = files_dir.join(content_name);
        fs::write(content_path, &file.current_content)
            .map_err(|e| format!("Failed to write file content: {}", e))?;
    }
    
    // Save file mapping for easy lookup
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
pub async fn restore_checkpoint(checkpoint_id: String) -> Result<(), String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    
    if !checkpoint_dir.exists() {
        return Err(format!("Checkpoint {} not found", checkpoint_id));
    }
    
    // Load file mapping
    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;
    
    // Restore each file
    let files_dir = checkpoint_dir.join("files");
    for (file_path, index) in mapping.iter() {
        let snapshot_path = files_dir.join(format!("file_{}.json", index));
        let snapshot_json = fs::read_to_string(snapshot_path)
            .map_err(|e| format!("Failed to read file snapshot: {}", e))?;
        let snapshot: FileSnapshot = serde_json::from_str(&snapshot_json)
            .map_err(|e| format!("Failed to parse file snapshot: {}", e))?;
        
        // Restore the file content to project-scoped path
        let project_dir = PROJECT_DIR.lock().unwrap().clone();
        let base = if project_dir.is_empty() { PathBuf::from(".") } else { PathBuf::from(project_dir) };
        let rel = Path::new(&file_path);
        // If path is absolute and starts with project, strip the prefix; else treat as relative
        let target_path = if rel.is_absolute() {
            match rel.strip_prefix(&base) {
                Ok(p) => base.join(p),
                Err(_) => base.join(rel.file_name().unwrap_or_default()),
            }
        } else {
            base.join(rel)
        };
        
        // Create parent directories if they don't exist
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
        
        // Write the original content back
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
pub async fn get_checkpoint_file(checkpoint_id: String, file_path: String) -> Result<CheckpointFileData, String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    if !checkpoint_dir.exists() { return Err(format!("Checkpoint {} not found", checkpoint_id)); }

    // Load file mapping
    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(&mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;

    let index = mapping.get(&file_path)
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
pub async fn restore_checkpoint_with_mode(checkpoint_id: String, mode: String) -> Result<(), String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    if !checkpoint_dir.exists() { return Err(format!("Checkpoint {} not found", checkpoint_id)); }
    
    // Load file mapping and restore each file
    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(&mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;
    
    for (file_path, index) in mapping.iter() {
        let files_dir = checkpoint_dir.join("files");
        let snapshot_path = files_dir.join(format!("file_{}.json", index));
        let snapshot_json = fs::read_to_string(&snapshot_path)
            .map_err(|e| format!("Failed to read file snapshot: {}", e))?;
        let snapshot: FileSnapshot = serde_json::from_str(&snapshot_json)
            .map_err(|e| format!("Failed to parse file snapshot: {}", e))?;

        let project_dir = PROJECT_DIR.lock().unwrap().clone();
        let base = if project_dir.is_empty() { PathBuf::from(".") } else { PathBuf::from(project_dir) };
        let rel = Path::new(file_path);
        let target_path = if rel.is_absolute() {
            match rel.strip_prefix(&base) { Ok(p) => base.join(p), Err(_) => base.join(rel.file_name().unwrap_or_default()) }
        } else { base.join(rel) };

        if let Some(parent) = target_path.parent() { fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory: {}", e))?; }

        let content = if mode == "current" { &snapshot.current_content } else { &snapshot.original_content };
        fs::write(&target_path, content).map_err(|e| format!("Failed to restore file {}: {}", file_path, e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn restore_checkpoint_files(checkpoint_id: String, files: Vec<String>, mode: String) -> Result<(), String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    if !checkpoint_dir.exists() { return Err(format!("Checkpoint {} not found", checkpoint_id)); }

    let mapping_path = checkpoint_dir.join("file_mapping.json");
    let mapping_json = fs::read_to_string(&mapping_path)
        .map_err(|e| format!("Failed to read file mapping: {}", e))?;
    let mapping: HashMap<String, usize> = serde_json::from_str(&mapping_json)
        .map_err(|e| format!("Failed to parse file mapping: {}", e))?;

    let files_dir = checkpoint_dir.join("files");
    for file_path in files.iter() {
        if let Some(index) = mapping.get(file_path) {
            let snapshot_path = files_dir.join(format!("file_{}.json", index));
            let snapshot_json = fs::read_to_string(&snapshot_path)
                .map_err(|e| format!("Failed to read file snapshot: {}", e))?;
            let snapshot: FileSnapshot = serde_json::from_str(&snapshot_json)
                .map_err(|e| format!("Failed to parse file snapshot: {}", e))?;

            let project_dir = PROJECT_DIR.lock().unwrap().clone();
            let base = if project_dir.is_empty() { PathBuf::from(".") } else { PathBuf::from(project_dir) };
            let rel = Path::new(file_path);
            let target_path = if rel.is_absolute() {
                match rel.strip_prefix(&base) { Ok(p) => base.join(p), Err(_) => base.join(rel.file_name().unwrap_or_default()) }
            } else { base.join(rel) };

            if let Some(parent) = target_path.parent() { fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory: {}", e))?; }

            let content = if mode == "current" { &snapshot.current_content } else { &snapshot.original_content };
            fs::write(&target_path, content).map_err(|e| format!("Failed to restore file {}: {}", file_path, e))?;
        } else {
            return Err(format!("File not found in checkpoint: {}", file_path));
        }
    }
    Ok(())
}

#[command]
pub async fn delete_checkpoint(checkpoint_id: String) -> Result<(), String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    
    if checkpoint_dir.exists() {
        fs::remove_dir_all(checkpoint_dir)
            .map_err(|e| format!("Failed to delete checkpoint: {}", e))?;
    }
    
    Ok(())
}

#[command]
pub async fn list_checkpoint_files(checkpoint_id: String) -> Result<Vec<String>, String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    
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
pub async fn get_checkpoint_metadata(checkpoint_id: String) -> Result<CheckpointMetadata, String> {
    let checkpoint_dir = get_checkpoint_dir(&checkpoint_id);
    let metadata_path = checkpoint_dir.join("metadata.json");
    
    let metadata_json = fs::read_to_string(metadata_path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let metadata: CheckpointMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;
    
    Ok(metadata)
}

// Helper functions for git info
fn get_git_branch() -> Result<String, String> {
    use std::process::Command;
    
    let output = Command::new("git")
        .args(&["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to run git command: {}", e))?;
    
    if !output.status.success() {
        return Err("Git command failed".to_string());
    }
    
    String::from_utf8(output.stdout)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to parse git output: {}", e))
}

fn get_git_commit() -> Result<String, String> {
    use std::process::Command;
    
    let output = Command::new("git")
        .args(&["rev-parse", "HEAD"])
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
pub async fn get_git_info() -> Result<HashMap<String, String>, String> {
    let mut info = HashMap::new();
    
    if let Ok(branch) = get_git_branch() {
        info.insert("branch".to_string(), branch);
    }
    
    if let Ok(commit) = get_git_commit() {
        info.insert("commit".to_string(), commit);
    }
    
    Ok(info)
}

#[command]
pub async fn clean_old_checkpoints(keep_count: usize) -> Result<(), String> {
    let checkpoints_dir = get_checkpoints_dir();
    
    // Get all checkpoint directories with their metadata
    let mut checkpoints: Vec<(PathBuf, DateTime<Utc>)> = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&checkpoints_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let metadata_path = entry.path().join("metadata.json");
                if metadata_path.exists() {
                    if let Ok(metadata_json) = fs::read_to_string(&metadata_path) {
                        if let Ok(metadata) = serde_json::from_str::<CheckpointMetadata>(&metadata_json) {
                            checkpoints.push((entry.path(), metadata.timestamp));
                        }
                    }
                }
            }
        }
    }
    
    // Sort by timestamp (newest first)
    checkpoints.sort_by(|a, b| b.1.cmp(&a.1));
    
    // Delete old checkpoints
    for (path, _) in checkpoints.iter().skip(keep_count) {
        fs::remove_dir_all(path)
            .map_err(|e| format!("Failed to delete old checkpoint: {}", e))?;
    }
    
    Ok(())
}

#[command]
pub async fn list_checkpoints() -> Result<Vec<CheckpointMetadata>, String> {
    let checkpoints_dir = get_checkpoints_dir();
    let mut out: Vec<CheckpointMetadata> = Vec::new();
    if let Ok(entries) = fs::read_dir(&checkpoints_dir) {
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
    // Newest first
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(out)
}

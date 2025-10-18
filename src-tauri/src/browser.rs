use once_cell::sync::Lazy;
use serde::Deserialize;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::command;
use tempfile::Builder as TempDirBuilder;
use which::which;

static BROWSER_STATE: Lazy<Mutex<BrowserRuntimeState>> =
    Lazy::new(|| Mutex::new(BrowserRuntimeState::new()));

struct BrowserRuntimeState {
    child: Option<Child>,
    temp_profile: Option<PathBuf>,
    current_url: Option<String>,
}

impl BrowserRuntimeState {
    fn new() -> Self {
        Self {
            child: None,
            temp_profile: None,
            current_url: None,
        }
    }
}

#[command]
pub async fn start_browser_session(url: Option<String>) -> Result<(), String> {
    let mut state = BROWSER_STATE
        .lock()
        .map_err(|err| format!("Failed to acquire browser state: {err}"))?;

    if state.child.is_some() {
        if let Some(target) = url {
            navigate_internal(&mut state, target)?;
        }
        return Ok(());
    }

    let chrome_path =
        locate_browser_binary().ok_or_else(|| "Unable to locate a Chromium-based browser".to_string())?;

    let temp_dir = TempDirBuilder::new()
        .prefix("banshee-webview")
        .tempdir()
        .map_err(|err| format!("Failed to create temporary profile: {err}"))?;
    #[allow(deprecated)]
    let profile_path = temp_dir.into_path();

    let target_url = url.unwrap_or_else(|| "about:blank".to_string());

    let mut command = Command::new(&chrome_path);
    command
        .arg(format!("--user-data-dir={}", profile_path.display()))
        .arg("--app=")
        .arg(&target_url)
        .arg("--new-window")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "linux")]
    {
        command.arg("--class=BansheeWebview");
    }

    #[cfg(target_os = "macos")]
    {
        command.arg("--args");
    }

    let child = command
        .spawn()
        .map_err(|err| format!("Failed to launch Chromium ({chrome_path:?}): {err}"))?;

    state.child = Some(child);
    state.temp_profile = Some(profile_path);
    state.current_url = Some(target_url);
    Ok(())
}

#[command]
pub async fn stop_browser_session() -> Result<(), String> {
    let mut state = BROWSER_STATE
        .lock()
        .map_err(|err| format!("Failed to acquire browser state: {err}"))?;

    cleanup_state(&mut state);
    Ok(())
}

#[command]
pub async fn browser_navigate(url: String) -> Result<(), String> {
    let mut state = BROWSER_STATE
        .lock()
        .map_err(|err| format!("Failed to acquire browser state: {err}"))?;

    if state.child.is_none() {
        return Err("Browser session not started".into());
    }

    navigate_internal(&mut state, url)
}

#[command]
pub async fn browser_status() -> Result<(bool, Option<String>), String> {
    let mut state = BROWSER_STATE
        .lock()
        .map_err(|err| format!("Failed to acquire browser state: {err}"))?;

    if let Some(child) = state.child.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => {
                cleanup_state(&mut state);
            }
            Ok(None) => {}
        }
    }

    Ok((state.child.is_some(), state.current_url.clone()))
}

fn navigate_internal(state: &mut BrowserRuntimeState, url: String) -> Result<(), String> {
    let chrome_path = locate_browser_binary().ok_or_else(|| "Unable to locate a Chromium-based browser".to_string())?;

    let mut command = Command::new(&chrome_path);
    command.args(["--new-tab", &url]);
    #[cfg(target_os = "macos")]
    {
        command.arg("--args");
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Failed to issue navigation command: {err}"))?;

    state.current_url = Some(url);
    Ok(())
}

fn cleanup_state(state: &mut BrowserRuntimeState) {
    if let Some(mut child) = state.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(dir) = state.temp_profile.take() {
        let _ = fs::remove_dir_all(dir);
    }
    state.current_url = None;
}

fn locate_browser_binary() -> Option<PathBuf> {
    if let Ok(path) = env::var("BANSHEE_CHROMIUM_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let candidates = candidate_browser_paths();
    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    let names = [
        "google-chrome",
        "google-chrome-stable",
        "google-chrome-beta",
        "chromium",
        "chromium-browser",
        "msedge",
        "brave-browser",
    ];

    for name in names {
        if let Ok(path) = which(name) {
            return Some(path);
        }
    }

    None
}

fn candidate_browser_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ));
        paths.push(PathBuf::from(
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        ));
        paths.push(PathBuf::from(
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ));
        if let Ok(home) = env::var("HOME") {
            paths.push(
                Path::new(&home)
                    .join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            );
            paths.push(
                Path::new(&home)
                    .join("Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"),
            );
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(program_files) = env::var("PROGRAMFILES") {
            paths.push(Path::new(&program_files).join("Google/Chrome/Application/chrome.exe"));
            paths.push(Path::new(&program_files).join("Microsoft/Edge/Application/msedge.exe"));
        }
        if let Ok(program_files) = env::var("PROGRAMFILES(X86)") {
            paths.push(Path::new(&program_files).join("Google/Chrome/Application/chrome.exe"));
            paths.push(Path::new(&program_files).join("Microsoft/Edge/Application/msedge.exe"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        paths.push(PathBuf::from("/usr/bin/google-chrome"));
        paths.push(PathBuf::from("/usr/bin/google-chrome-stable"));
        paths.push(PathBuf::from("/usr/bin/google-chrome-beta"));
        paths.push(PathBuf::from("/usr/bin/chromium"));
        paths.push(PathBuf::from("/usr/bin/chromium-browser"));
        paths.push(PathBuf::from("/snap/bin/chromium"));
    }

    paths
}

#[derive(Debug, Deserialize)]
pub struct WebViewRequest {
    url: String,
}

#[command]
pub async fn webview_create(url: String) -> Result<(), String> {
    start_browser_session(Some(url)).await
}

#[command]
pub async fn webview_navigate(request: WebViewRequest) -> Result<(), String> {
    browser_navigate(request.url).await
}

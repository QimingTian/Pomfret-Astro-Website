//! Windows-only platform helpers (Station ships on Windows only — NINA has no Mac build).

use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const AUTOSTART_REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_VALUE: &str = "BoreanAstroStation";

fn hidden_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn nina_install_dir_from_exe(exe: &Path) -> Option<PathBuf> {
    exe.parent().map(|p| p.to_path_buf())
}

fn find_nina_exe_in_dir(dir: &Path, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let direct = dir.join("NINA.exe");
    if direct.is_file() {
        return nina_install_dir_from_exe(&direct);
    }
    let entries = fs_read_dir(dir)?;
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_nina_exe_in_dir(&path, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn fs_read_dir(dir: &Path) -> Result<Vec<std::fs::DirEntry>, String> {
    std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read {}: {e}", dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn scan_nina_install_dir() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(pf) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(pf));
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(pf86));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs"));
    }

    for letter in b'C'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if !Path::new(&root).exists() {
            continue;
        }
        for sub in ["Program Files", "Program Files (x86)"] {
            let dir = PathBuf::from(&root).join(sub);
            if dir.is_dir() && !candidates.iter().any(|c| c == &dir) {
                candidates.push(dir);
            }
        }
    }

    for dir in candidates {
        if let Some(install_dir) = find_nina_exe_in_dir(&dir, 5) {
            return Ok(install_dir);
        }
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        let users_programs = PathBuf::from(profile).join("AppData").join("Local").join("Programs");
        if let Some(install_dir) = find_nina_exe_in_dir(&users_programs, 4) {
            return Ok(install_dir);
        }
    }

    Err("NINA.exe not found on this PC. Install NINA or set the directory manually in Settings.".into())
}

pub fn python_available() -> bool {
    for cmd in ["py", "python", "python3"] {
        let mut command = hidden_cmd(cmd);
        if cmd == "py" {
            command.args(["-3", "--version"]);
        } else {
            command.arg("--version");
        }
        if command.output().map(|o| o.status.success()).unwrap_or(false) {
            return true;
        }
    }
    false
}

pub fn install_python() -> Result<(), String> {
    if python_available() {
        return Ok(());
    }

    append_install_log("Installing Python 3.12 via winget…");
    let winget = hidden_cmd("winget").args([
        "install",
        "-e",
        "--id",
        "Python.Python.3.12",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--silent",
    ]);
    let output = winget
        .output()
        .map_err(|e| format!("Could not run winget: {e}. Install Python 3.12 from python.org."))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    append_install_log(&format!("winget stdout: {stdout}"));
    if !stderr.trim().is_empty() {
        append_install_log(&format!("winget stderr: {stderr}"));
    }

    if !output.status.success() && !python_available() {
        return Err(
            "Automatic Python install failed. Install Python 3.12 from https://www.python.org/downloads/windows/ and enable the py launcher."
                .into(),
        );
    }

    if !python_available() {
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
    if !python_available() {
        return Err("Python install finished but py/python is still not available. Restart Station or log out and back in.".into());
    }
    Ok(())
}

fn append_install_log(line: &str) {
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        let log = PathBuf::from(base)
            .join("BoreanAstro")
            .join("Station")
            .join("agent.log");
        let _ = std::fs::create_dir_all(log.parent().unwrap_or(Path::new(".")));
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
        {
            let _ = writeln!(f, "[station-ui] {line}");
        }
    }
}

pub fn autostart_is_active() -> bool {
    hidden_cmd("reg")
        .args(["query", AUTOSTART_REG_KEY, "/v", AUTOSTART_VALUE])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn enable_autostart(exe_path: &Path) -> Result<(), String> {
    if !exe_path.is_file() {
        return Err(format!("Station executable not found: {}", exe_path.display()));
    }
    let quoted = format!("\"{}\"", exe_path.display());
    let output = hidden_cmd("reg")
        .args([
            "add",
            AUTOSTART_REG_KEY,
            "/v",
            AUTOSTART_VALUE,
            "/t",
            "REG_SZ",
            "/d",
            &quoted,
            "/f",
        ])
        .output()
        .map_err(|e| format!("Could not update registry: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Registry autostart failed: {stderr}"));
    }
    Ok(())
}

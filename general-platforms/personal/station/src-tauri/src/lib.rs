use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri::path::BaseDirectory;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationConfig {
    pub hub_base_url: String,
    pub nina_install_dir: String,
    pub jobs_dir: String,
    pub nina_output_dir: String,
    pub imaging_queue_secret: String,
    pub r2_enabled: bool,
    pub autostart_enabled: bool,
    pub python_path: String,
}

impl Default for StationConfig {
    fn default() -> Self {
        Self {
            hub_base_url: "http://127.0.0.1:7841".into(),
            nina_install_dir: r"C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy".into(),
            jobs_dir: r"C:\Users\Observatory\Downloads\NinaJobs".into(),
            nina_output_dir: r"C:\Users\Observatory\Documents\N.I.N.A".into(),
            imaging_queue_secret: String::new(),
            r2_enabled: false,
            autostart_enabled: false,
            python_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

pub struct AgentState {
    pub child: Mutex<Option<Child>>,
}

fn station_data_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        let base = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| PathBuf::from(".").to_string_lossy().into_owned());
        PathBuf::from(base).join("PomfretAstro").join("Station")
    } else {
        dirs_home().join(".pomfretastro").join("station")
    }
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn config_path() -> PathBuf {
    station_data_dir().join("station-config.json")
}

fn log_path() -> PathBuf {
    station_data_dir().join("agent.log")
}

fn ensure_data_dir() -> Result<(), String> {
    fs::create_dir_all(station_data_dir()).map_err(|e| e.to_string())
}

fn agent_script_path(app: &AppHandle) -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent/nina_agent.py");
    if dev.exists() {
        return dev;
    }
    if let Ok(path) = app
        .path()
        .resolve("agent/nina_agent.py", BaseDirectory::Resource)
    {
        if path.exists() {
            return path;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let beside_exe = dir.join("agent").join("nina_agent.py");
            if beside_exe.exists() {
                return beside_exe;
            }
        }
    }
    PathBuf::from("agent/nina_agent.py")
}

fn python_probe(cmd: &str) -> bool {
    let mut command = Command::new(cmd);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        if cmd == "py" {
            command.args(["-3", "--version"]);
        } else {
            command.arg("--version");
        }
    }
    #[cfg(not(windows))]
    {
        command.arg("--version");
    }
    command
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn resolve_python(config: &StationConfig) -> String {
    if !config.python_path.trim().is_empty() {
        return config.python_path.trim().to_string();
    }
    #[cfg(windows)]
    let candidates = ["py", "python", "python3"];
    #[cfg(not(windows))]
    let candidates = ["python3", "python", "py"];
    for cmd in candidates {
        if python_probe(cmd) {
            return cmd.to_string();
        }
    }
    #[cfg(windows)]
    return "py".to_string();
    #[cfg(not(windows))]
    return "python3".to_string();
}

fn append_log(line: &str) {
    let _ = ensure_data_dir();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(f, "{}", line);
    }
}

fn read_log_tail(max_bytes: usize) -> String {
    let path = log_path();
    let Ok(meta) = fs::metadata(&path) else {
        return String::new();
    };
    let len = meta.len() as usize;
    let start = len.saturating_sub(max_bytes);
    let mut f = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    if start > 0 {
        use std::io::Seek;
        let _ = f.seek(std::io::SeekFrom::Start(start as u64));
    }
    let mut buf = String::new();
    let _ = f.read_to_string(&mut buf);
    buf
}

fn hub_health_url(base: &str) -> String {
    format!("{}/api/health", base.trim().trim_end_matches('/'))
}

fn probe_url(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(2)).build();
    match agent.get(url).call() {
        Ok(resp) => {
            if resp.status() >= 400 {
                return Err(format!("HTTP {}", resp.status()));
            }
            Ok(String::new())
        }
        Err(e) => Err(e.to_string()),
    }
}

fn local_ipv4_addresses() -> Vec<String> {
    fn collect() -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(addrs) = get_if_addrs::get_if_addrs() {
            for iface in addrs {
                if iface.is_loopback() {
                    continue;
                }
                if let get_if_addrs::IfAddr::V4(v4) = iface.addr {
                    out.push(v4.ip.to_string());
                }
            }
        }
        out.sort();
        out.dedup();
        out
    }

    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = tx.send(collect());
    });
    rx.recv_timeout(Duration::from_millis(1500)).unwrap_or_default()
}

fn nina_process_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("tasklist");
        command
            .args(["/FI", "IMAGENAME eq NINA.exe", "/NH"])
            .creation_flags(0x08000000);
        command
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("NINA.exe"))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("pgrep")
            .arg("-x")
            .arg("NINA")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

fn build_checks(config: &StationConfig, agent_running: bool, script: &Path) -> Vec<CheckItem> {
    let mut checks = Vec::new();

    let nina_exe = Path::new(&config.nina_install_dir).join("NINA.exe");
    checks.push(CheckItem {
        id: "nina_installed".into(),
        label: "NINA installed".into(),
        status: if nina_exe.exists() { "ok" } else { "error" }.into(),
        detail: if nina_exe.exists() {
            nina_exe.display().to_string()
        } else {
            format!("Not found: {}", nina_exe.display())
        },
    });

    let script = script.to_path_buf();
    checks.push(CheckItem {
        id: "agent_core".into(),
        label: "Agent core (nina_agent.py)".into(),
        status: if script.exists() { "ok" } else { "error" }.into(),
        detail: script.display().to_string(),
    });

    checks.push(CheckItem {
        id: "agent_running".into(),
        label: "Agent process".into(),
        status: if agent_running { "ok" } else { "warn" }.into(),
        detail: if agent_running {
            "Running".into()
        } else {
            "Stopped".into()
        },
    });

    checks.push(CheckItem {
        id: "autostart".into(),
        label: "Start at login / boot".into(),
        status: if config.autostart_enabled {
            "ok"
        } else {
            "warn"
        }
        .into(),
        detail: if config.autostart_enabled {
            "Enabled in settings (Windows service installer pending)".into()
        } else {
            "Not enabled".into()
        },
    });

    let ips = local_ipv4_addresses();
    checks.push(CheckItem {
        id: "network".into(),
        label: "Network interfaces".into(),
        status: if ips.is_empty() { "warn" } else { "ok" }.into(),
        detail: if ips.is_empty() {
            "No LAN IPv4 detected".into()
        } else {
            format!("LAN: {} — Hub URL for remote Control: http://<ip>:7841", ips.join(", "))
        },
    });

    match probe_url(&hub_health_url(&config.hub_base_url)) {
        Ok(_) => checks.push(CheckItem {
            id: "hub".into(),
            label: "Personal Hub".into(),
            status: "ok".into(),
            detail: format!("{} reachable", config.hub_base_url.trim()),
        }),
        Err(e) => checks.push(CheckItem {
            id: "hub".into(),
            label: "Personal Hub".into(),
            status: "error".into(),
            detail: format!("{} — {}", config.hub_base_url.trim(), e),
        }),
    }

    let py = resolve_python(config);
    let py_ok = python_probe(&py);
    checks.push(CheckItem {
        id: "python".into(),
        label: "Python runtime".into(),
        status: if py_ok { "ok" } else { "error" }.into(),
        detail: if py_ok {
            format!("Using `{py}`")
        } else {
            "Python not found — set path in settings".into()
        },
    });

    checks.push(CheckItem {
        id: "nina_running".into(),
        label: "NINA process".into(),
        status: if nina_process_running() { "ok" } else { "warn" }.into(),
        detail: if nina_process_running() {
            "NINA.exe is running".into()
        } else {
            "Not running (idle)".into()
        },
    });

    if config.r2_enabled {
        checks.push(CheckItem {
            id: "r2".into(),
            label: "Cloudflare R2 (raw_zip)".into(),
            status: "warn".into(),
            detail: "Set R2_* env vars on this PC when using raw_zip uploads".into(),
        });
    }

    checks
}

fn read_config_file() -> Result<StationConfig, String> {
    ensure_data_dir()?;
    let path = config_path();
    if !path.exists() {
        let cfg = StationConfig::default();
        write_config_file(cfg.clone())?;
        return Ok(cfg);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_config_file(config: StationConfig) -> Result<(), String> {
    ensure_data_dir()?;
    let normalized = StationConfig {
        hub_base_url: config.hub_base_url.trim().trim_end_matches('/').to_string(),
        ..config
    };
    let raw = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(config_path(), raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn station_load_config() -> Result<StationConfig, String> {
    read_config_file()
}

#[tauri::command]
fn station_save_config(config: StationConfig) -> Result<(), String> {
    write_config_file(config)
}

fn agent_is_running_locked(state: &AgentState) -> Result<bool, String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if let Ok(Some(_code)) = child.try_wait() {
            *guard = None;
            return Ok(false);
        }
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn station_run_diagnostics(
    state: State<'_, AgentState>,
    app: AppHandle,
) -> Result<Vec<CheckItem>, String> {
    let cfg = read_config_file()?;
    let running = agent_is_running_locked(&state)?;
    let script = agent_script_path(&app);
    tauri::async_runtime::spawn_blocking(move || build_checks(&cfg, running, &script))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn station_read_agent_logs() -> Result<String, String> {
    Ok(read_log_tail(128_000))
}

#[tauri::command]
fn station_agent_is_running(state: State<AgentState>) -> Result<bool, String> {
    agent_is_running_locked(&state)
}

#[tauri::command]
async fn station_start_agent(state: State<'_, AgentState>, app: AppHandle) -> Result<(), String> {
    if agent_is_running_locked(&state)? {
        return Err("Agent is already running".into());
    }

    let cfg = read_config_file()?;
    let script = agent_script_path(&app);
    if !script.exists() {
        return Err(format!("Agent script not found: {}", script.display()));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let python = resolve_python(&cfg);
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        append_log(&format!("[station-ui {ts}] Starting agent via {python} {script:?}"));

        let mut cmd = Command::new(&python);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        if python == "py" {
            cmd.arg("-3");
        }
        cmd.arg(&script)
            .env("POMFRET_HUB_BASE_URL", &cfg.hub_base_url)
            .env(
                "PERSONAL_R2_ENABLED",
                if cfg.r2_enabled { "1" } else { "0" },
            )
            .env("POMFRET_NINA_INSTALL_DIR", &cfg.nina_install_dir)
            .env("POMFRET_JOBS_DIR", &cfg.jobs_dir)
            .env("POMFRET_NINA_OUTPUT_DIR", &cfg.nina_output_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if !cfg.imaging_queue_secret.trim().is_empty() {
            cmd.env("IMAGING_QUEUE_SECRET", cfg.imaging_queue_secret.trim());
        }

        let mut child = cmd.spawn().map_err(|e| e.to_string())?;

        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    append_log(&line);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    append_log(&format!("[stderr] {line}"));
                }
            });
        }

        Ok::<Child, String>(child)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|child| {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
        Ok(())
    })?
}

#[tauri::command]
fn station_stop_agent(state: State<AgentState>) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        append_log("[station-ui] Agent stop requested");
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            station_load_config,
            station_save_config,
            station_run_diagnostics,
            station_read_agent_logs,
            station_agent_is_running,
            station_start_agent,
            station_stop_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

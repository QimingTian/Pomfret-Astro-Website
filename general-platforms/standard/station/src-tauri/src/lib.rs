use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
mod platform_windows;

#[cfg(not(windows))]
mod platform_windows {
    use std::path::{Path, PathBuf};

    pub fn scan_nina_install_dir() -> Result<PathBuf, String> {
        Err("This action is only available in the Windows Station app.".into())
    }

    pub fn install_python() -> Result<(), String> {
        Err("This action is only available in the Windows Station app.".into())
    }

    pub fn autostart_is_active() -> bool {
        false
    }

    pub fn enable_autostart(_exe_path: &Path) -> Result<(), String> {
        Err("This action is only available in the Windows Station app.".into())
    }
}

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri::path::BaseDirectory;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTenantInfo {
    pub tenant_id: String,
    pub api_base_url: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationConfig {
    pub nina_install_dir: String,
    pub jobs_dir: String,
    pub nina_output_dir: String,
    pub r2_enabled: bool,
    pub autostart_enabled: bool,
    pub python_path: String,
}

impl Default for StationConfig {
    fn default() -> Self {
        default_station_config()
    }
}

fn windows_profile_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE").ok().map(PathBuf::from)
}

fn default_station_config() -> StationConfig {
    #[cfg(windows)]
    if let Some(home) = windows_profile_dir() {
        return StationConfig {
            nina_install_dir: r"C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy".into(),
            jobs_dir: home.join("Downloads").join("NinaJobs").to_string_lossy().into_owned(),
            nina_output_dir: home.join("Documents").join("N.I.N.A").to_string_lossy().into_owned(),
            r2_enabled: false,
            autostart_enabled: false,
            python_path: String::new(),
        };
    }
    StationConfig {
        nina_install_dir: r"C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy".into(),
        jobs_dir: "Downloads/NinaJobs".into(),
        nina_output_dir: "Documents/N.I.N.A".into(),
        r2_enabled: false,
        autostart_enabled: false,
        python_path: String::new(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BakedTenantFile {
    tenant_id: String,
    api_base_url: String,
    api_secret: String,
    display_name: Option<String>,
}

fn user_tenant_path() -> PathBuf {
    station_data_dir()
        .parent()
        .map(|dir| dir.join("tenant.json"))
        .unwrap_or_else(|| dirs_home().join(".boreanastro").join("tenant.json"))
}

fn read_user_tenant_raw() -> Option<BakedTenantFile> {
    let path = user_tenant_path();
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_tenant_config(raw: &BakedTenantFile) -> Result<(), String> {
    if raw.tenant_id.trim().is_empty()
        || raw.api_base_url.trim().is_empty()
        || raw.api_secret.trim().is_empty()
    {
        return Err("License is missing tenantId, apiBaseUrl, or apiSecret.".into());
    }
    let dest = user_tenant_path();
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create license directory: {e}"))?;
    }
    let serialized =
        serde_json::to_string_pretty(raw).map_err(|e| format!("Could not serialize license: {e}"))?;
    fs::write(&dest, serialized).map_err(|e| format!("Could not install license file: {e}"))?;
    Ok(())
}

fn parse_api_error(status: u16, body: &str) -> String {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(error) = json.get("error").and_then(|value| value.as_str()) {
            return error.to_string();
        }
    }
    format!("HTTP {status}")
}

fn activate_account(
    api_base_url: String,
    login: String,
    password: String,
) -> Result<BakedTenantFile, String> {
    let base = api_base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("Cloud hub URL is required.".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .build();

    let login_payload = serde_json::json!({
        "login": login.trim(),
        "password": password,
        "client": "app",
    })
    .to_string();
    let login_response = agent
        .post(&format!("{base}/api/auth/login"))
        .set("Content-Type", "application/json")
        .set("X-Borean-Client", "app")
        .send_string(&login_payload)
        .map_err(|e| e.to_string())?;

    let login_status = login_response.status();
    let login_body = login_response.into_string().map_err(|e| e.to_string())?;
    if login_status >= 400 {
        return Err(parse_api_error(login_status, &login_body));
    }

    let login_json: serde_json::Value =
        serde_json::from_str(&login_body).map_err(|e| format!("Invalid login response: {e}"))?;
    if login_json.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err(login_json
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("Sign in failed.")
            .to_string());
    }
    let token = login_json
        .get("sessionToken")
        .and_then(|value| value.as_str())
        .ok_or("Sign in succeeded but no session token was returned.")?;

    let license_response = agent
        .get(&format!("{base}/api/member/license"))
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| e.to_string())?;

    let license_status = license_response.status();
    let license_body = license_response.into_string().map_err(|e| e.to_string())?;
    if license_status >= 400 {
        return Err(parse_api_error(license_status, &license_body));
    }

    let license_json: serde_json::Value =
        serde_json::from_str(&license_body).map_err(|e| format!("Invalid license response: {e}"))?;
    let tenant_value = license_json
        .get("tenantConfig")
        .ok_or("License response did not include tenantConfig.")?;
    serde_json::from_value(tenant_value.clone())
        .map_err(|e| format!("Invalid tenant license payload: {e}"))
}

fn tenant_info_from(raw: &BakedTenantFile) -> PersonalTenantInfo {
    PersonalTenantInfo {
        tenant_id: raw.tenant_id.trim().to_string(),
        api_base_url: raw.api_base_url.trim().trim_end_matches('/').to_string(),
        display_name: raw
            .display_name
            .as_ref()
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| raw.tenant_id.clone()),
    }
}

#[tauri::command]
fn station_has_user_license() -> Result<bool, String> {
    Ok(read_user_tenant_raw().is_some())
}

#[tauri::command]
fn station_activate_account(
    api_base_url: String,
    login: String,
    password: String,
) -> Result<PersonalTenantInfo, String> {
    let raw = activate_account(api_base_url, login, password)?;
    save_tenant_config(&raw)?;
    Ok(tenant_info_from(&raw))
}

fn baked_tenant_file() -> Result<BakedTenantFile, String> {
    if let Some(user) = read_user_tenant_raw() {
        return Ok(user);
    }
    serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/tenant_config.json")))
        .map_err(|e| format!("Invalid baked tenant config: {e}"))
}

fn baked_tenant_info() -> Result<PersonalTenantInfo, String> {
    let raw = baked_tenant_file()?;
    Ok(PersonalTenantInfo {
        tenant_id: raw.tenant_id.trim().to_string(),
        api_base_url: raw.api_base_url.trim().trim_end_matches('/').to_string(),
        display_name: raw
            .display_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| raw.tenant_id.clone()),
    })
}

fn baked_api_secret() -> Result<String, String> {
    Ok(baked_tenant_file()?.api_secret.trim().to_string())
}

fn tenant_health_url() -> Result<String, String> {
    let t = baked_tenant_info()?;
    Ok(format!(
        "{}/api/personal/{}/health",
        t.api_base_url, t.tenant_id
    ))
}

fn tenant_station_version_url() -> Result<String, String> {
    let t = baked_tenant_info()?;
    Ok(format!(
        "{}/api/personal/{}/station/version",
        t.api_base_url, t.tenant_id
    ))
}

fn station_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StationVersionResponse {
    latest_version: String,
    download_url: Option<String>,
}

fn fetch_station_version_manifest() -> Result<StationVersionResponse, String> {
    let url = tenant_station_version_url()?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(3))
        .build();
    let response = agent.get(&url).call().map_err(|e| e.to_string())?;
    if response.status() >= 400 {
        return Err(format!("HTTP {}", response.status()));
    }
    let body: StationVersionResponse = response
        .into_string()
        .map_err(|e| e.to_string())
        .and_then(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))?;
    Ok(body)
}

fn fetch_latest_station_version() -> Result<String, String> {
    fetch_station_version_manifest().map(|body| body.latest_version.trim().to_string())
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let left_parts = parse_version_parts(left);
    let right_parts = parse_version_parts(right);
    let len = left_parts.len().max(right_parts.len());
    for index in 0..len {
        let left_value = *left_parts.get(index).unwrap_or(&0);
        let right_value = *right_parts.get(index).unwrap_or(&0);
        match left_value.cmp(&right_value) {
            std::cmp::Ordering::Equal => {}
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

fn repair_personal_paths(config: &mut StationConfig) {
    let Some(home) = windows_profile_dir() else {
        return;
    };
    if config.jobs_dir.contains("\\Observatory\\") {
        config.jobs_dir = home.join("Downloads").join("NinaJobs").to_string_lossy().into_owned();
    }
    if config.nina_output_dir.contains("\\Observatory\\") {
        config.nina_output_dir = home
            .join("Documents")
            .join("N.I.N.A")
            .to_string_lossy()
            .into_owned();
    }
}

fn ensure_agent_dirs(config: &StationConfig) -> Result<(), String> {
    for label_dir in [
        ("Jobs directory", config.jobs_dir.as_str()),
        ("NINA output directory", config.nina_output_dir.as_str()),
    ] {
        let (label, dir) = label_dir;
        if dir.trim().is_empty() {
            return Err(format!("{label} is empty — set it in Settings"));
        }
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create {label} ({dir}): {e}"))?;
    }
    Ok(())
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
        PathBuf::from(base).join("BoreanAstro").join("Station")
    } else {
        dirs_home().join(".boreanastro").join("station")
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
    #[cfg(windows)]
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
    #[cfg(not(windows))]
    {
        false
    }
}

fn build_checks(config: &StationConfig, agent_running: bool) -> Vec<CheckItem> {
    let mut checks = Vec::new();
    let nina_exe = Path::new(&config.nina_install_dir).join("NINA.exe");
    checks_push(
        &mut checks,
        "nina_installed",
        "NINA installed",
        nina_exe.exists(),
        "NINA installation not found",
    );

    checks_push(
        &mut checks,
        "nina_running",
        "NINA running",
        nina_process_running(),
        "NINA is not running",
    );

    checks_push(
        &mut checks,
        "agent_running",
        "NINA agent running",
        agent_running,
        "Agent is not running",
    );

    let py = resolve_python(config);
    checks_push(
        &mut checks,
        "python",
        "Python installed",
        python_probe(&py),
        "Python not found",
    );

    checks_push(
        &mut checks,
        "autostart",
        "Station start at login",
        platform_windows::autostart_is_active(),
        "Autostart is not enabled",
    );

    let network_ok = !local_ipv4_addresses().is_empty();
    checks_push(
        &mut checks,
        "network",
        "Network connection",
        network_ok,
        "No network interface detected",
    );

    let hub_ok = tenant_health_url()
        .ok()
        .and_then(|url| probe_url(&url).ok())
        .is_some();
    checks_push(
        &mut checks,
        "hub",
        "Hub connected",
        hub_ok,
        "Cannot reach cloud hub",
    );

    push_station_version_check(&mut checks);

    checks
}

fn push_station_version_check(checks: &mut Vec<CheckItem>) {
    let installed = station_app_version();
    match fetch_latest_station_version() {
        Ok(latest) => {
            let ordering = compare_versions(installed, &latest);
            let detail = match ordering {
                std::cmp::Ordering::Less => {
                    format!("Installed v{installed} · Latest v{latest} · Update available")
                }
                std::cmp::Ordering::Greater => {
                    format!("Installed v{installed} · Latest v{latest} · Ahead of published release")
                }
                std::cmp::Ordering::Equal => {
                    format!("Installed v{installed} · Latest v{latest} · Up to date")
                }
            };
            checks.push(CheckItem {
                id: "station_version".into(),
                label: "Station version".into(),
                status: if ordering == std::cmp::Ordering::Less {
                    "warning".into()
                } else {
                    "ok".into()
                },
                detail,
            });
        }
        Err(error) => {
            checks.push(CheckItem {
                id: "station_version".into(),
                label: "Station version".into(),
                status: "warning".into(),
                detail: format!("Installed v{installed} · Could not check for updates ({error})"),
            });
        }
    }
}

fn checks_push(checks: &mut Vec<CheckItem>, id: &str, label: &str, ok: bool, fail_detail: &str) {
    checks.push(CheckItem {
        id: id.into(),
        label: label.into(),
        status: if ok { "ok" } else { "error" }.into(),
        detail: if ok { String::new() } else { fail_detail.into() },
    });
}

fn read_config_file() -> Result<StationConfig, String> {
    ensure_data_dir()?;
    let path = config_path();
    if !path.exists() {
        let cfg = default_station_config();
        write_config_file(cfg.clone())?;
        return Ok(cfg);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut cfg: StationConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let before = (cfg.jobs_dir.clone(), cfg.nina_output_dir.clone());
    repair_personal_paths(&mut cfg);
    if before != (cfg.jobs_dir.clone(), cfg.nina_output_dir.clone()) {
        let _ = write_config_file(cfg.clone());
    }
    Ok(cfg)
}

fn write_config_file(config: StationConfig) -> Result<(), String> {
    ensure_data_dir()?;
    let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path(), raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn station_get_tenant() -> Result<PersonalTenantInfo, String> {
    baked_tenant_info()
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
async fn station_run_diagnostics(state: State<'_, AgentState>) -> Result<Vec<CheckItem>, String> {
    let cfg = read_config_file()?;
    let running = agent_is_running_locked(&state)?;
    tauri::async_runtime::spawn_blocking(move || build_checks(&cfg, running))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn station_read_agent_logs() -> Result<String, String> {
    Ok(read_log_tail(128_000))
}

#[tauri::command]
fn station_clear_agent_logs() -> Result<(), String> {
    ensure_data_dir()?;
    fs::write(log_path(), "").map_err(|e| e.to_string())
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
    ensure_agent_dirs(&cfg)?;
    let script = agent_script_path(&app);
    if !script.exists() {
        return Err(format!("Agent script not found: {}", script.display()));
    }

    let tenant = baked_tenant_info()?;
    let api_secret = baked_api_secret()?;

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
            .env("BOREAN_API_BASE_URL", &tenant.api_base_url)
            .env("BOREAN_TENANT_ID", &tenant.tenant_id)
            .env(
                "PERSONAL_R2_ENABLED",
                if cfg.r2_enabled { "1" } else { "0" },
            )
            .env("BOREAN_NINA_INSTALL_DIR", &cfg.nina_install_dir)
            .env("BOREAN_JOBS_DIR", &cfg.jobs_dir)
            .env("BOREAN_NINA_OUTPUT_DIR", &cfg.nina_output_dir)
            .env("IMAGING_QUEUE_SECRET", &api_secret)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

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

#[tauri::command]
async fn station_scan_nina() -> Result<StationConfig, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let install_dir = platform_windows::scan_nina_install_dir()?;
        let mut config = read_config_file()?;
        config.nina_install_dir = install_dir.to_string_lossy().into_owned();
        write_config_file(config.clone())?;
        append_log(&format!(
            "[station-ui] NINA found at {}",
            config.nina_install_dir
        ));
        Ok(config)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn station_install_python() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        platform_windows::install_python()?;
        append_log("[station-ui] Python install completed");
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn station_setup_autostart() -> Result<StationConfig, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        platform_windows::enable_autostart(&exe)?;
        let mut config = read_config_file()?;
        config.autostart_enabled = true;
        write_config_file(config.clone())?;
        append_log("[station-ui] Station autostart enabled at login");
        Ok(config)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn open_update_download(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd");
        command
            .args(["/C", "start", "", url])
            .creation_flags(0x08000000);
        command
            .status()
            .map_err(|e| format!("Could not open download URL: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("Updates are only supported in the Windows Station app.".into())
    }
}

#[tauri::command]
async fn station_apply_update() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let installed = station_app_version();
        let manifest = fetch_station_version_manifest()?;
        let latest = manifest.latest_version.trim();
        if compare_versions(installed, latest) != std::cmp::Ordering::Less {
            return Err("Station is already up to date.".into());
        }
        if let Some(url) = manifest
            .download_url
            .filter(|value| !value.trim().is_empty())
        {
            append_log(&format!("[station-ui] Opening update download: {url}"));
            open_update_download(url.trim())?;
            return Ok(());
        }
        append_log(&format!(
            "[station-ui] Update v{latest} available — OTA download URL not configured yet"
        ));
        Err(format!(
            "Update v{latest} is available. In-app OTA download is not configured yet."
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            station_get_tenant,
            station_has_user_license,
            station_activate_account,
            station_load_config,
            station_save_config,
            station_run_diagnostics,
            station_read_agent_logs,
            station_clear_agent_logs,
            station_agent_is_running,
            station_start_agent,
            station_stop_agent,
            station_scan_nina,
            station_install_python,
            station_setup_autostart,
            station_apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

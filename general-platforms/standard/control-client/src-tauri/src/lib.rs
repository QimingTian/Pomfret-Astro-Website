use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTenantInfo {
    pub tenant_id: String,
    pub api_base_url: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TenantFile {
    tenant_id: String,
    api_base_url: String,
    api_secret: String,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlVersionResponse {
    latest_version: String,
    download_url: Option<String>,
    download_url_windows: Option<String>,
    download_url_mac: Option<String>,
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn borean_data_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        let base = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| PathBuf::from(".").to_string_lossy().into_owned());
        PathBuf::from(base).join("BoreanAstro")
    } else {
        dirs_home().join(".boreanastro")
    }
}

fn user_tenant_path() -> PathBuf {
    borean_data_dir().join("tenant.json")
}

fn baked_tenant_raw() -> Result<TenantFile, String> {
    serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/tenant_config.json")))
        .map_err(|e| format!("Invalid baked tenant config: {e}"))
}

fn read_user_tenant_raw() -> Option<TenantFile> {
    let path = user_tenant_path();
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn resolve_tenant_raw() -> Result<TenantFile, String> {
    if let Some(user) = read_user_tenant_raw() {
        return Ok(user);
    }
    baked_tenant_raw()
}

fn tenant_info_from(raw: &TenantFile) -> PersonalTenantInfo {
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

fn control_version_url(raw: &TenantFile) -> String {
    format!(
        "{}/api/personal/{}/control/version",
        raw.api_base_url.trim().trim_end_matches('/'),
        raw.tenant_id.trim()
    )
}

fn fetch_control_version_manifest() -> Result<ControlVersionResponse, String> {
    let raw = resolve_tenant_raw()?;
    let url = control_version_url(&raw);
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(4))
        .build();
    let response = agent.get(&url).call().map_err(|e| e.to_string())?;
    if response.status() >= 400 {
        return Err(format!("HTTP {}", response.status()));
    }
    response
        .into_string()
        .map_err(|e| e.to_string())
        .and_then(|body| serde_json::from_str(&body).map_err(|e| e.to_string()))
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

fn pick_download_url(manifest: &ControlVersionResponse) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        manifest
            .download_url_mac
            .as_ref()
            .or(manifest.download_url.as_ref())
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
    }
    #[cfg(target_os = "windows")]
    {
        manifest
            .download_url_windows
            .as_ref()
            .or(manifest.download_url.as_ref())
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        manifest
            .download_url
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
    }
}

fn open_download_url(url: &str) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    installed_version: String,
    latest_version: String,
    update_available: bool,
    download_url: Option<String>,
}

#[tauri::command]
fn control_get_tenant() -> Result<PersonalTenantInfo, String> {
    let raw = resolve_tenant_raw()?;
    Ok(tenant_info_from(&raw))
}

#[tauri::command]
fn control_get_license_path() -> Result<String, String> {
    Ok(user_tenant_path().to_string_lossy().into_owned())
}

fn save_tenant_config(raw: &TenantFile) -> Result<(), String> {
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

fn activate_account(api_base_url: String, login: String, password: String) -> Result<TenantFile, String> {
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

#[tauri::command]
fn control_has_user_license() -> Result<bool, String> {
    Ok(read_user_tenant_raw().is_some())
}

#[tauri::command]
fn control_activate_account(
    api_base_url: String,
    login: String,
    password: String,
) -> Result<PersonalTenantInfo, String> {
    let raw = activate_account(api_base_url, login, password)?;
    save_tenant_config(&raw)?;
    Ok(tenant_info_from(&raw))
}

#[tauri::command]
fn control_import_tenant(source_path: String) -> Result<PersonalTenantInfo, String> {
    let source = PathBuf::from(source_path.trim());
    if !source.exists() {
        return Err("Selected file does not exist.".into());
    }
    let raw: TenantFile = serde_json::from_str(
        &fs::read_to_string(&source).map_err(|e| format!("Could not read license file: {e}"))?,
    )
    .map_err(|e| format!("Invalid tenant.json: {e}"))?;
    save_tenant_config(&raw)?;
    Ok(tenant_info_from(&raw))
}

#[tauri::command]
fn control_app_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
async fn control_check_update() -> Result<UpdateStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let installed = env!("CARGO_PKG_VERSION");
        let manifest = fetch_control_version_manifest()?;
        let latest = manifest.latest_version.trim().to_string();
        Ok(UpdateStatus {
            installed_version: installed.to_string(),
            latest_version: latest.clone(),
            update_available: compare_versions(installed, &latest) == std::cmp::Ordering::Less,
            download_url: pick_download_url(&manifest),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn control_apply_update() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let installed = env!("CARGO_PKG_VERSION");
        let manifest = fetch_control_version_manifest()?;
        let latest = manifest.latest_version.trim();
        if compare_versions(installed, latest) != std::cmp::Ordering::Less {
            return Err("Control Client is already up to date.".into());
        }
        let url = pick_download_url(&manifest)
            .ok_or_else(|| format!("Update v{latest} is available but download URL is not configured yet."))?;
        open_download_url(&url)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            control_get_tenant,
            control_get_license_path,
            control_has_user_license,
            control_activate_account,
            control_import_tenant,
            control_app_version,
            control_check_update,
            control_apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

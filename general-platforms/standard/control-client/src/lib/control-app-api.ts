import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export type PersonalTenantInfo = {
  tenantId: string
  apiBaseUrl: string
  displayName: string
}

export type UpdateStatus = {
  installedVersion: string
  latestVersion: string
  updateAvailable: boolean
  downloadUrl: string | null
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function loadAppTenant(): Promise<PersonalTenantInfo | null> {
  if (!isTauri()) return null
  return invoke<PersonalTenantInfo>('control_get_tenant')
}

export async function getLicensePath(): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string>('control_get_license_path')
}

export async function hasUserLicense(): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('control_has_user_license')
}

export async function activateAccount(input: {
  apiBaseUrl: string
  login: string
  password: string
}): Promise<PersonalTenantInfo> {
  return invoke<PersonalTenantInfo>('control_activate_account', {
    apiBaseUrl: input.apiBaseUrl,
    login: input.login,
    password: input.password,
  })
}

export async function importTenantLicense(): Promise<PersonalTenantInfo> {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Tenant license', extensions: ['json'] }],
  })
  if (!selected || Array.isArray(selected)) {
    throw new Error('No license file selected.')
  }
  return invoke<PersonalTenantInfo>('control_import_tenant', { sourcePath: selected })
}

export async function checkForUpdate(): Promise<UpdateStatus | null> {
  if (!isTauri()) return null
  return invoke<UpdateStatus>('control_check_update')
}

export async function applyUpdate(): Promise<void> {
  await invoke('control_apply_update')
}

export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string>('control_app_version')
}

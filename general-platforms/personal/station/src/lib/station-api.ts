import { invoke } from '@tauri-apps/api/core'
import type { CheckItem, StationConfig } from './types'

export async function loadConfig(): Promise<StationConfig> {
  return invoke<StationConfig>('station_load_config')
}

export async function saveConfig(config: StationConfig): Promise<void> {
  await invoke('station_save_config', { config })
}

export async function runDiagnostics(): Promise<CheckItem[]> {
  return invoke<CheckItem[]>('station_run_diagnostics')
}

export async function readAgentLogs(): Promise<string> {
  return invoke<string>('station_read_agent_logs')
}

export async function agentIsRunning(): Promise<boolean> {
  return invoke<boolean>('station_agent_is_running')
}

export async function startAgent(): Promise<void> {
  await invoke('station_start_agent')
}

export async function stopAgent(): Promise<void> {
  await invoke('station_stop_agent')
}

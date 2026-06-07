export type CheckStatus = 'ok' | 'warn' | 'error' | 'unknown'

export type CheckItem = {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export type StationConfig = {
  hubBaseUrl: string
  ninaInstallDir: string
  jobsDir: string
  ninaOutputDir: string
  imagingQueueSecret: string
  r2Enabled: boolean
  autostartEnabled: boolean
  pythonPath: string
}

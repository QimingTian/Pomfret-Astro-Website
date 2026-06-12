export type ObservatoryStatus =
  | 'ready'
  | 'busy_in_use'
  | 'disconnected'
  | 'closed_weather_not_permitted'
  | 'closed_daytime'
  | 'closed_observatory_maintenance'

export type ObservatoryMode = 'manual' | 'auto'

export type ObservatoryStatusResponse = {
  ok: boolean
  mode?: ObservatoryMode
  status?: ObservatoryStatus
  error?: string
}

export type SessionRow = {
  id: string
  target: string
  status: string
  outputMode?: string
  plannedStartIso?: string | null
  createdAt?: string
  filter?: string | null
  exposureSeconds?: number | null
  count?: number | null
}

export type CurrentSessionsResponse = {
  ok: boolean
  sessions?: SessionRow[]
  error?: string
}

export type HubProbeResult = {
  hubReachable: boolean
  observatory?: ObservatoryStatusResponse
  error?: string
}

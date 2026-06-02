export type ControllerRole = 'cameras'

export interface ControllerConfig {
  id: string
  name: string
  baseURL: string
  authToken?: string
  roles: ControllerRole[]
}

export interface SensorsModel {
  temperature?: number
  humidity?: number
  allSkyCam: CameraState
}

export interface CameraState {
  connected: boolean
  streaming: boolean
  lastSnapshot?: Date
  fault?: string
}

export interface StatusResponse {
  sensors?: {
    temperature?: number
    humidity?: number
    allSkyCam: CameraStateResponse
  }
  alerts?: AlertResponse[]
}

export interface CameraStateResponse {
  connected: boolean
  streaming: boolean
  lastSnapshot?: string
  fault?: string
  ascCloud?: AscCloudInference
}

export interface AscCloudRainInference {
  detected?: boolean
  confidence?: number
  label?: string
}

export interface AscCloudModelVersion {
  version?: string
  label?: string
  released?: string
}

export interface AscCloudInference {
  cloudCoverPercent?: number | null
  cloudConfidence?: number | null
  modelPhase?: 'day' | 'night' | null
  modelVersion?: AscCloudModelVersion | null
  frameIso?: string | null
  rain?: AscCloudRainInference | null
  lastError?: string | null
}

export interface AlertResponse {
  level: string
  message: string
  ts: string
}

export interface LogEntry {
  id: string
  ts: Date
  controllerID?: string
  controllerName?: string
  module: string
  level: 'info' | 'warn' | 'error'
  message: string
  extra?: string
}

export interface WeatherModel {
  temperatureC?: number
  apparentTemperatureC?: number
  humidityPercent?: number
  precipitationMm?: number
  cloudCoverPercent?: number
  cloudSource?: 'asc'
  windSpeed?: number
  windGust?: number
  observationTime?: Date
  cloudObservationTime?: Date
}


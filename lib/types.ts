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
  windSpeed?: number
  windGust?: number
  observationTime?: Date
}

export interface Booking {
  id: string
  user_name: string
  start_time: string
  end_time: string
  notes?: string
}

export interface BookingRequest {
  user_name: string
  start_time: string
  end_time: string
  notes?: string
}


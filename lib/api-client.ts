import type { StatusResponse, ControllerConfig, Booking, BookingRequest } from './types'

export class APIClient {
  private baseURL: string
  private authToken?: string

  constructor(baseURL: string, authToken?: string) {
    this.baseURL = baseURL.trim()
    if (!this.baseURL.startsWith('http://') && !this.baseURL.startsWith('https://')) {
      this.baseURL = 'http://' + this.baseURL
    }
    if (this.baseURL.endsWith('/')) {
      this.baseURL = this.baseURL.slice(0, -1)
    }
    this.authToken = authToken
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${path}`
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'Pomfret Observatory/1.1 (Web)',
      ...(options.headers as Record<string, string>),
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      return response.json()
    }

    return response.blob() as unknown as T
  }

  async fetchStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>('/status')
  }

  async startCameraStream(): Promise<void> {
    await this.request('/camera/stream/start', { method: 'POST' })
  }

  async stopCameraStream(): Promise<void> {
    await this.request('/camera/stream/stop', { method: 'POST' })
  }

  async captureSnapshot(): Promise<Blob> {
    return this.request<Blob>('/camera/snapshot')
  }

  async updateCameraSettings(settings: {
    gain?: number
    photoExposure?: number
    videoExposure?: number
    imageFormat?: string
    gamma?: number
    wbR?: number
    wbB?: number
    wbAuto?: boolean
  }): Promise<void> {
    const params: Record<string, any> = {}
    
    if (settings.gain !== undefined) params.gain = settings.gain
    if (settings.photoExposure !== undefined) {
      params.photo_exposure = Math.round(settings.photoExposure * 1_000_000) // Convert to microseconds
    }
    if (settings.videoExposure !== undefined) {
      params.video_exposure = Math.round(settings.videoExposure * 1_000_000) // Convert to microseconds
    }
    if (settings.imageFormat !== undefined) params.image_format = settings.imageFormat
    if (settings.gamma !== undefined) params.gamma = settings.gamma
    if (settings.wbR !== undefined) params.wb_r = settings.wbR
    if (settings.wbB !== undefined) params.wb_b = settings.wbB
    if (settings.wbAuto !== undefined) params.wb_auto = settings.wbAuto

    await this.request('/camera/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
  }

  async startSequence(params: {
    savePath: string
    count: number
    fileFormat: string
    interval?: number
  }): Promise<{
    success: boolean
    message: string
    save_path: string
    count: number
    file_format: string
    interval?: number
  }> {
    const body: Record<string, any> = {
      save_path: params.savePath,
      count: params.count,
      file_format: params.fileFormat,
    }
    if (params.interval !== undefined && params.interval > 0) {
      body.interval = params.interval
    }

    return this.request('/camera/sequence/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  async stopSequence(): Promise<void> {
    await this.request('/camera/sequence/stop', { method: 'POST' })
  }

  async getSequenceStatus(): Promise<{
    active: boolean
    current_count: number
    total_count: number
    save_path?: string
    file_format?: string
    interval?: number
  }> {
    return this.request('/camera/sequence/status')
  }

  getStreamURL(): string {
    return 'https://cam.pomfretastro.org/camera/stream'
  }

  async captureSequence(count: number): Promise<{
    success: boolean
    count: number
    photos: (string | null)[]
  }> {
    return this.request('/camera/sequence/capture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ count }),
    })
  }

  // Bookings API
  async fetchBookings(): Promise<Booking[]> {
    return this.request<Booking[]>('/bookings')
  }

  async createBooking(booking: BookingRequest): Promise<Booking> {
    return this.request<Booking>('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(booking),
    })
  }

  async updateBooking(id: string, booking: BookingRequest): Promise<Booking> {
    return this.request<Booking>(`/bookings/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(booking),
    })
  }

  async deleteBooking(id: string): Promise<void> {
    await this.request(`/bookings/${id}`, { method: 'DELETE' })
  }
}


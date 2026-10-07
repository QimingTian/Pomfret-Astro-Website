export type OccultationEvent = {
  id: string
  asteroid: string
  star: string
  eventIso: string
  durationSeconds: number | null
  magnitude: number | null
  magnitudeDrop: number | null
  moonSeparationDeg: number | null
  raHours: number
  decDeg: number
  plannedStartIso: string
  eventFinishIso: string
  /** Server-chosen sub-frame exposure from the star magnitude. */
  exposureSeconds: number
  exposureCount: number
  estimatedDurationSeconds: number
  altitudeOk: boolean
}

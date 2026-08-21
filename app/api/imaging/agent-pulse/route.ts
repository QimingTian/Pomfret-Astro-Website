import { NextRequest } from 'next/server'

import {
  imagingCorsOptions,
  imagingQueueAuthorized,
  imagingUnauthorized,
  withImagingCors,
} from '@/lib/imaging-queue-auth'
import { triggerWeatherSafetyEmergencyStopCheck } from '@/lib/imaging/weather-safety-estop'
import { reportObservatoryAgentPulse } from '@/lib/observatory-status-store'

export const runtime = 'nodejs'

export function OPTIONS() {
  return imagingCorsOptions()
}

/** Observatory PC agent: report NINA.exe running state (replaces inferring busy from poll gaps). */
export async function POST(request: NextRequest) {
  if (!imagingQueueAuthorized(request)) {
    return imagingUnauthorized()
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withImagingCors({ ok: false as const, error: 'Invalid JSON' }, 400)
  }
  if (!body || typeof body !== 'object') {
    return withImagingCors({ ok: false as const, error: 'Expected JSON object' }, 400)
  }

  const ninaRunning = (body as { ninaRunning?: unknown }).ninaRunning
  if (typeof ninaRunning !== 'boolean') {
    return withImagingCors({ ok: false as const, error: 'ninaRunning must be a boolean' }, 400)
  }

  await reportObservatoryAgentPulse({ ninaRunning })
  // Night weather-safety (arm + auto-clear when Open-Meteo/ASC clear); daytime arm is no-op.
  triggerWeatherSafetyEmergencyStopCheck()
  return withImagingCors({ ok: true as const, ninaRunning })
}

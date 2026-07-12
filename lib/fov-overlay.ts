/**
 * Field-of-view overlay geometry, including field rotation.
 *
 * The Stellarium view renders in the horizon-aligned (alt-az) frame, so a camera frame defined
 * relative to the equatorial sky (a fixed position angle east of celestial north) appears to
 * rotate as the target moves across the sky — the parallactic angle. Instead of computing that
 * angle in closed form and fighting projection/parity sign conventions, we read the engine's own
 * projection: project celestial north and east at the boresight onto the screen and build the
 * sensor's on-screen orientation from those measured directions. Exact for the engine's projection
 * and parity-correct by construction.
 */

type Observer = { utc?: number; yaw?: number; pitch?: number }

export type FovOverlayStel = {
  core?: { observer?: Observer; fov?: number }
  convertFrame?: (obs: Observer, origin: string, dest: string, v: number[]) => number[]
  c2s?: (v: number[]) => [number, number]
}

const DEG = Math.PI / 180

function icrfUnit(raRad: number, decRad: number): number[] {
  const cd = Math.cos(decRad)
  return [cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad), 0]
}

function icrfToRaDec(
  stel: FovOverlayStel,
  vIcrf: number[],
): { raHours: number; decDeg: number } | null {
  if (!stel.c2s) return null
  const s = stel.c2s(vIcrf)
  if (!Number.isFinite(s[0]) || !Number.isFinite(s[1])) return null
  return {
    raHours: (((s[0] * 12) / Math.PI) % 24 + 24) % 24,
    decDeg: (s[1] * 180) / Math.PI,
  }
}

function viewCenterRaDec(stel: FovOverlayStel): { raHours: number; decDeg: number } | null {
  const obs = stel.core?.observer
  if (!obs || !stel.convertFrame) return null
  try {
    const vIcrf = stel.convertFrame(obs, 'VIEW', 'ICRF', [0, 0, -1, 0])
    return icrfToRaDec(stel, vIcrf)
  } catch {
    return null
  }
}

/**
 * Pixel offset of a sky point from the current view boresight (engine VIEW frame).
 *
 * VIEW looks along −Z. Screen uses only VIEW x/y (with CSS Y flip). Points behind
 * the camera (VIEW z with opposite sign to the boresight) must return null — otherwise
 * the same screen (x,y) maps to two RA/Decs (front vs back of the unit sphere), and
 * any inverse that scores by forward pixel error cannot tell them apart.
 */
export function raDecToScreenDelta(
  stel: FovOverlayStel | null,
  raHours: number,
  decDeg: number,
  viewportHeightPx: number,
  fovRad: number,
): { x: number; y: number } | null {
  const obs = stel?.core?.observer
  if (!stel || !obs || !stel.convertFrame || fovRad <= 0) return null
  if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) return null
  try {
    const viewCenterIcrf = stel.convertFrame(obs, 'VIEW', 'ICRF', [0, 0, -1, 0])
    const centerView = stel.convertFrame(obs, 'ICRF', 'VIEW', viewCenterIcrf)
    const targetView = stel.convertFrame(obs, 'ICRF', 'VIEW', icrfUnitFromHours(raHours, decDeg))
    // Boresight is [0,0,−1]; visible sky has the same VIEW-z sign (negative).
    const lookZ = centerView[2] ?? -1
    if (!Number.isFinite(targetView[2]) || targetView[2]! * lookZ <= 0) return null
    const scale = viewportHeightPx / fovRad
    return {
      x: (targetView[0]! - centerView[0]!) * scale,
      // CSS/screen Y is down; VIEW Y is up.
      y: -(targetView[1]! - centerView[1]!) * scale,
    }
  } catch {
    return null
  }
}

/** Closed-form inverse of {@link raDecToScreenDelta} (front-hemisphere VIEW ray + CSS Y flip). */
function screenDeltaToRaDecClosed(
  stel: FovOverlayStel,
  screenDeltaX: number,
  screenDeltaY: number,
  viewportHeightPx: number,
  fovRad: number,
): { raHours: number; decDeg: number } | null {
  const obs = stel.core?.observer
  if (!obs || !stel.convertFrame) return null
  try {
    const scale = viewportHeightPx / fovRad
    const viewCenterIcrf = stel.convertFrame(obs, 'VIEW', 'ICRF', [0, 0, -1, 0])
    const centerView = stel.convertFrame(obs, 'ICRF', 'VIEW', viewCenterIcrf)
    let tv0 = centerView[0]! + screenDeltaX / scale
    let tv1 = centerView[1]! - screenDeltaY / scale
    let r2 = tv0 * tv0 + tv1 * tv1
    if (r2 >= 1) {
      const r = Math.sqrt(r2)
      tv0 /= r * 1.0001
      tv1 /= r * 1.0001
      r2 = tv0 * tv0 + tv1 * tv1
    }
    // Only the front hemisphere. Trying ±z used to “succeed” for both because forward
    // ignored z — that picked the antipode (e.g. 20h/+44° ↔ 08h/−44°).
    const lookZ = centerView[2] ?? -1
    const zSign = lookZ <= 0 ? -1 : 1
    const tv2 = zSign * Math.sqrt(Math.max(0, 1 - r2))
    const vIcrf = stel.convertFrame(obs, 'VIEW', 'ICRF', [tv0, tv1, tv2, 0])
    return icrfToRaDec(stel, vIcrf)
  } catch {
    return null
  }
}

function screenDeltaForwardErrorPx(
  stel: FovOverlayStel,
  raHours: number,
  decDeg: number,
  screenDeltaX: number,
  screenDeltaY: number,
  viewportHeightPx: number,
  fovRad: number,
): number | null {
  const got = raDecToScreenDelta(stel, raHours, decDeg, viewportHeightPx, fovRad)
  if (!got) return null
  return Math.hypot(got.x - screenDeltaX, got.y - screenDeltaY)
}

function polishScreenDeltaToRaDec(
  stel: FovOverlayStel,
  screenDeltaX: number,
  screenDeltaY: number,
  viewportHeightPx: number,
  fovRad: number,
  seedRaHours: number,
  seedDecDeg: number,
  maxIter = 100,
): { raHours: number; decDeg: number; errPx: number } | null {
  let raHours = seedRaHours
  let decDeg = seedDecDeg
  let bestRa = raHours
  let bestDec = decDeg
  let bestErr = Infinity
  let damp = 1

  for (let i = 0; i < maxIter; i++) {
    const err =
      screenDeltaForwardErrorPx(stel, raHours, decDeg, screenDeltaX, screenDeltaY, viewportHeightPx, fovRad) ??
      Infinity
    if (err < bestErr) {
      bestErr = err
      bestRa = raHours
      bestDec = decDeg
    }
    if (err < 0.05) return { raHours, decDeg, errPx: err }

    const got = raDecToScreenDelta(stel, raHours, decDeg, viewportHeightPx, fovRad)
    if (!got) break
    const ex = screenDeltaX - got.x
    const ey = screenDeltaY - got.y

    const dRa = 1e-4 / 15
    const dDec = 1e-4
    const gotRa = raDecToScreenDelta(stel, raHours + dRa, decDeg, viewportHeightPx, fovRad)
    const gotDec = raDecToScreenDelta(stel, raHours, decDeg + dDec, viewportHeightPx, fovRad)
    if (!gotRa || !gotDec) break

    const j11 = (gotRa.x - got.x) / dRa
    const j12 = (gotDec.x - got.x) / dDec
    const j21 = (gotRa.y - got.y) / dRa
    const j22 = (gotDec.y - got.y) / dDec
    const det = j11 * j22 - j12 * j21
    if (Math.abs(det) < 1e-14) break

    let stepRa = (-ex * j22 + ey * j12) / det
    let stepDec = (-j11 * ey + j21 * ex) / det
    const stepLen = Math.hypot(stepRa, stepDec)
    const maxStep = 0.12
    if (stepLen > maxStep) {
      stepRa = (stepRa / stepLen) * maxStep
      stepDec = (stepDec / stepLen) * maxStep
    }

    stepRa *= damp
    stepDec *= damp
    const nextRa = ((raHours + stepRa * 0.95) % 24 + 24) % 24
    const nextDec = Math.max(-89.999, Math.min(89.999, decDeg + stepDec * 0.95))
    const nextErr =
      screenDeltaForwardErrorPx(stel, nextRa, nextDec, screenDeltaX, screenDeltaY, viewportHeightPx, fovRad) ??
      Infinity
    if (nextErr < err) {
      raHours = nextRa
      decDeg = nextDec
      damp = Math.min(1, damp * 1.15)
    } else {
      damp *= 0.45
      if (damp < 0.02) break
    }
  }

  if (!Number.isFinite(bestErr)) return null
  return { raHours: bestRa, decDeg: bestDec, errPx: bestErr }
}

function descentScreenDeltaToRaDec(
  stel: FovOverlayStel,
  screenDeltaX: number,
  screenDeltaY: number,
  viewportHeightPx: number,
  fovRad: number,
  seedRaHours: number,
  seedDecDeg: number,
  maxIter = 72,
): { raHours: number; decDeg: number; errPx: number } | null {
  let raHours = seedRaHours
  let decDeg = seedDecDeg
  let stepRa = 0.04 / 15
  let stepDec = 0.04
  let bestRa = raHours
  let bestDec = decDeg
  let bestErr =
    screenDeltaForwardErrorPx(stel, raHours, decDeg, screenDeltaX, screenDeltaY, viewportHeightPx, fovRad) ??
    Infinity

  for (let i = 0; i < maxIter; i++) {
    let err = bestErr
    let improved = false
    const dirs: Array<[number, number]> = [
      [stepRa, 0],
      [-stepRa, 0],
      [0, stepDec],
      [0, -stepDec],
      [stepRa, stepDec],
      [stepRa, -stepDec],
      [-stepRa, stepDec],
      [-stepRa, -stepDec],
    ]
    for (const [dRa, dDec] of dirs) {
      const trialRa = ((raHours + dRa) % 24 + 24) % 24
      const trialDec = Math.max(-89.999, Math.min(89.999, decDeg + dDec))
      const trialErr =
        screenDeltaForwardErrorPx(
          stel,
          trialRa,
          trialDec,
          screenDeltaX,
          screenDeltaY,
          viewportHeightPx,
          fovRad,
        ) ?? Infinity
      if (trialErr + 1e-9 < err) {
        raHours = trialRa
        decDeg = trialDec
        err = trialErr
        improved = true
        if (err < bestErr) {
          bestErr = err
          bestRa = raHours
          bestDec = decDeg
        }
      }
    }
    if (err < 0.05) return { raHours, decDeg, errPx: err }
    if (!improved) {
      stepRa *= 0.5
      stepDec *= 0.5
      if (stepRa < 5e-8 / 15) break
    }
  }

  if (!Number.isFinite(bestErr)) return null
  return { raHours: bestRa, decDeg: bestDec, errPx: bestErr }
}

function observerAnglesForRaDec(
  stel: FovOverlayStel,
  raHours: number,
  decDeg: number,
): { yaw: number; pitch: number } | null {
  const obs = stel.core?.observer
  if (!obs || !stel.convertFrame || !stel.c2s) return null
  try {
    const vObs = stel.convertFrame(obs, 'ICRF', 'OBSERVED', icrfUnitFromHours(raHours, decDeg))
    const [yaw, pitch] = stel.c2s(vObs)
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null
    return { yaw, pitch }
  } catch {
    return null
  }
}

/** Inverse of {@link raDecToScreenDelta} — front-hemisphere closed form + Newton polish. */
export function screenDeltaToRaDec(
  stel: FovOverlayStel | null,
  screenDeltaX: number,
  screenDeltaY: number,
  viewportHeightPx: number,
  fovRad: number,
  seed?: { raHours: number; decDeg: number } | null,
): { raHours: number; decDeg: number } | null {
  if (!stel || fovRad <= 0 || viewportHeightPx <= 0) return null
  if (!Number.isFinite(screenDeltaX) || !Number.isFinite(screenDeltaY)) return null

  const center = viewCenterRaDec(stel)
  if (!center) return null
  if (Math.hypot(screenDeltaX, screenDeltaY) < 1e-6) return center

  const closed = screenDeltaToRaDecClosed(stel, screenDeltaX, screenDeltaY, viewportHeightPx, fovRad)
  const closedErr = closed
    ? (screenDeltaForwardErrorPx(
        stel,
        closed.raHours,
        closed.decDeg,
        screenDeltaX,
        screenDeltaY,
        viewportHeightPx,
        fovRad,
      ) ?? Infinity)
    : Infinity
  if (closed && closedErr < 0.5) return closed

  const seeds: Array<{ raHours: number; decDeg: number }> = []
  if (closed) seeds.push(closed)
  if (seed) seeds.push(seed)
  seeds.push(center)

  let best: { raHours: number; decDeg: number } | null = null
  let bestErr = Infinity
  for (const candidate of seeds) {
    const polished = polishScreenDeltaToRaDec(
      stel,
      screenDeltaX,
      screenDeltaY,
      viewportHeightPx,
      fovRad,
      candidate.raHours,
      candidate.decDeg,
    )
    if (!polished) continue
    if (polished.errPx < bestErr) {
      bestErr = polished.errPx
      best = { raHours: polished.raHours, decDeg: polished.decDeg }
    }
  }

  if (best && bestErr > 0.5) {
    const refined = descentScreenDeltaToRaDec(
      stel,
      screenDeltaX,
      screenDeltaY,
      viewportHeightPx,
      fovRad,
      best.raHours,
      best.decDeg,
    )
    if (refined && refined.errPx < bestErr) {
      bestErr = refined.errPx
      best = { raHours: refined.raHours, decDeg: refined.decDeg }
    }
  }

  if (best && bestErr < 5) return best
  if (closed && closedErr < 20) return closed
  return null
}

/** Pan observer until VIEW center matches `raHours`/`decDeg` in engine projection. */
export function centerObserverOnRaDec(
  stel: FovOverlayStel | null,
  raHours: number,
  decDeg: number,
  viewportHeightPx: number,
  fovRad: number,
): void {
  const obs = stel?.core?.observer
  if (!stel || !obs || typeof obs.yaw !== 'number' || typeof obs.pitch !== 'number') return

  const errorAt = (yaw: number, pitch: number): number => {
    obs.yaw = yaw
    obs.pitch = pitch
    return skyScreenErrorPx(stel, raHours, decDeg, viewportHeightPx, fovRad) ?? Infinity
  }

  const seed = observerAnglesForRaDec(stel, raHours, decDeg)

  let bestYaw = obs.yaw
  let bestPitch = obs.pitch
  let bestErr = errorAt(bestYaw, bestPitch)

  if (seed) {
    const seedErr = errorAt(seed.yaw, seed.pitch)
    if (seedErr <= bestErr) {
      bestYaw = seed.yaw
      bestPitch = seed.pitch
      bestErr = seedErr
    }
  }

  if (bestErr < 0.5) {
    obs.yaw = bestYaw
    obs.pitch = bestPitch
    return
  }

  let gradYaw = bestYaw
  let gradPitch = bestPitch
  let gradErr = bestErr

  for (let i = 0; i < 50; i++) {
    const err = gradErr
    if (err < 0.5) break
    const eps = 5e-4
    const errYaw = errorAt(gradYaw + eps, gradPitch)
    const errPitch = errorAt(gradYaw, gradPitch + eps)
    obs.yaw = gradYaw
    obs.pitch = gradPitch

    const gYaw = (errYaw - err) / eps
    const gPitch = (errPitch - err) / eps
    const gLen2 = gYaw * gYaw + gPitch * gPitch
    if (gLen2 < 1e-14) break

    let improved = false
    for (const stepScale of [0.9, 0.45, 0.22, 0.11, 0.05]) {
      const nextYaw = gradYaw - (gYaw * err * stepScale) / gLen2
      let nextPitch = gradPitch - (gPitch * err * stepScale) / gLen2
      nextPitch = Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, nextPitch))
      const nextErr = errorAt(nextYaw, nextPitch)
      if (nextErr < gradErr) {
        gradYaw = nextYaw
        gradPitch = nextPitch
        gradErr = nextErr
        improved = true
        break
      }
    }
    if (!improved) break
  }

  obs.yaw = gradYaw
  obs.pitch = gradPitch
  let finalErr = skyScreenErrorPx(stel, raHours, decDeg, viewportHeightPx, fovRad) ?? Infinity

  if (seed) {
    const seedErr = errorAt(seed.yaw, seed.pitch)
    if (seedErr < finalErr) {
      obs.yaw = seed.yaw
      obs.pitch = seed.pitch
      finalErr = seedErr
    }
  }

  if (finalErr > 0.5 && seed) {
    obs.yaw = seed.yaw
    obs.pitch = seed.pitch
  }
}

/** Same result as {@link centerObserverOnRaDec} without leaving the observer moved. */
export function resolveObserverOnRaDec(
  stel: FovOverlayStel | null,
  raHours: number,
  decDeg: number,
  viewportHeightPx: number,
  fovRad: number,
): { yaw: number; pitch: number } | null {
  const obs = stel?.core?.observer
  if (!stel || !obs || typeof obs.yaw !== 'number' || typeof obs.pitch !== 'number') return null
  const startYaw = obs.yaw
  const startPitch = obs.pitch
  centerObserverOnRaDec(stel, raHours, decDeg, viewportHeightPx, fovRad)
  const yaw = obs.yaw
  const pitch = obs.pitch
  obs.yaw = startYaw
  obs.pitch = startPitch
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null
  return { yaw, pitch }
}

/**
 * Field rotation at `raHours`/`decDeg` as it will appear once the observer is centered there.
 * Lock-mode drag uses this so unlock does not twist the frame relative to the stars.
 */
export function fieldRotationWhenBoresightAt(
  stel: FovOverlayStel | null,
  positionAngleDeg: number,
  raHours: number,
  decDeg: number,
  viewportHeightPx: number,
  fovRad: number,
): number | null {
  const obs = stel?.core?.observer
  if (!stel || !obs || typeof obs.yaw !== 'number' || typeof obs.pitch !== 'number') return null
  const savedYaw = obs.yaw
  const savedPitch = obs.pitch
  centerObserverOnRaDec(stel, raHours, decDeg, viewportHeightPx, fovRad)
  raDecToScreenDelta(stel, raHours, decDeg, viewportHeightPx, fovRad)
  const rot =
    computeFovOverlayRotationDeg(stel, positionAngleDeg, raHours, decDeg) ??
    computeFovOverlayRotationDeg(stel, positionAngleDeg)
  obs.yaw = savedYaw
  obs.pitch = savedPitch
  return rot
}

/** OBSERVED-frame az/alt seed for pointing (debug + fallback). */
export function observedFrameAnglesForRaDec(
  stel: FovOverlayStel | null,
  raHours: number,
  decDeg: number,
): { yaw: number; pitch: number } | null {
  if (!stel) return null
  return observerAnglesForRaDec(stel, raHours, decDeg)
}

/** Screen error (px) between view center and a sky target in engine VIEW projection. */
export function skyScreenErrorPx(
  stel: FovOverlayStel | null,
  raHours: number,
  decDeg: number,
  viewportHeightPx: number,
  fovRad: number,
): number | null {
  const delta = raDecToScreenDelta(stel, raHours, decDeg, viewportHeightPx, fovRad)
  if (!delta) return null
  return Math.hypot(delta.x, delta.y)
}

function icrfUnitFromHours(raHours: number, decDeg: number): number[] {
  return icrfUnit((raHours * Math.PI) / 12, decDeg * DEG)
}

/**
 * On-screen rotation (CSS degrees, clockwise) for a camera frame whose sensor "up" edge sits at
 * `positionAngleDeg` east of celestial north at the boresight (or optional sky position).
 */
export function computeFovOverlayRotationDeg(
  stel: FovOverlayStel | null,
  positionAngleDeg: number,
  raHours?: number,
  decDeg?: number,
): number | null {
  const obs = stel?.core?.observer
  if (!stel || !obs || !stel.convertFrame || !stel.c2s) return null
  try {
    let raRad: number
    let decRad: number
    let centerIcrf: number[]

    if (
      raHours != null &&
      decDeg != null &&
      Number.isFinite(raHours) &&
      Number.isFinite(decDeg)
    ) {
      raRad = (raHours * Math.PI) / 12
      decRad = decDeg * DEG
      centerIcrf = icrfUnit(raRad, decRad)
    } else {
      centerIcrf = stel.convertFrame(obs, 'VIEW', 'ICRF', [0, 0, -1, 0])
      const c2s = stel.c2s(centerIcrf)
      raRad = c2s[0]
      decRad = c2s[1]
      if (!Number.isFinite(raRad) || !Number.isFinite(decRad)) return null
    }

    const step = 0.25 * DEG
    const decN = Math.min(decRad + step, 89.999 * DEG)
    const northIcrf = icrfUnit(raRad, decN)
    const eastIcrf = icrfUnit(raRad + step, decRad)

    const c = stel.convertFrame(obs, 'ICRF', 'VIEW', centerIcrf)
    const n = stel.convertFrame(obs, 'ICRF', 'VIEW', northIcrf)
    const e = stel.convertFrame(obs, 'ICRF', 'VIEW', eastIcrf)

    let nx = n[0] - c[0]
    let ny = n[1] - c[1]
    let ex = e[0] - c[0]
    let ey = e[1] - c[1]

    const nLen = Math.hypot(nx, ny)
    const eLen = Math.hypot(ex, ey)
    if (nLen < 1e-9 || eLen < 1e-9) return null
    nx /= nLen
    ny /= nLen
    ex /= eLen
    ey /= eLen

    const pa = positionAngleDeg * DEG
    const upx = Math.cos(pa) * nx + Math.sin(pa) * ex
    const upy = Math.cos(pa) * ny + Math.sin(pa) * ey

    const deg = (Math.atan2(upx, upy) * 180) / Math.PI
    return Number.isFinite(deg) ? deg : null
  } catch {
    return null
  }
}

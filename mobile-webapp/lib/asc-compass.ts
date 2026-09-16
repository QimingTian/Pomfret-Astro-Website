/**
 * Cardinal arms as they actually lie on the all-sky frame, from the camera's
 * astrometric solution (0.28 px RMS, ASC `CARDINAL_DIRECTIONS.md`). The camera
 * looks up, so the frame is mirrored: east is to the left and azimuth increases
 * counter-clockwise. The 1.71 deg mount tilt also means the arms are not exactly
 * 90 deg apart on screen, so each one carries its own angle.
 *
 * Screen angle is measured from straight up, clockwise (x right, y down).
 * Portrait CSS rotates the landscape stream 90 deg clockwise; `--asc-rotate`
 * carries that offset so the arms stay glued to the sky.
 */
export const ASC_COMPASS_ARMS = [
  { label: "N", screenAngleDeg: 31.2 },
  { label: "E", screenAngleDeg: 300.5 },
  { label: "S", screenAngleDeg: 211.5 },
  { label: "W", screenAngleDeg: 122.1 },
] as const

export const ASC_COMPASS_ARIA_LABEL =
  "Compass on frame: north up and tilted right, east upper left, south lower left, west lower right"

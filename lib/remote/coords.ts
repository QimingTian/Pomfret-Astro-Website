function carrySexagesimal(
  major: number,
  minute: number,
  second: number,
  options?: { wrapMajor?: number }
): { major: number; minute: number; second: number } {
  let total = major * 3600 + minute * 60 + second
  total = Math.round(total * 1000) / 1000
  let nextMajor = Math.floor(total / 3600)
  let rem = total - nextMajor * 3600
  let nextMinute = Math.floor(rem / 60)
  let nextSecond = rem - nextMinute * 60
  if (nextSecond >= 60 - 1e-9) {
    nextSecond = 0
    nextMinute += 1
  }
  if (nextMinute >= 60) {
    nextMinute -= 60
    nextMajor += 1
  }
  const wrap = options?.wrapMajor
  if (wrap != null && nextMajor >= wrap) nextMajor -= wrap
  return {
    major: nextMajor,
    minute: nextMinute,
    second: Number(nextSecond.toFixed(3)),
  }
}

export function sexagesimalPartsFromRadec(raHours: number, decDeg: number) {
  const totalRaSec = raHours * 3600
  const raRaw = {
    major: Math.floor(totalRaSec / 3600),
    minute: Math.floor((totalRaSec - Math.floor(totalRaSec / 3600) * 3600) / 60),
    second: totalRaSec - Math.floor(totalRaSec / 3600) * 3600 - Math.floor((totalRaSec - Math.floor(totalRaSec / 3600) * 3600) / 60) * 60,
  }
  const ra = carrySexagesimal(raRaw.major, raRaw.minute, raRaw.second, { wrapMajor: 24 })

  const sign: '+' | '-' = decDeg < 0 ? '-' : '+'
  const absDec = Math.abs(decDeg)
  const dec = carrySexagesimal(0, 0, absDec * 3600)

  return {
    raHourPart: String(ra.major),
    raMinutePart: String(ra.minute),
    raSecondPart: String(ra.second),
    decSign: sign,
    decDegreePart: String(dec.major),
    decMinutePart: String(dec.minute),
    decSecondPart: String(dec.second),
  }
}

export function parseCoordsFromFormParts(
  raHourPart: string,
  raMinutePart: string,
  raSecondPart: string,
  decSign: string,
  decDegreePart: string,
  decMinutePart: string,
  decSecondPart: string
): { ok: true; raHours: number; decDeg: number } | { ok: false; message: string } {
  const h = Number(raHourPart)
  const m = Number(raMinutePart)
  const s = Number(raSecondPart)
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) {
    return { ok: false, message: 'RA requires numeric Hour, Min, and Sec.' }
  }
  const ra = carrySexagesimal(h, m, s)
  if (ra.major < 0 || ra.major > 23 || ra.minute < 0 || ra.minute > 59 || ra.second < 0 || ra.second >= 60) {
    return { ok: false, message: 'RA range: Hour 0-23, Min 0-59, Sec 0-59.999.' }
  }
  const raHours = ra.major + ra.minute / 60 + ra.second / 3600

  let dd = Number(decDegreePart)
  let dm = Number(decMinutePart)
  let ds = Number(decSecondPart)
  if (!Number.isFinite(dd) || !Number.isFinite(dm) || !Number.isFinite(ds)) {
    return { ok: false, message: 'Dec requires numeric Deg, Min, and Sec.' }
  }
  const dec = carrySexagesimal(dd, dm, ds)
  dd = dec.major
  dm = dec.minute
  ds = dec.second
  if (dd < 0 || dd > 90 || dm < 0 || dm > 59 || ds < 0 || ds >= 60) {
    return { ok: false, message: 'Dec range: Deg 0-90, Min 0-59, Sec 0-59.999.' }
  }
  let decDeg = dd + dm / 60 + ds / 3600
  if (decSign === '-') decDeg = -decDeg
  return {
    ok: true,
    raHours: Number(raHours.toFixed(8)),
    decDeg: Number(decDeg.toFixed(8)),
  }
}

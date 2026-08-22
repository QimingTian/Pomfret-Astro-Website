# Restore Software Bisque Ascom2X (ASCOM.SoftwareBisque.Telescope) capability
# flags that NINA Equipment shows as Can Home / Pulse Guide / Can Set Tracking.
# These live in the ASCOM Profile, not in NINA sequence JSON.
# Snapshot taken from DESKTOP-OQE4FJS 2026-08-22 (working state).

$ErrorActionPreference = "Stop"
$driverId = "ASCOM.SoftwareBisque.Telescope"

$values = @{
  AlignmentMode      = "algGermanPolar"
  CanFindHome        = "True"
  CanGetPierSide     = "True"
  CanPark            = "True"
  CanSetTracking     = "True"
  DecGuideRateArcSec = "7.5"
  InhibitSync        = "True"
  InitHome           = "False"
  PulseGuide         = "True"
  RaGuideRateArcSec  = "7.5"
  SlewDelay          = "True"
  TheSkyType         = "TheSky64"
  TrackOffsets       = "True"
  UnparkOnConnect    = "False"
  UseDirectGuide     = "False"
}

$p = New-Object -ComObject ASCOM.Utilities.Profile
$p.DeviceType = "Telescope"
if (-not $p.IsRegistered($driverId)) {
  throw "Telescope driver $driverId is not registered."
}
foreach ($k in $values.Keys) {
  $p.WriteValue($driverId, $k, [string]$values[$k])
}

Write-Output "Restored Ascom2X flags on $driverId :"
foreach ($k in ($values.Keys | Sort-Object)) {
  Write-Output ("  {0}={1}" -f $k, $p.GetValue($driverId, $k))
}

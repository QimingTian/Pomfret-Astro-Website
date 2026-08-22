# Print ASCOM.SoftwareBisque.Telescope profile values (capability checkboxes).

$ErrorActionPreference = "Stop"
$driverId = "ASCOM.SoftwareBisque.Telescope"
$p = New-Object -ComObject ASCOM.Utilities.Profile
$p.DeviceType = "Telescope"
if (-not $p.IsRegistered($driverId)) {
  throw "Telescope driver $driverId is not registered."
}
Write-Output $p.GetProfile($driverId)
Write-Output "--- Values ---"
$p.Values($driverId)

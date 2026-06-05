$ErrorActionPreference = 'Stop'
$dllCandidates = @(
  'C:\Program Files (x86)\ASCOM\Platform 6 Developer Components\Components\Platform6\ASCOM.DriverAccess.dll',
  'C:\Program Files (x86)\ASCOM\Developer\Components\Platform\ASCOM.DriverAccess.dll'
)
$dll = $dllCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $dll) {
  Write-Output 'NO_DLL'
  exit 1
}
Add-Type -Path $dll
$progId = 'MaxDome64.Dome'
$d = New-Object ASCOM.DriverAccess.Dome($progId)
try {
  $d.Connected = $true
  $status = [int]$d.ShutterStatus
  $names = @('Open', 'Closed', 'Opening', 'Closing', 'Error')
  Write-Output "Driver=$progId"
  Write-Output "Connected=$($d.Connected)"
  Write-Output "ShutterStatus=$status ($($names[$status]))"
} catch {
  Write-Output "ERROR=$($_.Exception.Message)"
} finally {
  if ($d.Connected) { $d.Connected = $false }
}

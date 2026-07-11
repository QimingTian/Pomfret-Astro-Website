$agent = 'C:\Users\Observatory\Downloads\nina_agent.py'
$log = 'C:\Users\Observatory\Downloads\nina_agent_boot.log'

Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'" |
  Where-Object { $_.CommandLine -like '*nina_agent*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

$py = (Get-Command py -ErrorAction SilentlyContinue).Source
if (-not $py) {
  $py = 'C:\Users\Observatory\AppData\Local\Programs\Python\Python313\python.exe'
}

Start-Process -FilePath $py -ArgumentList '-3', $agent `
  -WorkingDirectory 'C:\Users\Observatory\Downloads' `
  -WindowStyle Hidden `
  -RedirectStandardOutput $log `
  -RedirectStandardError ($log + '.err')

Start-Sleep -Seconds 4

Write-Output '--- running nina_agent processes ---'
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'" |
  Where-Object { $_.CommandLine -like '*nina_agent*' } |
  Select-Object ProcessId, CommandLine |
  Format-List

if (Test-Path $log) {
  Write-Output '--- boot log tail ---'
  Get-Content $log -Tail 12
}

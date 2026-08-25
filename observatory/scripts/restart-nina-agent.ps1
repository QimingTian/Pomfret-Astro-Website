$agentTask = 'PomfretNinaAgent'

Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'" |
  Where-Object { $_.CommandLine -like '*nina_agent*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$task = Get-ScheduledTask -TaskName $agentTask -ErrorAction SilentlyContinue
if (-not $task) {
  throw "Scheduled task $agentTask was not found. Recreate it or start nina_agent.py another way."
}

Enable-ScheduledTask -TaskName $agentTask | Out-Null
Stop-ScheduledTask -TaskName $agentTask -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName $agentTask
Start-Sleep -Seconds 4

Write-Output '--- task ---'
Get-ScheduledTask -TaskName $agentTask | Select-Object TaskName, State | Format-List
Get-ScheduledTaskInfo -TaskName $agentTask | Select-Object LastRunTime, LastTaskResult | Format-List

Write-Output '--- running nina_agent processes ---'
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'" |
  Where-Object { $_.CommandLine -like '*nina_agent*' } |
  Select-Object ProcessId, CommandLine |
  Format-List

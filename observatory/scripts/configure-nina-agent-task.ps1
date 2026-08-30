# Remove Windows Task Scheduler defaults that kill the long-running NINA agent.
# - ExecutionTimeLimit defaults to 72h when omitted (this stopped the agent after 3 days).
# - StopOnIdleEnd can terminate interactive tasks when the session goes idle.
$agentTask = 'PomfretNinaAgent'

$task = Get-ScheduledTask -TaskName $agentTask -ErrorAction Stop
$settings = $task.Settings

$settings.ExecutionTimeLimit = 'PT0S'
$settings.StopIfGoingOnBatteries = $false
$settings.DisallowStartIfOnBatteries = $false
$settings.AllowHardTerminate = $true
$settings.RestartCount = 3
$settings.RestartInterval = 'PT1M'
# MultipleInstancesPolicy lives on the task object on newer builds; ignore if unavailable.
try {
  $settings.MultipleInstancesPolicy = 'IgnoreNew'
} catch {
  Write-Output "Note: MultipleInstancesPolicy not set on this Windows build (existing task policy kept)."
}

if ($settings.IdleSettings) {
  $settings.IdleSettings.StopOnIdleEnd = $false
  $settings.IdleSettings.RestartOnIdle = $false
}

Set-ScheduledTask -TaskName $agentTask -Settings $settings | Out-Null

Write-Output '--- PomfretNinaAgent settings ---'
Get-ScheduledTask -TaskName $agentTask | Select-Object TaskName, State | Format-List
$updated = Get-ScheduledTask -TaskName $agentTask
Write-Output ("ExecutionTimeLimit: " + $updated.Settings.ExecutionTimeLimit)
Write-Output ("StopIfGoingOnBatteries: " + $updated.Settings.StopIfGoingOnBatteries)
Write-Output ("RestartCount: " + $updated.Settings.RestartCount)
Write-Output ("RestartInterval: " + $updated.Settings.RestartInterval)
if ($updated.Settings.IdleSettings) {
  Write-Output ("StopOnIdleEnd: " + $updated.Settings.IdleSettings.StopOnIdleEnd)
}

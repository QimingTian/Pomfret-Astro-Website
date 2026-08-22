# Disable NINA in-app auto-update if the option is stored in the active profile.
# TheSky auto-update is a Bisque UI preference; this script also tries common ini keys.

$ErrorActionPreference = "Continue"
$profilePath = "$env:LOCALAPPDATA\NINA\Profiles\ac60d72d-015e-4360-a70f-cb43a7948cf4.profile"
if (Test-Path $profilePath) {
  $raw = Get-Content $profilePath -Raw
  $updated = $raw
  foreach ($pair in @(
      @("<AutoUpdate>true</AutoUpdate>", "<AutoUpdate>false</AutoUpdate>"),
      @("<CheckForUpdates>true</CheckForUpdates>", "<CheckForUpdates>false</CheckForUpdates>"),
      @("<AutomaticUpdate>true</AutomaticUpdate>", "<AutomaticUpdate>false</AutomaticUpdate>")
    )) {
    if ($updated.Contains($pair[0])) {
      $updated = $updated.Replace($pair[0], $pair[1])
      Write-Output ("NINA profile: set " + $pair[1])
    }
  }
  if ($updated -ne $raw) {
    Copy-Item $profilePath ($profilePath + ".pre-disable-autoupdate") -Force
    Set-Content -Path $profilePath -Value $updated -Encoding UTF8
  } else {
    Write-Output "NINA profile has no AutoUpdate XML keys."
  }
}

# NINA 3.2 AutoUpdateSource enum is only RELEASE/BETA/NIGHTLY (no None).
# Persist UseSavedProfileSelection so a GUI launch keeps ac60d72d.
$userConfig = "$env:LOCALAPPDATA\NINA\NINA_Url_ykulh1zxj2m4pcy4p3l2bndsanudr4ly\3.2.0.9001\user.config"
if (Test-Path $userConfig) {
  $uc = Get-Content $userConfig -Raw
  if ($uc -notmatch "AutoUpdateSource") {
    $insert = @"
            <setting name="AutoUpdateSource" serializeAs="String">
                <value>0</value>
            </setting>
"@
    $uc2 = $uc -replace '(<NINA\.Properties\.Settings>\s*)', ("`$1`r`n" + $insert)
    if ($uc2 -ne $uc) {
      Copy-Item $userConfig ($userConfig + ".bak") -Force
      Set-Content -Path $userConfig -Value $uc2 -Encoding UTF8
      Write-Output "Wrote AutoUpdateSource=0 (Release) into NINA 3.2 user.config. Uncheck auto-install in Options > General if a prompt appears."
    }
  } else {
    Write-Output "NINA 3.2 user.config already has AutoUpdateSource."
  }
}

$iniHits = Get-ChildItem "$env:USERPROFILE\Documents\Software Bisque" -Recurse -Include *.ini,*.xml -ErrorAction SilentlyContinue |
  Select-String -Pattern "AutoUpdate|CheckForUpdate|DownloadUpdate" |
  Select-Object -First 25 Path,Line
if ($iniHits) {
  $iniHits | Format-Table -AutoSize | Out-String -Width 200
} else {
  Write-Output "No TheSky AutoUpdate keys found in Documents\Software Bisque inis."
}

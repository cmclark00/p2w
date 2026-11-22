<#
.SYNOPSIS
  Updates the shop PC's offline Trade-In Calculator (the TradeInCalculator folder) from the website.

.DESCRIPTION
  The calculator's front end (index.html, app.js, dead-games.js, styles.css) and the TCG bulk rates
  (assets/bulk-rates.json) must match the website's copies. Instead of copying them by hand after
  every change, run this script. It downloads each file to a temporary folder, checks it looks right,
  keeps a backup of the old one, and only then replaces it. Files that are already current are left
  alone, so it is safe to run any time (for example from the "Start Trade-In Calculator" shortcut,
  right before server.ps1 starts).

  The complete compatible set is downloaded and validated before replacement.
  Download/validation errors keep the installed files; installation errors
  restore backups and remove newly installed files.

  It does NOT touch server.ps1, settings, prices, or the trade log.

.PARAMETER Folder
  The TradeInCalculator folder. Defaults to the folder this script is in.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Update-TradeInCalculator.ps1
#>
param(
  [string]$Folder = $PSScriptRoot,
  [string]$Site = 'https://play2wingames.com'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Each file, where it comes from, and text it must contain (so an error page is never installed).
$files = @(
  @{ Name = 'index.html';      Url = "$Site/trade-in/index.html";    Must = @('data-view="trade"', 'data-view="dead"', 'src="dead-games.js'); Dir = 'front' },
  @{ Name = 'app.js';          Url = "$Site/trade-in/app.js";        Must = @('DEFAULT_SETTINGS', 'function wireDeadGames'); Dir = 'front' },
  @{ Name = 'dead-games.js';   Url = "$Site/trade-in/dead-games.js"; Must = 'P2WDeadGames';     Dir = 'front' },
  @{ Name = 'styles.css';      Url = "$Site/trade-in/styles.css";    Must = '#printArea';       Dir = 'front' },
  @{ Name = 'bulk-rates.json'; Url = "$Site/assets/bulk-rates.json"; Must = '"groups"';         Dir = 'assets' }
)

if (-not (Test-Path -LiteralPath $Folder)) { throw "Folder not found: $Folder" }

# Where the calculator's files live: wherever its app.js is (the folder itself or a subfolder of it).
function Find-Existing([string]$name) {
  Get-ChildItem -LiteralPath $Folder -Recurse -Depth 3 -File -Filter $name -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '[\\/]backup-' } | Select-Object -First 1
}
$appJs = Find-Existing 'app.js'
$frontDir = if ($appJs) { $appJs.DirectoryName } else { $Folder }

$temp = Join-Path ([IO.Path]::GetTempPath()) ("p2w-tradein-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$backup = Join-Path $Folder ("backup-" + (Get-Date -Format 'yyyy-MM-dd_HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$updated = 0

try {
  # Download and validate the complete compatible set before touching installed files.
  $staged = @()
  foreach ($f in $files) {
    $existing = Find-Existing $f.Name
    $target = if ($existing) { $existing.FullName }
              elseif ($f.Dir -eq 'assets') { Join-Path (Join-Path $frontDir 'assets') $f.Name }
              else { Join-Path $frontDir $f.Name }

    $download = Join-Path $temp $f.Name
    try {
      Invoke-WebRequest -Uri ($f.Url + '?v=' + [DateTime]::UtcNow.Ticks) -OutFile $download -UseBasicParsing -TimeoutSec 30
    } catch {
      throw "Update aborted before installation: $($f.Name) couldn't download ($($_.Exception.Message)). All installed files were kept."
    }
    $text = [IO.File]::ReadAllText($download, [Text.Encoding]::UTF8)
    foreach ($marker in @($f.Must)) {
      if ($text.Length -lt 50 -or -not $text.Contains($marker)) {
        throw "Update aborted before installation: $($f.Name) is missing expected content. All installed files were kept."
      }
    }
    if ($f.Name -eq 'dead-games.js') {
      $match = [regex]::Match($text, '(?s)// BEGIN REGISTER DATA\s+const data = (.*?);\s+// END REGISTER DATA')
      if (-not $match.Success) { throw 'Register bundle has no valid data block; no installed files changed.' }
      $register = $match.Groups[1].Value | ConvertFrom-Json
      if ($register.schemaVersion -ne 1 -or @($register.entries).Count -lt 1) {
        throw 'Register bundle has an unsupported or empty snapshot; no installed files changed.'
      }
    }
    if ($f.Name -eq 'bulk-rates.json') { $null = $text | ConvertFrom-Json }
    $existed = Test-Path -LiteralPath $target
    $originalHash = if ($existed) { (Get-FileHash -LiteralPath $target).Hash } else { $null }
    $changed = -not $existed -or $originalHash -ne (Get-FileHash -LiteralPath $download).Hash
    $staged += [pscustomobject]@{ Name = $f.Name; Target = $target; Download = $download; Existed = $existed; OriginalHash = $originalHash; Changed = $changed }
  }
  $changes = @($staged | Where-Object { $_.Changed })
  # Reject a concurrently modified installation, then finish every backup first.
  foreach ($f in $staged) {
    if ((Test-Path -LiteralPath $f.Target) -ne $f.Existed -or
        ($f.Existed -and (Get-FileHash -LiteralPath $f.Target).Hash -ne $f.OriginalHash)) {
      throw 'Installed files changed while downloading. No update installed; run again after closing the other updater.'
    }
  }
  foreach ($f in $changes) {
    if ($f.Existed) {
      if (-not (Test-Path -LiteralPath $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }
      Copy-Item -LiteralPath $f.Target -Destination (Join-Path $backup $f.Name)
    }
  }
  $attempted = @()
  try {
    foreach ($f in $changes) {
      New-Item -ItemType Directory -Force -Path (Split-Path $f.Target) | Out-Null
      $attempted += $f
      Copy-Item -LiteralPath $f.Download -Destination $f.Target -Force
      $updated++
    }
  } catch {
    $installError = $_.Exception.Message
    $rollbackErrors = @()
    for ($i = $attempted.Count - 1; $i -ge 0; $i--) {
      $f = $attempted[$i]
      try {
        if ($f.Existed) { Copy-Item -LiteralPath (Join-Path $backup $f.Name) -Destination $f.Target -Force }
        elseif (Test-Path -LiteralPath $f.Target) { Remove-Item -LiteralPath $f.Target -Force }
      } catch { $rollbackErrors += $f.Target }
    }
    if ($rollbackErrors.Count) { throw "Install failed ($installError). Manual restore required for: $($rollbackErrors -join ', '). Backups: $backup" }
    throw "Install failed ($installError). Restored the prior files; backup: $backup"
  }
  foreach ($f in $staged) {
    if ($f.Changed) { Write-Host "  $($f.Name): updated" -ForegroundColor Green }
    else { Write-Host "  $($f.Name): already current" }
  }
} finally {
  # Only clean up this updater's exact temporary child directory.
  $resolvedTemp = [IO.Path]::GetFullPath($temp)
  $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
  if ([IO.Path]::GetDirectoryName($resolvedTemp) -eq $tempParent -and
      [IO.Path]::GetFileName($resolvedTemp).StartsWith('p2w-tradein-')) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($updated) {
  Write-Host "Updated $updated file(s). Old copies are in $backup" -ForegroundColor Green
  Write-Host 'Refresh the calculator page in the browser (Ctrl+F5) to load them.'
} else {
  Write-Host 'The calculator is already up to date.'
}

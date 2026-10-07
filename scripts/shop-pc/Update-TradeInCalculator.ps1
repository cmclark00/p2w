<#
.SYNOPSIS
  Updates the shop PC's offline Trade-In Calculator (the TradeInCalculator folder) from the website.

.DESCRIPTION
  The calculator's front end (index.html, app.js, styles.css) and the TCG bulk rates
  (assets/bulk-rates.json) must match the website's copies. Instead of copying them by hand after
  every change, run this script. It downloads each file to a temporary folder, checks it looks right,
  keeps a backup of the old one, and only then replaces it. Files that are already current are left
  alone, so it is safe to run any time (for example from the "Start Trade-In Calculator" shortcut,
  right before server.ps1 starts).

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
  @{ Name = 'index.html';      Url = "$Site/trade-in/index.html";    Must = 'src="app.js"';     Dir = 'front' },
  @{ Name = 'app.js';          Url = "$Site/trade-in/app.js";        Must = 'DEFAULT_SETTINGS'; Dir = 'front' },
  @{ Name = 'styles.css';      Url = "$Site/trade-in/styles.css";    Must = '#printArea';       Dir = 'front' },
  @{ Name = 'bulk-rates.json'; Url = "$Site/assets/bulk-rates.json"; Must = '"groups"';         Dir = 'assets' }
)

if (-not (Test-Path -LiteralPath $Folder)) { throw "Folder not found: $Folder" }

# Where the calculator's files live: wherever its app.js is (the folder itself or a subfolder of it).
function Find-Existing([string]$name) {
  Get-ChildItem -LiteralPath $Folder -Recurse -Depth 3 -File -Filter $name -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\backup-' } | Select-Object -First 1
}
$appJs = Find-Existing 'app.js'
$frontDir = if ($appJs) { $appJs.DirectoryName } else { $Folder }

$temp = Join-Path ([IO.Path]::GetTempPath()) ("p2w-tradein-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$backup = Join-Path $Folder ("backup-" + (Get-Date -Format 'yyyy-MM-dd_HHmmss'))
$updated = 0

try {
  foreach ($f in $files) {
    $existing = Find-Existing $f.Name
    $target = if ($existing) { $existing.FullName }
              elseif ($f.Dir -eq 'assets') { Join-Path (Join-Path $frontDir 'assets') $f.Name }
              else { Join-Path $frontDir $f.Name }

    $download = Join-Path $temp $f.Name
    try {
      Invoke-WebRequest -Uri ($f.Url + '?v=' + [DateTime]::UtcNow.Ticks) -OutFile $download -UseBasicParsing -TimeoutSec 30
    } catch {
      Write-Warning "$($f.Name): couldn't download ($($_.Exception.Message)). Kept the old copy."
      continue
    }
    $text = [IO.File]::ReadAllText($download, [Text.Encoding]::UTF8)
    if ($text.Length -lt 50 -or -not $text.Contains($f.Must)) {
      Write-Warning "$($f.Name): the download doesn't look right. Kept the old copy."
      continue
    }

    if ((Test-Path -LiteralPath $target) -and
        (Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $download).Hash) {
      Write-Host "  $($f.Name): already current"
      continue
    }

    if (Test-Path -LiteralPath $target) {
      if (-not (Test-Path -LiteralPath $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }
      Copy-Item -LiteralPath $target -Destination (Join-Path $backup $f.Name)
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    }
    Copy-Item -LiteralPath $download -Destination $target -Force
    Write-Host "  $($f.Name): updated" -ForegroundColor Green
    $updated++
  }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

if ($updated) {
  Write-Host "Updated $updated file(s). Old copies are in $backup" -ForegroundColor Green
  Write-Host 'Refresh the calculator page in the browser (Ctrl+F5) to load them.'
} else {
  Write-Host 'The calculator is already up to date.'
}

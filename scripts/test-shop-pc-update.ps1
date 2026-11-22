# Offline integration test: mocks downloads, changes only disposable temp fixtures.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot
$updater = Join-Path $PSScriptRoot 'shop-pc/Update-TradeInCalculator.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('p2w-updater-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$ctx = @{ Block = ''; Corrupt = ''; FailInstall = ''; Folder = '' }
$names = @('index.html', 'app.js', 'styles.css', 'assets/bulk-rates.json')
$checks = 0
function Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing, [int]$TimeoutSec)
  $url = [Uri]$Uri
  $name = [IO.Path]::GetFileName($url.AbsolutePath)
  if ($ctx.Block -eq $name) { throw 'Injected download failure' }
  if ($ctx.Corrupt -eq $name) {
    [IO.File]::WriteAllText($OutFile, 'P2WDeadGames ' + ('bad-content' * 20))
    return
  }
  $relative = $url.AbsolutePath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
  [IO.File]::Copy((Join-Path $repoRoot $relative), $OutFile)
}
function Copy-Item {
  param([string]$LiteralPath, [string]$Destination, [switch]$Force)
  if ($ctx.FailInstall -and $Destination -eq (Join-Path $ctx.Folder $ctx.FailInstall) -and
      $LiteralPath -match '[\\/]p2w-tradein-') {
    $ctx.FailInstall = ''
    throw 'Injected installation failure'
  }
  Microsoft.PowerShell.Management\Copy-Item @PSBoundParameters
}
function New-Fixture([string]$name) {
  $folder = Join-Path $testRoot $name
  New-Item -ItemType Directory -Path (Join-Path $folder 'assets') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $folder 'data') | Out-Null
  foreach ($n in $names) { [IO.File]::WriteAllText((Join-Path $folder $n), 'old-' + $n) }
  [IO.File]::WriteAllText((Join-Path $folder 'server.ps1'), 'KEEP-SERVER')
  [IO.File]::WriteAllText((Join-Path $folder 'data/settings.json'), 'KEEP-SETTINGS')
  $ctx.Folder = $folder; $ctx.Block = ''; $ctx.Corrupt = ''; $ctx.FailInstall = ''
  return $folder
}
function Assert-Original([string]$folder) {
  foreach ($n in $names) {
    if ([IO.File]::ReadAllText((Join-Path $folder $n)) -ne ('old-' + $n)) { throw "Changed installed file despite abort/rollback: $n" }
  }
  if (Test-Path -LiteralPath (Join-Path $folder 'dead-games.js')) { throw 'New dependency left installed after abort/rollback' }
  Assert-Private $folder
}
function Assert-Private([string]$folder) {
  if ([IO.File]::ReadAllText((Join-Path $folder 'server.ps1')) -ne 'KEEP-SERVER') { throw 'Server was changed' }
  if ([IO.File]::ReadAllText((Join-Path $folder 'data/settings.json')) -ne 'KEEP-SETTINGS') { throw 'Settings were changed' }
}
function Expect-Failure {
  $failed = $false
  try { & $updater -Folder $ctx.Folder -Site 'https://fixture.invalid' } catch { $failed = $true }
  if (-not $failed) { throw 'Expected the updater to refuse this fixture' }
  Assert-Original $ctx.Folder
}
try {
  $folder = New-Fixture 'success'
  & $updater -Folder $folder -Site 'https://fixture.invalid'
  foreach ($n in @('index.html', 'app.js', 'dead-games.js', 'styles.css', 'assets/bulk-rates.json')) {
    $source = if ($n.StartsWith('assets/')) { Join-Path $repoRoot $n } else { Join-Path (Join-Path $repoRoot 'trade-in') $n }
    if ((Get-FileHash -LiteralPath (Join-Path $folder $n)).Hash -ne (Get-FileHash -LiteralPath $source).Hash) { throw "Wrong installed file: $n" }
  }
  Assert-Private $folder
  & $updater -Folder $folder -Site 'https://fixture.invalid'
  if (@(Get-ChildItem -LiteralPath $folder -Directory -Filter 'backup-*').Count -ne 1) { throw 'Idempotent update created another backup' }
  Write-Output 'PASS complete update, backups, private-data preservation and idempotency'; $checks++
  $null = New-Fixture 'missing-html'; $ctx.Block = 'index.html'; Expect-Failure
  Write-Output 'PASS missing HTML aborts before any replacement'; $checks++
  $null = New-Fixture 'missing-dependency'; $ctx.Block = 'dead-games.js'; Expect-Failure
  Write-Output 'PASS missing new dependency preserves the entire installed set'; $checks++
  $null = New-Fixture 'invalid-dependency'; $ctx.Corrupt = 'dead-games.js'; Expect-Failure
  Write-Output 'PASS malformed register bundle aborts before installation'; $checks++
  $null = New-Fixture 'install-failure'; $ctx.FailInstall = 'styles.css'; Expect-Failure
  Write-Output 'PASS mid-install failure restores old files and removes newly installed dependency'; $checks++
  Write-Output "$checks shop-PC updater checks passed."
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
  if ([IO.Path]::GetDirectoryName($resolved) -eq $tempParent -and [IO.Path]::GetFileName($resolved).StartsWith('p2w-updater-test-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  } else { throw 'Unexpected updater test cleanup target' }
}

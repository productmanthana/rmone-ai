<#
.SYNOPSIS
  Register (or update) the merged RMONE Node process as a Windows Service via nssm.

.DESCRIPTION
  Reads KEY=VALUE pairs from .env.production and runs the equivalent
  `nssm install` / `nssm set` commands documented in docs/vm-deployment.md §2.6.

  Re-running the script against an already-installed service updates its
  configuration in place (env vars, paths, logs) and restarts it.

.PARAMETER ServiceName
  Windows Service name. Defaults to "rmone".

.PARAMETER AppRoot
  Repository root on the VM. Defaults to the parent of this script's directory.

.PARAMETER EnvFile
  Path to the env file to load. Defaults to "<AppRoot>\.env.production".

.PARAMETER NodeExe
  Full path to node.exe. Defaults to "C:\Program Files\nodejs\node.exe".

.PARAMETER NssmExe
  Full path to nssm.exe. Defaults to "nssm" (must be on PATH).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-windows-service.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-windows-service.ps1 `
    -ServiceName rmone -AppRoot C:\apps\rmone
#>

[CmdletBinding()]
param(
  [string]$ServiceName = "rmone",
  [string]$AppRoot,
  [string]$EnvFile,
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe",
  [string]$NssmExe = "nssm"
)

$ErrorActionPreference = "Stop"

if (-not $AppRoot) {
  $AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
if (-not $EnvFile) {
  $EnvFile = Join-Path $AppRoot ".env.production"
}

Write-Host "[install-windows-service] AppRoot:    $AppRoot"
Write-Host "[install-windows-service] EnvFile:    $EnvFile"
Write-Host "[install-windows-service] Service:    $ServiceName"

# --- Sanity checks ---------------------------------------------------------

if (-not (Test-Path $EnvFile)) {
  throw "Env file not found: $EnvFile"
}
if (-not (Test-Path $NodeExe)) {
  throw "node.exe not found at: $NodeExe (override with -NodeExe)"
}

$nssmCmd = Get-Command $NssmExe -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
  throw "nssm not found (looked for '$NssmExe'). Install from https://nssm.cc/download or pass -NssmExe."
}

$entryScript = Join-Path $AppRoot "artifacts\api-server\dist\index.mjs"
if (-not (Test-Path $entryScript)) {
  Write-Warning "Entry script does not exist yet: $entryScript"
  Write-Warning "Run 'pnpm run build:vm' before starting the service."
}

$webDirAbs = Join-Path $AppRoot "artifacts\rmone-web\dist\public"
$logsDir   = Join-Path $AppRoot "logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}
$stdoutLog = Join-Path $logsDir "stdout.log"
$stderrLog = Join-Path $logsDir "stderr.log"

# --- Parse .env.production -------------------------------------------------

function ConvertFrom-DotEnv {
  param([string]$Path)
  $map = [ordered]@{}
  foreach ($raw in Get-Content -LiteralPath $Path) {
    $line = $raw.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    if ($line.StartsWith("export ")) { $line = $line.Substring(7).Trim() }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if ($val.Length -ge 2) {
      $first = $val[0]; $last = $val[$val.Length - 1]
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $val = $val.Substring(1, $val.Length - 2)
      }
    }
    $map[$key] = $val
  }
  return $map
}

$envMap = ConvertFrom-DotEnv -Path $EnvFile

# Defaults / overrides required by the merged process.
if (-not $envMap.Contains("PORT"))           { $envMap["PORT"]           = "5000" }
if (-not $envMap.Contains("NODE_ENV"))       { $envMap["NODE_ENV"]       = "production" }
$envMap["SERVE_WEB_DIR"] = $webDirAbs

# nssm AppEnvironmentExtra wants NUL-separated KEY=VALUE pairs when passed as
# a single argument. Easiest cross-version approach: pass each pair as its own
# argument after the "AppEnvironmentExtra" verb.
$envArgs = @()
foreach ($k in $envMap.Keys) {
  $envArgs += "$k=$($envMap[$k])"
}

Write-Host "[install-windows-service] Loaded $($envMap.Count) env vars from $EnvFile"

# --- Install or update -----------------------------------------------------

function Invoke-Nssm {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
  & $NssmExe @Args
  if ($LASTEXITCODE -ne 0) {
    throw "nssm $($Args -join ' ') failed with exit $LASTEXITCODE"
  }
}

$existing = & $NssmExe status $ServiceName 2>&1
$serviceExists = ($LASTEXITCODE -eq 0)

if ($serviceExists) {
  Write-Host "[install-windows-service] Service '$ServiceName' exists (status: $existing) — updating in place."
  # Stop before reconfiguring so AppEnvironmentExtra changes take effect on
  # the next start. nssm returns non-zero if the service is already stopped,
  # so we deliberately ignore the exit code here.
  & $NssmExe stop $ServiceName confirm | Out-Null
  $LASTEXITCODE = 0
  Invoke-Nssm set $ServiceName Application $NodeExe
  Invoke-Nssm set $ServiceName AppParameters $entryScript
} else {
  Write-Host "[install-windows-service] Installing new service '$ServiceName'."
  Invoke-Nssm install $ServiceName $NodeExe $entryScript
}

Invoke-Nssm set $ServiceName AppDirectory $AppRoot
Invoke-Nssm set $ServiceName AppStdout    $stdoutLog
Invoke-Nssm set $ServiceName AppStderr    $stderrLog
Invoke-Nssm set $ServiceName Start        SERVICE_AUTO_START
Invoke-Nssm set $ServiceName AppEnvironmentExtra @envArgs

Write-Host "[install-windows-service] Starting '$ServiceName'..."
Invoke-Nssm start $ServiceName

Start-Sleep -Seconds 1
$finalStatus = & $NssmExe status $ServiceName
Write-Host "[install-windows-service] Service status: $finalStatus"
Write-Host "[install-windows-service] stdout log: $stdoutLog"
Write-Host "[install-windows-service] stderr log: $stderrLog"
Write-Host "[install-windows-service] Done."

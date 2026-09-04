$ErrorActionPreference = "Stop"

$Workspace = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Workspace ".env"

if (!(Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Create it before starting RM ONE locally."
}

# Load the local file into this process so both the AWS CLI and Node receive the
# same settings. Values are never printed.
Get-Content $EnvFile | ForEach-Object {
  $Line = $_.Trim()
  if (!$Line -or $Line.StartsWith("#")) {
    return
  }

  $Parts = $Line -split "=", 2
  if ($Parts.Count -ne 2) {
    return
  }

  $Name = $Parts[0].Trim()
  $Value = $Parts[1].Trim()
  if (
    ($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
    ($Value.StartsWith("'") -and $Value.EndsWith("'"))
  ) {
    $Value = $Value.Substring(1, $Value.Length - 2)
  }

  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

if (!$env:APP_DATABASE_URL) {
  throw "APP_DATABASE_URL is missing from .env."
}

$DatabaseUrl = [System.Uri]$env:APP_DATABASE_URL
if ($DatabaseUrl.Host -notin @("127.0.0.1", "localhost") -or $DatabaseUrl.Port -ne 14330) {
  throw "For local startup, APP_DATABASE_URL must use 127.0.0.1:14330 through the private tunnel."
}

if (!$env:AWS_REGION) {
  $env:AWS_REGION = "us-east-1"
}
if (!$env:SERVE_WEB_DIR) {
  $env:SERVE_WEB_DIR = "artifacts/rmone-web/dist/public"
}

$Aws = (Get-Command aws -ErrorAction Stop).Source
$Node = (Get-Command node -ErrorAction Stop).Source

Push-Location $Workspace
$Tunnel = $null

try {
  Write-Host "Finding the private AWS database route..."

  $RunnerId = (& $Aws ec2 describe-instances `
    --region $env:AWS_REGION `
    --filters "Name=tag:Name,Values=rmone-migration-runner" "Name=instance-state-name,Values=running" `
    --query "Reservations[0].Instances[0].InstanceId" `
    --output text).Trim()

  $RdsHost = (& $Aws rds describe-db-instances `
    --region $env:AWS_REGION `
    --db-instance-identifier rmoneqa `
    --query "DBInstances[0].Endpoint.Address" `
    --output text).Trim()

  if (!$RunnerId -or $RunnerId -eq "None") {
    throw "The running RM ONE migration runner was not found."
  }
  if (!$RdsHost -or $RdsHost -eq "None") {
    throw "The rmoneqa database endpoint was not found."
  }

  Write-Host "Opening the secure database tunnel..."
  $Tunnel = Start-Process `
    -FilePath $Aws `
    -ArgumentList @(
      "ssm", "start-session",
      "--region", $env:AWS_REGION,
      "--target", $RunnerId,
      "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
      "--parameters", "host=$RdsHost,portNumber=1433,localPortNumber=14330"
    ) `
    -WindowStyle Hidden `
    -PassThru

  $Connected = $false
  for ($Attempt = 1; $Attempt -le 30; $Attempt++) {
    if ($Tunnel.HasExited) {
      throw "The AWS database tunnel exited before opening port 14330."
    }

    $Client = [System.Net.Sockets.TcpClient]::new()
    try {
      $Connect = $Client.ConnectAsync("127.0.0.1", 14330)
      if ($Connect.Wait(250) -and $Client.Connected) {
        $Connected = $true
        break
      }
    }
    catch {
      # The tunnel is still starting.
    }
    finally {
      $Client.Dispose()
    }

    Start-Sleep -Milliseconds 750
  }

  if (!$Connected) {
    throw "The database tunnel did not open on 127.0.0.1:14330."
  }

  Write-Host "Database tunnel ready. Starting RM ONE..."
  & $Node --env-file=".env" artifacts/api-server/dist/index.mjs
  exit $LASTEXITCODE
}
finally {
  if ($Tunnel -and !$Tunnel.HasExited) {
    Write-Host "Closing the database tunnel..."
    & taskkill.exe /PID $Tunnel.Id /T /F 2>$null | Out-Null
  }
  Pop-Location
}
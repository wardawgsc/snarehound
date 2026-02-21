param(
    [string]$AgentSharedToken = "",
    [int]$Port = 4000
)

$workspaceRoot = Split-Path -Parent $PSScriptRoot
Set-Location $workspaceRoot

function Import-EnvFile {
    param(
        [string]$FilePath
    )

    if (-not (Test-Path $FilePath)) {
        return
    }

    Get-Content $FilePath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }

        $idx = $line.IndexOf("=")
        if ($idx -lt 1) {
            return
        }

        $name = $line.Substring(0, $idx).Trim()
        $value = $line.Substring($idx + 1)
        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }

    Write-Host "[backend] Loaded env vars from $FilePath"
}

$envLocalPath = Join-Path $workspaceRoot "infra\env\.env.local"
if (-not (Test-Path $envLocalPath)) {
    $envExamplePath = Join-Path $workspaceRoot "infra\env\.env.local.example"
    if (Test-Path $envExamplePath) {
        Copy-Item -Path $envExamplePath -Destination $envLocalPath -Force
        Write-Host "[backend] Created $envLocalPath from .env.local.example"
    }
}

Import-EnvFile -FilePath $envLocalPath

$requiredDiscordVars = @(
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
    "DISCORD_REQUIRED_GUILD_ID"
)

$missingDiscordVars = @()
foreach ($varName in $requiredDiscordVars) {
    $value = [System.Environment]::GetEnvironmentVariable($varName, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
        $missingDiscordVars += $varName
    }
}

if ($missingDiscordVars.Count -gt 0) {
    Write-Host "[backend] Discord auth is NOT ready. Missing env vars: $($missingDiscordVars -join ', ')" -ForegroundColor Yellow
    Write-Host "[backend] Edit infra/env/.env.local, then restart backend to enable Open Discord Login." -ForegroundColor Yellow
}

if ([string]::IsNullOrWhiteSpace($AgentSharedToken)) {
    $AgentSharedToken = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
}

$env:AGENT_SHARED_TOKEN = $AgentSharedToken
$env:PORT = "$Port"

Write-Host "[backend] AGENT_SHARED_TOKEN set (length=$($AgentSharedToken.Length))"
Write-Host "[backend] PORT=$Port"
Write-Host "[backend] Starting dev backend..."

npm run dev:backend

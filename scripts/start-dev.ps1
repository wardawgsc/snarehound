param(
    [string]$AgentSharedToken = "",
    [string]$BackendUrl = "http://localhost:4000",
    [int]$Port = 4000,
    [string]$GameLogPath = "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\game.log",
    [bool]$EnableMockEvent = $true
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

    Write-Host "[dev] Loaded env vars from $FilePath"
}

$envLocalPath = Join-Path $workspaceRoot "infra\env\.env.local"
if (-not (Test-Path $envLocalPath)) {
    $envExamplePath = Join-Path $workspaceRoot "infra\env\.env.local.example"
    if (Test-Path $envExamplePath) {
        Copy-Item -Path $envExamplePath -Destination $envLocalPath -Force
        Write-Host "[dev] Created $envLocalPath from .env.local.example"
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
    Write-Host "[dev] Discord auth is NOT ready. Missing env vars: $($missingDiscordVars -join ', ')" -ForegroundColor Yellow
    Write-Host "[dev] Edit infra/env/.env.local, then restart start-dev.ps1 to enable Open Discord Login." -ForegroundColor Yellow
}

if ([string]::IsNullOrWhiteSpace($AgentSharedToken)) {
    $AgentSharedToken = & "$PSScriptRoot\new-agent-token.ps1"
}

Write-Host "[dev] Using AGENT_SHARED_TOKEN length=$($AgentSharedToken.Length)"
Write-Host "[dev] Backend URL: $BackendUrl"
Write-Host "[dev] Game log: $GameLogPath"

$backendCommand = @(
    "Set-Location '$workspaceRoot'",
    "`$env:AGENT_SHARED_TOKEN = '$AgentSharedToken'",
    "`$env:PORT = '$Port'",
    "npm run dev:backend"
) -join "; "

$frontendCommand = @(
    "Set-Location '$workspaceRoot'",
    "npm run dev:frontend"
) -join "; "

$agentCommand = @(
    "Set-Location '$workspaceRoot'",
    "`$env:AGENT_SHARED_TOKEN = '$AgentSharedToken'",
    "`$env:AGENT_BACKEND_URL = '$BackendUrl'",
    "`$env:AGENT_LOG_FILE_PATH = '$GameLogPath'",
    "`$env:AGENT_ENABLE_MOCK_EVENT = '$($EnableMockEvent.ToString().ToLowerInvariant())'",
    "npm run dev:agent"
) -join "; "

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand
Start-Sleep -Milliseconds 500
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand
Start-Sleep -Milliseconds 500
Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCommand

Write-Host "[dev] Started backend + frontend + agent in separate windows."
Write-Host "[dev] GUI: http://localhost:5173"
Write-Host "[dev] Reuse this token for frontend auth testing if needed:"
Write-Host $AgentSharedToken

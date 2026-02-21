param(
    [string]$AgentSharedToken,
    [string]$BackendUrl = "http://localhost:4000",
    [string]$GameLogPath = "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\game.log",
    [int]$HeartbeatMs = 15000,
    [int]$PollMs = 700,
    [int]$FlushMs = 1500,
    [bool]$EnableMockEvent = $true
)

$workspaceRoot = Split-Path -Parent $PSScriptRoot
Set-Location $workspaceRoot

if ([string]::IsNullOrWhiteSpace($AgentSharedToken)) {
    throw "AgentSharedToken is required. Pass -AgentSharedToken <token> from backend startup."
}

$env:AGENT_SHARED_TOKEN = $AgentSharedToken
$env:AGENT_BACKEND_URL = $BackendUrl
$env:AGENT_LOG_FILE_PATH = $GameLogPath
$env:AGENT_HEARTBEAT_MS = "$HeartbeatMs"
$env:AGENT_LOG_POLL_MS = "$PollMs"
$env:AGENT_SIGNATURE_FLUSH_MS = "$FlushMs"
$env:AGENT_ENABLE_MOCK_EVENT = $EnableMockEvent.ToString().ToLowerInvariant()

Write-Host "[agent] AGENT_BACKEND_URL=$BackendUrl"
Write-Host "[agent] AGENT_LOG_FILE_PATH=$GameLogPath"
Write-Host "[agent] AGENT_SHARED_TOKEN set (length=$($AgentSharedToken.Length))"
Write-Host "[agent] Starting dev local-agent..."

npm run dev:agent

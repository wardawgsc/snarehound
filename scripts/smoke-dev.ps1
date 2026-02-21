param(
    [string]$BackendUrl = "http://localhost:4000",
    [string]$FrontendUrl = "http://localhost:5173"
)

function Test-Http {
    param(
        [string]$Url,
        [string]$Label,
        [switch]$ExpectJson
    )

    try {
        if ($ExpectJson) {
            $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 6 -ErrorAction Stop
            Write-Host "[PASS] $Label"
            return $response
        }

        $null = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 6 -ErrorAction Stop
        Write-Host "[PASS] $Label"
        return $true
    } catch {
        Write-Host "[FAIL] $Label :: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

Write-Host "[smoke] Backend: $BackendUrl"
Write-Host "[smoke] Frontend: $FrontendUrl"

$health = Test-Http -Url "$BackendUrl/health" -Label "Backend health endpoint" -ExpectJson
$frontend = Test-Http -Url $FrontendUrl -Label "Frontend reachable"
$authStart = Test-Http -Url "$BackendUrl/v1/auth/discord/start" -Label "Discord auth start endpoint" -ExpectJson
$agentStatus = Test-Http -Url "$BackendUrl/v1/agent/status" -Label "Agent status endpoint" -ExpectJson

if ($health) {
    Write-Host "[info] Health status: $($health.status)"
}

if ($authStart -and $authStart.authorizeUrl) {
    Write-Host "[info] Discord authorize URL generated."
}

if ($agentStatus -and $agentStatus.agents) {
    $agents = @($agentStatus.agents)
    Write-Host "[info] Agents connected: $($agents.Count)"
    foreach ($agent in $agents) {
        $online = if ($agent.isOnline) { "online" } else { "stale/offline" }
        Write-Host ("       - {0} ({1})" -f $agent.agentId, $online)
    }
}

$allPass = $health -and $frontend -and $authStart -and $agentStatus
if ($allPass) {
    Write-Host "[smoke] PASS: core dev services are ready." -ForegroundColor Green
    exit 0
}

Write-Host "[smoke] FAIL: one or more checks failed." -ForegroundColor Yellow
exit 1

param(
    [string]$BackendUrl = "http://localhost:4000",
    [string]$FrontendUrl = "http://localhost:5173",
    [int]$RecentLimit = 5
)

function Try-GetJson {
    param(
        [string]$Url
    )

    try {
        return Invoke-RestMethod -Uri $Url -Method Get -ErrorAction Stop
    } catch {
        return $null
    }
}

Write-Host "[status-dev] Backend URL: $BackendUrl"
Write-Host "[status-dev] Frontend URL: $FrontendUrl"

try {
    $null = Invoke-WebRequest -Uri $FrontendUrl -Method Get -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
    Write-Host "[status-dev] Frontend reachable."
} catch {
    Write-Host "[status-dev] Frontend unreachable."
}

$health = Try-GetJson -Url "$BackendUrl/health"
if (-not $health) {
    Write-Host "[status-dev] Backend unreachable."
    return
}

Write-Host "[status-dev] Health: $($health.status) ($($health.service))"

$agentStatus = Try-GetJson -Url "$BackendUrl/v1/agent/status"
if (-not $agentStatus) {
    Write-Host "[status-dev] Could not read /v1/agent/status"
} else {
    $agents = @($agentStatus.agents)
    Write-Host "[status-dev] Connected agents: $($agents.Count)"
    foreach ($agent in $agents) {
        $lastSeenLocal = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$agent.lastSeenAt).LocalDateTime
        Write-Host ("  - {0} | status={1} | version={2} | platform={3} | lastSeen={4}" -f $agent.agentId, $agent.status, $agent.version, $agent.platform, $lastSeenLocal)
    }
}

$recent = Try-GetJson -Url "$BackendUrl/v1/agent/events/recent?limit=$RecentLimit"
if (-not $recent) {
    Write-Host "[status-dev] Could not read /v1/agent/events/recent"
} else {
    $events = @($recent.events)
    Write-Host "[status-dev] Recent events: $($events.Count)"
    foreach ($item in $events) {
        $eventType = $item.event.type
        Write-Host ("  - {0} | agent={1} | type={2}" -f $item.receivedAt, $item.agentId, $eventType)
    }
}

$patterns = @(
    "tsx watch src/index.ts",
    "npm run dev:backend",
    "npm run dev:frontend",
    "npm run dev:agent"
)

$allCandidates = Get-CimInstance Win32_Process | Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) { return $false }

    foreach ($pattern in $patterns) {
        if ($cmd -like "*$pattern*") {
            return $true
        }
    }

    return $false
}

if (-not $allCandidates -or $allCandidates.Count -eq 0) {
    Write-Host "[stop-dev] No matching dev backend/agent processes found."
    return
}

Write-Host "[stop-dev] Found $($allCandidates.Count) process(es). Stopping..."

$stopped = 0
foreach ($proc in $allCandidates) {
    try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        $stopped++
        Write-Host "[stop-dev] Stopped PID $($proc.ProcessId)"
    } catch {
        Write-Host "[stop-dev] Failed to stop PID $($proc.ProcessId): $($_.Exception.Message)"
    }
}

Write-Host "[stop-dev] Completed. Stopped $stopped process(es)."

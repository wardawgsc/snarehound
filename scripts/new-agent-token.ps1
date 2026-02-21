$token = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
Write-Output $token

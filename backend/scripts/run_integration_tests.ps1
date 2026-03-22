Param(
    [string]$GoImage = "golang:1.22-alpine",
    [string]$MariaDBImage = "mariadb:11"
)

$ErrorActionPreference = "Stop"

$backendDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$networkName = "speed-inventory-int-" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
$containerName = "speed-inventory-db-int-" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
$dbName = "speed_inventory_management_test"
$dbUser = "testuser"
$dbPassword = "testpass"

function Invoke-Docker {
    param([string[]]$DockerArgs)
    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker command failed: docker $($DockerArgs -join ' ')"
    }
}

try {
    Write-Host "Creating Docker network $networkName"
    Invoke-Docker -DockerArgs @("network", "create", $networkName) | Out-Null

    Write-Host "Starting MariaDB integration container $containerName"
    Invoke-Docker -DockerArgs @(
        "run", "-d", "--rm",
        "--name", $containerName,
        "--network", $networkName,
        "-e", "MARIADB_ROOT_PASSWORD=rootpass",
        "-e", "MARIADB_DATABASE=$dbName",
        "-e", "MARIADB_USER=$dbUser",
        "-e", "MARIADB_PASSWORD=$dbPassword",
        $MariaDBImage,
        "--character-set-server=utf8mb4",
        "--collation-server=utf8mb4_unicode_ci"
    ) | Out-Null

    Write-Host "Waiting for MariaDB to become ready"
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Invoke-Docker -DockerArgs @("exec", $containerName, "mariadb-admin", "ping", "-h", "127.0.0.1", "--user=$dbUser", "--password=$dbPassword", "--silent") | Out-Null
            $ready = $true
            break
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    if (-not $ready) {
        throw "MariaDB did not become ready in time."
    }

    Write-Host "Running service integration tests"
    Invoke-Docker -DockerArgs @(
        "run", "--rm",
        "--network", $networkName,
        "-v", "${backendDir}:/app",
        "-w", "/app",
        "-e", "TEST_MYSQL_HOST=$containerName",
        "-e", "TEST_MYSQL_PORT=3306",
        "-e", "TEST_MYSQL_DATABASE=$dbName",
        "-e", "TEST_MYSQL_USER=$dbUser",
        "-e", "TEST_MYSQL_PASSWORD=$dbPassword",
        $GoImage,
        "sh", "-c", "go test ./internal/service -run Integration -count=1"
    )
}
finally {
    try { & docker @("rm", "-f", $containerName) *> $null } catch {}
    try { & docker @("network", "rm", $networkName) *> $null } catch {}
}

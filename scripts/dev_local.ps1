Param(
    [ValidateSet("db", "backend", "frontend", "all")]
    [string]$Target = "db",
    [string]$ComposeFile = "docker-compose.yml",
    [string]$DbService = "mariadb",
    [string]$DbContainer = "speed-inventory-db",
    [string]$AppEnv = "development",
    [string]$BackendPort = "8080",
    [string]$FrontendOrigin = "http://localhost:5173",
    [string]$FrontendApiBaseUrl = "http://localhost:8080/api",
    [string]$DbHost = "127.0.0.1",
    [string]$DbPort = "3306",
    [string]$DbName = "speed_inventory_management",
    [string]$DbUser = "inventory_user",
    [string]$DbPassword = "inventory_pass",
    [int]$DbWaitTimeoutSeconds = 90,
    [switch]$SkipDatabase,
    [switch]$LaunchWindows
)

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"
$composePath = Join-Path $rootDir $ComposeFile

function Require-Command {
    param(
        [string]$CommandName,
        [string]$MissingMessage
    )

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw $MissingMessage
    }
}

function Invoke-CheckedCommand {
    param(
        [scriptblock]$Script,
        [string]$FailureMessage
    )

    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

function Wait-ForDatabase {
    $deadline = (Get-Date).AddSeconds($DbWaitTimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $status = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $DbContainer 2>$null)
        if ($LASTEXITCODE -eq 0) {
            $trimmedStatus = $status.Trim()
            if ($trimmedStatus -eq "healthy" -or $trimmedStatus -eq "running") {
                Write-Host "==> Database is $trimmedStatus"
                return
            }
        }

        Start-Sleep -Seconds 2
    }

    throw "Database container '$DbContainer' did not become healthy within $DbWaitTimeoutSeconds seconds."
}

function Start-Database {
    Require-Command -CommandName "docker" -MissingMessage "Docker is required for local DB mode. Install Docker Desktop and make sure 'docker' is available in PowerShell."

    Write-Host "==> Starting local MariaDB container"
    Push-Location $rootDir
    try {
        Invoke-CheckedCommand -FailureMessage "Failed to start Docker MariaDB service." -Script {
            docker compose -f $composePath up -d $DbService
        }
    } finally {
        Pop-Location
    }

    Wait-ForDatabase
}

function Run-Backend {
    Require-Command -CommandName "go" -MissingMessage "Go 1.22+ is required to run the backend locally. Install Go and reopen PowerShell, or keep using the Docker backend workflow."

    if (-not $SkipDatabase) {
        Start-Database
    }

    Write-Host "==> Starting backend locally on port $BackendPort"
    Push-Location $backendDir
    try {
        $env:APP_ENV = $AppEnv
        $env:SERVER_PORT = $BackendPort
        $env:FRONTEND_ORIGIN = $FrontendOrigin
        $env:DB_HOST = $DbHost
        $env:DB_PORT = $DbPort
        $env:DB_NAME = $DbName
        $env:DB_USER = $DbUser
        $env:DB_PASSWORD = $DbPassword

        Invoke-CheckedCommand -FailureMessage "Backend process exited with a non-zero status." -Script {
            go run ./cmd/server
        }
    } finally {
        Pop-Location
    }
}

function Run-Frontend {
    Require-Command -CommandName "npm" -MissingMessage "npm is required to run the frontend locally. Install Node.js 24 and reopen PowerShell."

    Write-Host "==> Starting frontend locally"
    Push-Location $frontendDir
    try {
        $env:VITE_API_BASE_URL = $FrontendApiBaseUrl

        Invoke-CheckedCommand -FailureMessage "Frontend dev server exited with a non-zero status." -Script {
            npm run dev
        }
    } finally {
        Pop-Location
    }
}

function New-BackendWindowCommand {
    $escapedBackendDir = $backendDir.Replace("'", "''")
    return @(
        "Set-Location '$escapedBackendDir'",
        "`$env:APP_ENV = '$AppEnv'",
        "`$env:SERVER_PORT = '$BackendPort'",
        "`$env:FRONTEND_ORIGIN = '$FrontendOrigin'",
        "`$env:DB_HOST = '$DbHost'",
        "`$env:DB_PORT = '$DbPort'",
        "`$env:DB_NAME = '$DbName'",
        "`$env:DB_USER = '$DbUser'",
        "`$env:DB_PASSWORD = '$DbPassword'",
        "go run ./cmd/server"
    ) -join "; "
}

function New-FrontendWindowCommand {
    $escapedFrontendDir = $frontendDir.Replace("'", "''")
    return @(
        "Set-Location '$escapedFrontendDir'",
        "`$env:VITE_API_BASE_URL = '$FrontendApiBaseUrl'",
        "npm run dev"
    ) -join "; "
}

function Show-AllInstructions {
    Write-Host ""
    Write-Host "==> Local DB is ready. Run these in two separate terminals:"
    Write-Host ""
    Write-Host "PowerShell terminal 1:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\dev_local.ps1 -Target backend"
    Write-Host ""
    Write-Host "PowerShell terminal 2:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\dev_local.ps1 -Target frontend"
    Write-Host ""
    Write-Host "Tip: add -SkipDatabase when the DB container is already running."
}

switch ($Target) {
    "db" {
        Start-Database
    }
    "backend" {
        Run-Backend
    }
    "frontend" {
        Run-Frontend
    }
    "all" {
        Start-Database

        if ($LaunchWindows) {
            Require-Command -CommandName "go" -MissingMessage "Go 1.22+ is required to launch the backend locally. Install Go and reopen PowerShell, or run only the frontend locally."
            Require-Command -CommandName "npm" -MissingMessage "npm is required to launch the frontend locally. Install Node.js 24 and reopen PowerShell."
            Write-Host "==> Launching backend and frontend in separate PowerShell windows"
            Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", (New-BackendWindowCommand) | Out-Null
            Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", (New-FrontendWindowCommand) | Out-Null
            Write-Host "==> Both local dev windows have been opened."
        } else {
            Show-AllInstructions
        }
    }
}

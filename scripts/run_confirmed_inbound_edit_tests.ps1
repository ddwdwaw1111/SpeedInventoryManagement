Param(
    [string]$GoImage = "golang:1.22-alpine",
    [string]$MariaDBImage = "mariadb:11"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "run_integration_tests.ps1"

& powershell -ExecutionPolicy Bypass -File $scriptPath `
    -GoImage $GoImage `
    -MariaDBImage $MariaDBImage `
    -TestPattern "TestConfirmedInboundDocumentEdit"

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

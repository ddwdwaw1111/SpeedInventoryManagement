Param(
    [string]$BaseUrl = "https://www.corgi4ever.com",
    [string]$LoginEmail = "admin@gmail.com",
    [string]$LoginPassword = "password",
    [int]$Rate = 20,
    [string]$Duration = "5m",
    [int]$PreAllocatedVUs = 20,
    [int]$MaxVUs = 200,
    [string]$K6Image = "grafana/k6:0.49.0"
)

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputDir = Join-Path $rootDir "dist\\perf"
$null = New-Item -ItemType Directory -Path $outputDir -Force
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$summaryHostPath = Join-Path $outputDir "read-only-mix-$timestamp.json"
$summaryContainerPath = "/work/dist/perf/read-only-mix-$timestamp.json"

Write-Host "==> Running read-only mix performance test"
Write-Host "    Base URL: $BaseUrl"
Write-Host "    Rate: $Rate req/s"
Write-Host "    Duration: $Duration"
Write-Host "    Summary: $summaryHostPath"

& docker run --rm -i `
  -v "${rootDir}:/work" `
  -w /work `
  -e "BASE_URL=$BaseUrl" `
  -e "LOGIN_EMAIL=$LoginEmail" `
  -e "LOGIN_PASSWORD=$LoginPassword" `
  -e "RATE=$Rate" `
  -e "DURATION=$Duration" `
  -e "PRE_ALLOCATED_VUS=$PreAllocatedVUs" `
  -e "MAX_VUS=$MaxVUs" `
  $K6Image run `
  --summary-export $summaryContainerPath `
  /work/scripts/perf/read_only_mix.js

if ($LASTEXITCODE -ne 0) {
    throw "k6 read-only mix test failed"
}

Write-Host "==> Done. Summary written to $summaryHostPath"

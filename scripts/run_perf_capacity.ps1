Param(
    [string]$BaseUrl = "https://www.corgi4ever.com",
    [string]$LoginEmail = "admin@gmail.com",
    [string]$LoginPassword = "password",
    [int]$Stage1Rate = 10,
    [int]$Stage2Rate = 25,
    [int]$Stage3Rate = 50,
    [int]$Stage4Rate = 75,
    [int]$Stage5Rate = 100,
    [string]$Stage1Duration = "30s",
    [string]$Stage2Duration = "1m",
    [string]$Stage3Duration = "1m",
    [string]$Stage4Duration = "1m",
    [string]$Stage5Duration = "1m",
    [string]$CooldownDuration = "30s",
    [int]$PreAllocatedVUs = 50,
    [int]$MaxVUs = 500,
    [string]$K6Image = "grafana/k6:0.49.0"
)

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputDir = Join-Path $rootDir "dist\\perf"
$null = New-Item -ItemType Directory -Path $outputDir -Force
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$summaryHostPath = Join-Path $outputDir "capacity-ramp-$timestamp.json"
$summaryContainerPath = "/work/dist/perf/capacity-ramp-$timestamp.json"

Write-Host "==> Running capacity ramp performance test"
Write-Host "    Base URL: $BaseUrl"
Write-Host "    Summary: $summaryHostPath"

& docker run --rm -i `
  -v "${rootDir}:/work" `
  -w /work `
  -e "BASE_URL=$BaseUrl" `
  -e "LOGIN_EMAIL=$LoginEmail" `
  -e "LOGIN_PASSWORD=$LoginPassword" `
  -e "STAGE1_RATE=$Stage1Rate" `
  -e "STAGE2_RATE=$Stage2Rate" `
  -e "STAGE3_RATE=$Stage3Rate" `
  -e "STAGE4_RATE=$Stage4Rate" `
  -e "STAGE5_RATE=$Stage5Rate" `
  -e "STAGE1_DURATION=$Stage1Duration" `
  -e "STAGE2_DURATION=$Stage2Duration" `
  -e "STAGE3_DURATION=$Stage3Duration" `
  -e "STAGE4_DURATION=$Stage4Duration" `
  -e "STAGE5_DURATION=$Stage5Duration" `
  -e "COOLDOWN_DURATION=$CooldownDuration" `
  -e "PRE_ALLOCATED_VUS=$PreAllocatedVUs" `
  -e "MAX_VUS=$MaxVUs" `
  $K6Image run `
  --summary-export $summaryContainerPath `
  /work/scripts/perf/capacity_ramp.js

if ($LASTEXITCODE -ne 0) {
    throw "k6 capacity ramp test failed"
}

Write-Host "==> Done. Summary written to $summaryHostPath"

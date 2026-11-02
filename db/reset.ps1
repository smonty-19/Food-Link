# Reset the FoodLink database to a fresh demo state (Windows PowerShell).
#   powershell -ExecutionPolicy Bypass -File db\reset.ps1
# Needs the postgres superuser password: set $env:PGPASSWORD first, or psql will ask.
# Run from the repository root.

$ErrorActionPreference = "Stop"
$db = "foodlink"

Write-Host "1/3 review2.sql  (re-seeds data with timestamps relative to now)"
psql -U postgres -d $db -q -f db/review2.sql -o NUL
if ($LASTEXITCODE -ne 0) { throw "review2.sql failed" }

Write-Host "2/3 app_support.sql"
psql -U postgres -d $db -q -f db/app_support.sql
if ($LASTEXITCODE -ne 0) { throw "app_support.sql failed" }

Write-Host "3/3 rebuilding the Qdrant collection"
npm run --silent qdrant:init

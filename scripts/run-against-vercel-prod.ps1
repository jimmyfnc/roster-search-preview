# Runs any DB-touching Node script against the Vercel Production env's DATABASE_URL.
# Pulls the Production env vars into a temp file, sets $env:DATABASE_URL inline so it
# wins over the local .env, runs the requested script, then cleans up the temp file.
#
# Usage examples (from repo root):
#   .\scripts\run-against-vercel-prod.ps1 scripts/check-target-db.cjs
#   .\scripts\run-against-vercel-prod.ps1 scripts/snapshot-state.cjs
#   .\scripts\run-against-vercel-prod.ps1 scripts/migrate-2025-2026-data.cjs
#   .\scripts\run-against-vercel-prod.ps1 scripts/verify-migration.cjs
#   .\scripts\run-against-vercel-prod.ps1 scripts/run-rollback.cjs
#
# WHY THIS EXISTS: `vercel env pull` defaults to Development, which is a separate Neon
# branch from the one the deployed preview reads. Without this wrapper, migrations land
# on the wrong DB and the live preview stays unchanged. See CLAUDE.md "Environments".

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ScriptPath
)

if (-not (Test-Path $ScriptPath)) {
  Write-Error "Script not found: $ScriptPath"
  exit 1
}

$tmp = ".env.vercel-prod-temp"
try {
  Write-Output "Pulling Vercel Production environment variables..."
  vercel env pull --environment=production --yes $tmp 2>&1 | Out-Null
  if (-not (Test-Path $tmp)) {
    Write-Error "vercel env pull failed; is the project linked? Try `vercel link` first."
    exit 1
  }

  $line = Get-Content $tmp | Select-String "^DATABASE_URL=" | Select-Object -First 1
  if (-not $line) {
    Write-Error "DATABASE_URL not found in Vercel Production environment."
    exit 1
  }
  $env:DATABASE_URL = $line.Line.Substring("DATABASE_URL=".Length).Trim('"')

  $dbHost = ($env:DATABASE_URL -split '@')[1] -split '/' | Select-Object -First 1
  Write-Output "Target: $dbHost (Vercel Production / deployed preview Neon branch)"
  Write-Output "Running: node $ScriptPath"
  Write-Output ""

  node $ScriptPath
  $exitCode = $LASTEXITCODE
  exit $exitCode
} finally {
  if (Test-Path $tmp) { Remove-Item $tmp -ErrorAction SilentlyContinue }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

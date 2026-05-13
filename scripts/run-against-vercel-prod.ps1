# Runs any DB-touching Node script against the Vercel Production env's DATABASE_URL.
# Pulls the Production env vars into a temp file (in the OS temp dir, NOT the repo root),
# sets $env:DATABASE_URL inline so it wins over the local .env, runs the requested script,
# then cleans up the temp file.
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

# Optional: keep ScriptPath inside scripts/ so the wrapper can't be repurposed to run arbitrary files.
if (-not ($ScriptPath -match '^scripts[/\\]')) {
  Write-Error "ScriptPath must be within the scripts/ directory: $ScriptPath"
  exit 1
}

# Write the env file to the OS temp dir, NOT the repo root. If the script is interrupted
# before the finally block runs, the credentials are still outside the git tree.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "vercel-prod-env-$(New-Guid).env"

try {
  Write-Output "Pulling Vercel Production environment variables..."
  $pullOutput = vercel env pull --environment=production --yes $tmp 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "vercel env pull failed (exit $LASTEXITCODE):`n$pullOutput"
    exit 1
  }
  if (-not (Test-Path $tmp)) {
    Write-Error "vercel env pull reported success but produced no file. Is the project linked? Try ``vercel link`` first.`n$pullOutput"
    exit 1
  }

  $line = Get-Content $tmp | Select-String "^DATABASE_URL=" | Select-Object -First 1
  if (-not $line) {
    Write-Error "DATABASE_URL not found in Vercel Production environment."
    exit 1
  }
  $env:DATABASE_URL = $line.Line.Substring("DATABASE_URL=".Length).Trim().Trim('"')

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

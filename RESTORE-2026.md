# Restoring / Re-running the 2025/2026 Roster Migration

This document explains how to re-run the current migration when the live Railway
database needs to catch up with the deployed Vercel preview, OR when restoring
the dataset after a rollback.

> **NOTE**: This replaces the original RESTORE-2026.md that described the
> rolled-back 4.0.0 migration plan (using `migrate-2026-roster.cjs` and the
> March 2026 CSV). The current migration is unified into
> `scripts/migrate-2025-2026-data.cjs` and consumes the January 2026 XLSX +
> the final 2025 payroll CSV instead. The 4.0.0 scripts are kept on disk for
> archival but are **superseded** — do not run them.

## What this migration produces

Starting from the pre-versioned baseline (318 named 2024 records, no
demographics or versioning columns), this migration produces a three-year
versioned dataset:

| roster_year | is_current=true | is_current=false | Notes |
|---|---|---|---|
| 2024 | 31 | 287 | "Current" rows are departed personnel last seen in 2024 |
| 2025 | 66 | 270 | "Current" rows are personnel only in 2025 payroll (incl. de-redacted) |
| 2026 | 350 | 0 | 319 named + 31 redacted; latest source of truth for active personnel |

Total: 1004 rows. **447 `is_current=true`** under the latest-record-per-person
rule.

## Prerequisites

- Access to the target Postgres (Railway live, or Neon Prod via Vercel)
- Node.js installed locally
- Source files present in `public/data/`:
  - `SAPD ROSTER 202403.csv` (already in repo)
  - `NSP_2026_SAPD_260114_ROSTER.xlsx` (already in repo)
  - `NSP_SAPD_2025_PAYROLL - SAPD_2025_PAYROLL.csv` (already in repo)

## Step-by-step

### 1. Confirm the DB target

```powershell
node scripts/check-target-db.cjs
```

This must print the host you intend to migrate. Labels you can expect:
- `Neon (preview DEV branch — safe iteration)` — local dev, no user impact
- `Neon (preview PROD branch — affects deployed Vercel preview)` — visible at
  `*-jimmyfncs-projects.vercel.app`
- `Railway (PRODUCTION live site)` — visible at `nosecretpolice.net`

### 2. Dry-run first

```powershell
DRY_RUN=1 node scripts/migrate-2025-2026-data.cjs
```

This runs the whole migration in one transaction and then rolls back. The
summary at the end should show:
- 318 baseline 2024 records loaded
- 336 rows inserted for roster_year=2025
- 350 rows inserted for roster_year=2026
- 447 is_current=true after Phase D

If those numbers look wrong, stop and investigate before the real run.

### 3. Real migration

```powershell
# Local Neon Dev branch:
node scripts/migrate-2025-2026-data.cjs

# Neon Prod branch (deployed Vercel preview):
.\scripts\run-against-vercel-prod.ps1 scripts/migrate-2025-2026-data.cjs

# Railway production (only after preview is approved):
railway run --service Postgres node scripts/migrate-2025-2026-data.cjs
```

The script is idempotent — re-running against a DB that already has 2025/2026
data wipes those rows and re-inserts. The 2024 baseline is never touched.

### 4. Verify invariants

```powershell
node scripts/verify-migration.cjs
# or for Prod Neon:
.\scripts\run-against-vercel-prod.ps1 scripts/verify-migration.cjs
```

Both invariant checks must show 0 violations:
- `latest-per-person invariant violations (should be 0): 0`
- `payroll_year-without-pay invariant violations (should be 0): 0`

### 5. Extract photos (separate, local-only step)

```powershell
node scripts/extract-xlsx-photos.cjs
```

Reads embedded photos from the 2026 XLSX, converts PNG → WebP via `sharp`, and
writes to `public/photos/`. This only affects the local filesystem — to
deploy the photos, commit them and push so Vercel rebuilds.

## Rollback

If you need to undo the migration entirely:

```powershell
node scripts/run-rollback.cjs
# or for Prod Neon:
.\scripts\run-against-vercel-prod.ps1 scripts/run-rollback.cjs
```

This executes `scripts/rollback-2025-2026.sql` which:
1. Deletes all 2025 and 2026 rows
2. Drops the composite UNIQUE constraint
3. Drops the new indexes (incl. `idx_personnel_name_stripped`)
4. Drops all columns added by the migration (gender, ethnicity, height, weight,
   year_of_hire, roster_year, is_current, rank_title, payroll_year)
5. Restores the original single-column UNIQUE on `badge_number` (with a
   duplicate-badge pre-check that aborts cleanly if rollback would violate
   uniqueness)

End state: 318 rows, 14 columns, identical to the pre-migration baseline.

## Why is `migrate-2026-roster.cjs` still in the repo?

The original 4.0.0 migration scripts (`migrate-2026-schema.sql`,
`migrate-2026-roster.cjs`, `rollback-2026.sql`) are preserved as historical
record of the rolled-back deployment. They consume the now-superseded
`NSP_UPDATE_SAPD_202603 - MASTER.csv` and produce a different end state from
the current migration. **Do not run them.** Use `migrate-2025-2026-data.cjs`
exclusively.

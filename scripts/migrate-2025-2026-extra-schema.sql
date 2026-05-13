-- Unified schema migration for 2025/2026 data import.
-- Brings the DB from the pre-2026 baseline (318 named records, no versioning columns)
-- to the versioned multi-year model used by the new data migration script.
-- Safe to run multiple times (idempotent).

-- Phase 1: Demographic columns
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS ethnicity TEXT;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS height TEXT;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS weight INTEGER;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS year_of_hire INTEGER;

-- Phase 2: Versioning columns
-- is_current defaults to false; Phase D of the data migration sets it to true for the
-- latest record per person. Using DEFAULT false prevents accidental "everyone is current"
-- if the schema migration ever runs without the data migration that follows.
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS roster_year INTEGER;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT false;

-- Phase 3: Rank title (more granular than the existing classification column)
-- and payroll_year (tracks which year the payroll fields actually come from,
-- since 2026 records carry payroll forward from prior years).
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS rank_title TEXT;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS payroll_year INTEGER;

-- Phase 4: Backfill existing records as 2024 historical baseline.
-- Anything still untagged is part of the original 2024 SAPD roster import. Set
-- roster_year=2024 unconditionally, but stamp payroll_year=2024 ONLY when at
-- least one payroll field is populated — otherwise the UI would surface a
-- misleading "Payroll data is current as of 2024" disclaimer over an empty
-- payment section.
UPDATE personnel
   SET roster_year = 2024,
       is_current = false
 WHERE roster_year IS NULL;

UPDATE personnel
   SET payroll_year = 2024
 WHERE roster_year = 2024
   AND payroll_year IS NULL
   AND (regular_pay IS NOT NULL OR premiums IS NOT NULL OR overtime IS NOT NULL
        OR payout IS NOT NULL OR other_pay IS NOT NULL OR health_dental_vision IS NOT NULL);

-- Also un-stamp any rows that were previously backfilled with payroll_year=2024 but
-- have no actual payroll data (residue from earlier migration runs that didn't gate on
-- pay presence). Keeps the "payroll_year set iff pay data exists" invariant clean.
UPDATE personnel
   SET payroll_year = NULL
 WHERE payroll_year IS NOT NULL
   AND regular_pay IS NULL AND premiums IS NULL AND overtime IS NULL
   AND payout IS NULL AND other_pay IS NULL AND health_dental_vision IS NULL;

-- Phase 5: Swap the single-column UNIQUE for a composite that allows the same badge
-- to exist in multiple roster years.
ALTER TABLE personnel DROP CONSTRAINT IF EXISTS personnel_badge_number_key;
DROP INDEX IF EXISTS idx_personnel_badge_number;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'personnel_badge_roster_unique'
  ) THEN
    ALTER TABLE personnel ADD CONSTRAINT personnel_badge_roster_unique
      UNIQUE (badge_number, roster_year);
  END IF;
END $$;

-- Phase 6: Indexes for the latest-per-person query and year filtering.
CREATE INDEX IF NOT EXISTS idx_personnel_roster_year ON personnel(roster_year);
CREATE INDEX IF NOT EXISTS idx_personnel_is_current ON personnel(is_current);
CREATE INDEX IF NOT EXISTS idx_personnel_name_year
  ON personnel (LOWER(last_name), LOWER(first_name), roster_year DESC);

-- Partial expression index that matches the Phase D PARTITION BY in migrate-2025-2026-data.cjs.
-- Lets Postgres serve the ROW_NUMBER() window's sort without a full table scan as data grows.
CREATE INDEX IF NOT EXISTS idx_personnel_name_stripped ON personnel (
  LOWER(REGEXP_REPLACE(TRIM(last_name), '\s+', ' ', 'g')),
  LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(first_name), '\s+[A-Za-z]\.?$', ''), '\s+', ' ', 'g')),
  roster_year DESC
) WHERE last_name IS NOT NULL AND last_name NOT LIKE 'XXXX%';

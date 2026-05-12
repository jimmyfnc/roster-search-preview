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
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS roster_year INTEGER;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT true;

-- Phase 3: Rank title (more granular than the existing classification column)
-- and payroll_year (tracks which year the payroll fields actually come from,
-- since 2026 records carry payroll forward from prior years).
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS rank_title TEXT;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS payroll_year INTEGER;

-- Phase 4: Backfill existing records as 2024 historical baseline.
-- Anything still untagged is part of the original 2024 SAPD roster import; its
-- payroll is from 2024.
UPDATE personnel
   SET roster_year = 2024,
       is_current = false,
       payroll_year = COALESCE(payroll_year, 2024)
 WHERE roster_year IS NULL;

-- Also backfill payroll_year on already-tagged 2024 records (idempotent for re-runs).
UPDATE personnel SET payroll_year = 2024 WHERE roster_year = 2024 AND payroll_year IS NULL;

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

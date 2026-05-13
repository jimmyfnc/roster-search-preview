-- Full rollback of the 2025/2026 migration.
-- Restores the personnel table to the pre-migration baseline: 318 records, 14 columns,
-- single-column UNIQUE on badge_number, no versioning/demographics/rank columns.

BEGIN;

-- 1. Delete the new 2025 and 2026 rows. Leaves only the original 318 records (currently tagged 2024).
DELETE FROM personnel WHERE roster_year IN (2025, 2026);

-- 2. Drop the composite UNIQUE constraint (must drop before dropping roster_year).
ALTER TABLE personnel DROP CONSTRAINT IF EXISTS personnel_badge_roster_unique;

-- 3. Drop the indexes added during migration.
DROP INDEX IF EXISTS idx_personnel_roster_year;
DROP INDEX IF EXISTS idx_personnel_is_current;
DROP INDEX IF EXISTS idx_personnel_name_year;

-- 3b. Drop the partial expression index that mirrors the Phase D partition key.
DROP INDEX IF EXISTS idx_personnel_name_stripped;

-- 4. Drop the columns added during migration.
ALTER TABLE personnel DROP COLUMN IF EXISTS gender;
ALTER TABLE personnel DROP COLUMN IF EXISTS ethnicity;
ALTER TABLE personnel DROP COLUMN IF EXISTS height;
ALTER TABLE personnel DROP COLUMN IF EXISTS weight;
ALTER TABLE personnel DROP COLUMN IF EXISTS year_of_hire;
ALTER TABLE personnel DROP COLUMN IF EXISTS roster_year;
ALTER TABLE personnel DROP COLUMN IF EXISTS is_current;
ALTER TABLE personnel DROP COLUMN IF EXISTS rank_title;
ALTER TABLE personnel DROP COLUMN IF EXISTS payroll_year;

-- 5. Restore the original single-column UNIQUE constraint on badge_number.
-- Convention: PostgreSQL names inline UNIQUE constraints as <table>_<col>_key.
-- First assert no duplicate badges exist, so the constraint add doesn't fail mid-rollback.
DO $$
DECLARE dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT badge_number FROM personnel WHERE badge_number IS NOT NULL
    GROUP BY badge_number HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot restore badge_number UNIQUE: % duplicate badge values exist post-rollback', dup_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personnel_badge_number_key') THEN
    ALTER TABLE personnel ADD CONSTRAINT personnel_badge_number_key UNIQUE (badge_number);
  END IF;
END $$;

-- Verification before commit (no-op queries, just for visibility in psql output).
-- After commit, scripts/snapshot-state.cjs should report 318 rows, 14 columns.

COMMIT;

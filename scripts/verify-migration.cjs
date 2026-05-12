// Post-migration spot checks. Read-only.
const { Pool } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log('=== SPOT CHECKS ===\n');

  // 1. Demographics coverage for 2026
  const demo = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE gender IS NOT NULL)::int AS gender,
      COUNT(*) FILTER (WHERE ethnicity IS NOT NULL)::int AS ethnicity,
      COUNT(*) FILTER (WHERE height IS NOT NULL)::int AS height,
      COUNT(*) FILTER (WHERE weight IS NOT NULL)::int AS weight,
      COUNT(*) FILTER (WHERE year_of_hire IS NOT NULL)::int AS year_of_hire,
      COUNT(*) FILTER (WHERE rank_title IS NOT NULL)::int AS rank_title,
      COUNT(*)::int AS total
    FROM personnel WHERE roster_year = 2026
  `);
  console.log('2026 demographics coverage (of ' + demo.rows[0].total + '):');
  for (const [k, v] of Object.entries(demo.rows[0])) {
    if (k !== 'total') console.log('  ' + k + ': ' + v);
  }

  // 2. Sample named 2026 record
  console.log('\nSample named 2026 record (with carry-forward payroll):');
  const sample = await pool.query(`
    SELECT first_name, last_name, badge_number, classification, rank_title, division,
           gender, ethnicity, height, weight, year_of_hire,
           regular_pay, overtime, payout
    FROM personnel
    WHERE roster_year = 2026 AND last_name = 'Achutegui'
    LIMIT 1
  `);
  console.log('  ' + JSON.stringify(sample.rows[0], null, 2));

  // 3. Sample redacted 2026 record
  console.log('\nSample redacted 2026 record:');
  const red = await pool.query(`
    SELECT first_name, last_name, badge_number, classification, rank_title, division,
           gender, ethnicity, height, weight, year_of_hire
    FROM personnel
    WHERE roster_year = 2026 AND last_name LIKE 'XXXX%'
    LIMIT 1
  `);
  console.log('  ' + JSON.stringify(red.rows[0], null, 2));

  // 4. Sample 2025-only is_current record (someone who departed before 2026)
  console.log('\nSample 2025-only is_current record:');
  const r25 = await pool.query(`
    SELECT first_name, last_name, badge_number, classification, regular_pay, overtime
    FROM personnel
    WHERE roster_year = 2025 AND is_current = true
    LIMIT 1
  `);
  console.log('  ' + JSON.stringify(r25.rows[0], null, 2));

  // 5. Sample 2024-only is_current record (departed before 2025)
  console.log('\nSample 2024-only is_current record:');
  const r24 = await pool.query(`
    SELECT first_name, last_name, badge_number, classification, division, regular_pay
    FROM personnel
    WHERE roster_year = 2024 AND is_current = true
    LIMIT 1
  `);
  console.log('  ' + JSON.stringify(r24.rows[0], null, 2));

  // 6. Check no duplicate is_current rows per stripped name (named only)
  const dupes = await pool.query(`
    SELECT LOWER(last_name) AS ln,
           LOWER(REGEXP_REPLACE(first_name, '\\s+[A-Za-z]\\.?$', '')) AS fn_stripped,
           COUNT(*)::int AS n
    FROM personnel
    WHERE is_current = true AND last_name NOT LIKE 'XXXX%'
    GROUP BY ln, fn_stripped
    HAVING COUNT(*) > 1
    LIMIT 5
  `);
  console.log('\nDuplicate is_current named records (should be 0):');
  if (dupes.rows.length === 0) console.log('  none');
  else for (const r of dupes.rows) console.log('  ' + r.ln + ', ' + r.fn_stripped + ': ' + r.n);

  // 7. Composite unique constraint check
  console.log('\nConstraint and index check:');
  const cons = await pool.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'personnel'::regclass AND contype = 'u'
  `);
  console.log('  Unique constraints: ' + cons.rows.map(r => r.conname).join(', '));

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

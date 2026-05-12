// Unified 2025/2026 migration (Path B).
// Starts from the pre-2026 baseline (318 named 2024 records, no versioning columns)
// and produces a three-year versioned dataset.
//
// Phase 0: Schema migration (idempotent DDL).
// Phase A: Reset is_current=false everywhere (rebuilt at the end).
// Phase B: Insert 2025 records from CSV, carrying badge/division forward from 2024 where matched.
// Phase C: Insert 2026 records from XLSX (named + redacted), carrying 2024 payroll/classification.
// Phase D: Rebuild is_current as latest-per-person (named) + every redacted 2026 row.
//
// One transaction. Any failure rolls back the entire migration.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const Papa = require('papaparse');
const { ensureExtracted, readSheet } = require('./xlsx-helper.cjs');

const DATABASE_URL =
  process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: Set DATABASE_URL, DATABASE_PUBLIC_URL, or VITE_DATABASE_URL');
  process.exit(1);
}

const XLSX_PATH = path.join(__dirname, '..', 'public', 'data', 'NSP_2026_SAPD_260114_ROSTER.xlsx');
const CSV_2025 = path.join(__dirname, '..', 'public', 'data', 'NSP_SAPD_2025_PAYROLL - SAPD_2025_PAYROLL.csv');
const SCHEMA_SQL = path.join(__dirname, 'migrate-2025-2026-extra-schema.sql');
const EXTRACT_DIR = path.join(process.env.TEMP || 'C:\\Users\\caldw\\AppData\\Local\\Temp', 'nsp_xlsx_migration');

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const stripMiddle = s => norm(s).replace(/\s+[a-z]\.?$/, '');
const parseMoney = v => {
  if (v == null || v === '' || v === '-') return null;
  const num = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(num) ? null : num;
};
// "Police Officer (Detective)" -> "Police Officer" so classification matches 2024 conventions.
const baseRank = s => (s || '').trim().split(' (')[0] || null;

async function migrate() {
  console.log('Extracting XLSX to ' + EXTRACT_DIR);
  ensureExtracted(XLSX_PATH, EXTRACT_DIR);
  const { rows: xlsxRows } = readSheet(EXTRACT_DIR);
  const namedXlsx = xlsxRows.filter(r => !r.isRedacted);
  const redactedXlsx = xlsxRows.filter(r => r.isRedacted);
  console.log('XLSX rows: ' + xlsxRows.length + ' (named ' + namedXlsx.length + ', redacted ' + redactedXlsx.length + ')');

  const csv2025 = Papa.parse(fs.readFileSync(CSV_2025, 'utf8'), { header: true, skipEmptyLines: true }).data;
  console.log('2025 payroll rows: ' + csv2025.length);

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ---- Phase 0: schema migration ----
    const schemaSql = fs.readFileSync(SCHEMA_SQL, 'utf8');
    await client.query(schemaSql);
    console.log('\nPhase 0: schema migration applied');

    // ---- Phase A: reset is_current ----
    const reset = await client.query('UPDATE personnel SET is_current = false');
    console.log('Phase A: reset is_current=false on ' + reset.rowCount + ' rows');

    // Load 2024 baseline for carry-forward in subsequent phases.
    const baseline2024 = await client.query(
      `SELECT id, last_name, first_name, badge_number, classification, division,
              regular_pay, premiums, overtime, payout, other_pay, health_dental_vision
         FROM personnel
        WHERE roster_year = 2024`
    );
    const by2024 = new Map();
    for (const r of baseline2024.rows) {
      const k = norm(r.last_name) + '|' + stripMiddle(r.first_name);
      if (!by2024.has(k)) by2024.set(k, []);
      by2024.get(k).push(r);
    }
    console.log('Loaded ' + baseline2024.rows.length + ' baseline 2024 records (' + by2024.size + ' unique name keys)');

    // ---- Phase B: insert 2025 records ----
    let inserted2025 = 0, matched2025 = 0, unmatched2025 = 0;
    for (const row of csv2025) {
      const lastName = (row['Last Name'] || '').trim();
      const firstName = (row['First Name'] || '').trim();
      if (!lastName && !firstName) continue;

      const classification = (row['Classification'] || '').trim() || null;
      const regularPay = parseMoney(row['Regular Pay']);
      const overtime = parseMoney(row['Overtime']);
      const payout = parseMoney(row['Payout']);
      const premiums = parseMoney(row['Premiums']);
      const otherPay = parseMoney(row['Other']);
      const hdv = parseMoney(row['Health Dental Vision']);

      const k = norm(lastName) + '|' + stripMiddle(firstName);
      const matches = by2024.get(k);
      let badge = null, division = null;
      if (matches && matches.length >= 1) {
        badge = matches[0].badge_number || null;
        division = matches[0].division || null;
        matched2025++;
      } else {
        unmatched2025++;
      }

      await client.query(
        `INSERT INTO personnel
           (last_name, first_name, badge_number, classification, division,
            regular_pay, premiums, overtime, payout, other_pay, health_dental_vision,
            roster_year, is_current)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,2025,false)`,
        [lastName, firstName, badge, classification, division,
         regularPay, premiums, overtime, payout, otherPay, hdv]
      );
      inserted2025++;
    }
    console.log('\nPhase B: inserted ' + inserted2025 + ' rows for roster_year=2025');
    console.log('  Carry-forward match (badge/division from 2024): ' + matched2025);
    console.log('  Unmatched (null badge, no division):            ' + unmatched2025);

    // ---- Phase C: insert 2026 records from XLSX ----
    let inserted2026 = 0, named2026 = 0, redacted2026 = 0, payrollCarried = 0;
    for (const r of namedXlsx) {
      const k = norm(r.last) + '|' + stripMiddle(r.first);
      const matches = by2024.get(k);
      // 2024 carry-forward target: prefer the badge match when there are multiple same-name records.
      const carry = (matches && matches.length > 0)
        ? (matches.find(m => r.badge && m.badge_number === r.badge) || matches[0])
        : null;
      const classification = carry ? carry.classification : baseRank(r.rankTitle);
      if (carry) payrollCarried++;

      await client.query(
        `INSERT INTO personnel
           (last_name, first_name, badge_number, classification, division,
            regular_pay, premiums, overtime, payout, other_pay, health_dental_vision,
            gender, ethnicity, height, weight, year_of_hire, rank_title,
            roster_year, is_current)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,2026,false)`,
        [
          r.last, r.first, r.badge, classification, r.division,
          carry ? carry.regular_pay : null,
          carry ? carry.premiums : null,
          carry ? carry.overtime : null,
          carry ? carry.payout : null,
          carry ? carry.other_pay : null,
          carry ? carry.health_dental_vision : null,
          r.gender, r.ethnicity, r.height, r.weight, r.yearOfHire, r.rankTitle,
        ]
      );
      inserted2026++;
      named2026++;
    }
    for (const r of redactedXlsx) {
      // Names stay as the literal XLSX "XXXXXXX" strings to satisfy NOT NULL.
      // badge_number is set NULL so the composite UNIQUE constraint doesn't reject duplicates.
      await client.query(
        `INSERT INTO personnel
           (last_name, first_name, badge_number, classification, division,
            gender, ethnicity, height, weight, year_of_hire, rank_title,
            roster_year, is_current)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, 2026, false)`,
        [
          r.last || 'XXXXXXX',
          r.first || 'XXXXXXX',
          baseRank(r.rankTitle), r.division, r.gender, r.ethnicity, r.height, r.weight, r.yearOfHire, r.rankTitle,
        ]
      );
      inserted2026++;
      redacted2026++;
    }
    console.log('\nPhase C: inserted ' + inserted2026 + ' rows for roster_year=2026');
    console.log('  Named:    ' + named2026 + ' (' + payrollCarried + ' with 2024 payroll carry-forward)');
    console.log('  Redacted: ' + redacted2026);

    // ---- Phase D: rebuild is_current ----
    // Named personnel: latest year wins per stripped-name key.
    // Redacted rows (last_name LIKE 'XXXX%') are excluded so they don't collide on a sentinel name.
    const namedUpdate = await client.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY LOWER(last_name),
                              LOWER(REGEXP_REPLACE(first_name, '\\s+[A-Za-z]\\.?$', ''))
                 ORDER BY roster_year DESC, id DESC
               ) AS rn
          FROM personnel
         WHERE last_name IS NOT NULL
           AND last_name NOT LIKE 'XXXX%'
      )
      UPDATE personnel SET is_current = true
       WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
    `);
    console.log('\nPhase D: marked ' + namedUpdate.rowCount + ' named records as is_current=true');

    // Redacted 2026 rows: every one stays current (no dedup possible).
    const redactedUpdate = await client.query(`
      UPDATE personnel SET is_current = true
       WHERE roster_year = 2026 AND last_name LIKE 'XXXX%'
    `);
    console.log('Phase D: marked ' + redactedUpdate.rowCount + ' redacted 2026 records as is_current=true');

    // ---- Verification ----
    const summary = await client.query(`
      SELECT roster_year, is_current, COUNT(*)::int AS count
        FROM personnel
       GROUP BY roster_year, is_current
       ORDER BY roster_year, is_current
    `);
    console.log('\n=== POST-MIGRATION SUMMARY ===');
    for (const r of summary.rows) {
      console.log('  roster_year=' + r.roster_year + ', is_current=' + r.is_current + ': ' + r.count);
    }
    const totalCurrent = await client.query("SELECT COUNT(*)::int AS c FROM personnel WHERE is_current = true");
    const total = await client.query("SELECT COUNT(*)::int AS c FROM personnel");
    console.log('\nTotal rows:           ' + total.rows[0].c);
    console.log('is_current=true rows: ' + totalCurrent.rows[0].c);

    await client.query('COMMIT');
    console.log('\nMigration committed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nMigration FAILED — rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));

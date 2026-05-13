// =============================================================================
// SUPERSEDED — DO NOT RUN.
//
// This script implements the rolled-back 4.0.0 migration plan, which consumed
// the preliminary `NSP_UPDATE_SAPD_202603 - MASTER.csv` source (since marked
// historical in CLAUDE.md). The currently deployed migration is unified into
// `scripts/migrate-2025-2026-data.cjs` and uses the January 2026 XLSX + the
// final 2025 payroll CSV instead.
//
// Kept on disk for archival record. See CHANGELOG.md [5.0.0] for the
// replacement migration and RESTORE-2026.md for the current operational
// runbook.
// =============================================================================
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

// Database connection - use env var or fallback
const DATABASE_URL = process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: Set DATABASE_URL or VITE_DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();

  try {
    // Step 1: Parse the new CSV
    const csvPath = path.join(__dirname, '..', 'public', 'data', 'NSP_UPDATE_SAPD_202603 - MASTER.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
    const newRows = parsed.data;

    console.log('Parsed ' + newRows.length + ' rows from CSV');

    // Validate expected CSV headers
    const expectedHeaders = ['Last Name', 'First Name', 'Classification', 'Badge #', 'Division', 'Gender', 'Ethnicity', 'Height', 'Weight', 'Year of Hire'];
    const actualHeaders = parsed.meta.fields || [];
    const missingHeaders = expectedHeaders.filter(h => !actualHeaders.includes(h));
    if (missingHeaders.length > 0) {
      throw new Error('CSV is missing expected headers: ' + missingHeaders.join(', '));
    }

    await client.query('BEGIN');

    // Step 2: Ensure existing records are tagged as 2024/inactive
    const backfillResult = await client.query(
      'UPDATE personnel SET roster_year = 2024, is_current = false WHERE roster_year IS NULL'
    );
    if (backfillResult.rowCount > 0) {
      console.log('Backfilled ' + backfillResult.rowCount + ' existing records as 2024');
    } else {
      console.log('No untagged records to backfill (schema migration likely already ran)');
    }

    // Step 3: Load 2024 records keyed by badge for payroll lookup
    const existing2024 = await client.query(
      'SELECT * FROM personnel WHERE roster_year = 2024'
    );
    const payrollLookup = {};
    for (const row of existing2024.rows) {
      if (row.badge_number) {
        payrollLookup[row.badge_number] = row;
      }
    }
    console.log('Loaded ' + Object.keys(payrollLookup).length + ' existing records for payroll lookup');

    // Step 4: Insert 2026 rows
    let insertCount = 0;
    let overlappingCount = 0;
    let newPersonCount = 0;

    for (const csvRow of newRows) {
      let badgeNumber = (csvRow['Badge #'] || '').trim() || null;
      // Redacted entries all share "XXXXXXX" badge - set to null to avoid unique constraint violation
      if (badgeNumber && /^X+$/.test(badgeNumber)) {
        badgeNumber = null;
      }
      const firstName = (csvRow['First Name'] || '').trim();
      const lastName = (csvRow['Last Name'] || '').trim();
      const classification = (csvRow['Classification'] || '').trim() || null;
      const division = (csvRow['Division'] || '').trim() || null;
      const gender = (csvRow['Gender'] || '').trim() || null;
      const ethnicity = (csvRow['Ethnicity'] || '').trim() || null;
      const height = (csvRow['Height'] || '').trim() || null;
      const weight = csvRow['Weight'] ? (parseInt(csvRow['Weight']) || null) : null;
      const yearOfHire = csvRow['Year of Hire'] ? (parseInt(csvRow['Year of Hire']) || null) : null;

      if (!firstName && !lastName) continue; // skip empty rows

      // Determine payroll source
      let regularPay, premiums, overtime, payout, otherPay, healthDentalVision;

      const existing = badgeNumber ? payrollLookup[badgeNumber] : null;

      if (existing) {
        // Overlapping person: preserve 2024 payroll
        overlappingCount++;
        regularPay = existing.regular_pay;
        premiums = existing.premiums;
        overtime = existing.overtime;
        payout = existing.payout;
        otherPay = existing.other_pay;
        healthDentalVision = existing.health_dental_vision;
      } else {
        // New person: use CSV payroll data
        newPersonCount++;
        const parseNum = (val) => {
          if (!val || val === '-' || val === '') return null;
          // Remove commas from formatted numbers
          const cleaned = val.replace(/,/g, '');
          const num = parseFloat(cleaned);
          return isNaN(num) ? null : num;
        };
        regularPay = parseNum(csvRow['Regular Pay']);
        premiums = parseNum(csvRow['Premiums']);
        overtime = parseNum(csvRow['Overtime']);
        payout = parseNum(csvRow['Payout']);
        otherPay = parseNum(csvRow['Other']);
        healthDentalVision = null; // Not in new data
      }

      await client.query(
        `INSERT INTO personnel (
          first_name, last_name, badge_number, classification, division,
          regular_pay, premiums, overtime, payout, other_pay, health_dental_vision,
          gender, ethnicity, height, weight, year_of_hire,
          roster_year, is_current
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          firstName, lastName, badgeNumber, classification, division,
          regularPay, premiums, overtime, payout, otherPay, healthDentalVision,
          gender, ethnicity, height, weight, yearOfHire,
          2026, true
        ]
      );
      insertCount++;
    }

    await client.query('COMMIT');

    // Step 5: Verification
    const counts = await pool.query(
      'SELECT roster_year, is_current, COUNT(*) as count FROM personnel GROUP BY roster_year, is_current ORDER BY roster_year, is_current'
    );

    console.log('\n=== Migration Summary ===');
    console.log('CSV rows inserted: ' + insertCount);
    console.log('Overlapping (payroll from 2024): ' + overlappingCount);
    console.log('New personnel: ' + newPersonCount);
    console.log('Departed (2024 only, is_current=false): ' + (Object.keys(payrollLookup).length - overlappingCount));
    console.log('\nDatabase state:');
    for (const row of counts.rows) {
      console.log('  roster_year=' + row.roster_year + ', is_current=' + row.is_current + ': ' + row.count + ' records');
    }

    // Quick data quality check
    const demographicsCheck = await pool.query(
      "SELECT COUNT(*) as count FROM personnel WHERE roster_year = 2026 AND gender IS NOT NULL"
    );
    console.log('\n2026 records with demographics: ' + demographicsCheck.rows[0].count);

    const redactedCheck = await pool.query(
      "SELECT COUNT(*) as count FROM personnel WHERE roster_year = 2026 AND (first_name LIKE '%XXXX%' OR last_name LIKE '%XXXX%')"
    );
    console.log('Redacted entries: ' + redactedCheck.rows[0].count);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration FAILED - rolled back:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));

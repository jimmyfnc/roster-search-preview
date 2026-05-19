// Unified 2025/2026 migration (Path B).
// Starts from the pre-2026 baseline (318 named 2024 records, no versioning columns)
// and produces a three-year versioned dataset.
//
// Phase 0: Schema migration (idempotent DDL).
// Phase A: Reset is_current=false + delete pre-existing 2025/2026 rows (idempotent re-run).
// Phase B: Insert 2025 records from CSV, carrying badge/division forward from 2024 where matched.
// Phase C: Insert 2026 records from XLSX (named + redacted), preferring 2025 payroll
//          over 2024 carry-forward where available; stamps payroll_year accordingly.
// Phase D: Rebuild is_current as latest-per-person (named) + every redacted 2026 row.
//
// One transaction. Any failure rolls back the entire migration.
//
// Flags:
//   DRY_RUN=1  - skip COMMIT and ROLLBACK at the end; useful for previewing changes.
require('dotenv').config();

const fs = require('fs');
const os = require('os');
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

const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

const XLSX_PATH = path.join(__dirname, '..', 'public', 'data', 'NSP_2026_SAPD_260114_ROSTER.xlsx');
const CSV_2025 = path.join(__dirname, '..', 'public', 'data', 'NSP_SAPD_2025_PAYROLL - SAPD_2025_PAYROLL.csv');
const SCHEMA_SQL = path.join(__dirname, 'migrate-2025-2026-extra-schema.sql');
const EXTRACT_DIR = path.join(os.tmpdir(), 'nsp_xlsx_migration');

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const stripMiddle = s => norm(s).replace(/\s+[a-z]\.?$/, '');
const parseMoney = v => {
  if (v == null || v === '' || v === '-') return null;
  const num = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(num) ? null : num;
};
// "Police Officer (Detective)" -> "Police Officer" so classification matches 2024 conventions.
const baseRank = s => {
  if (s == null) return null;
  const cleaned = String(s).trim().split(' (')[0];
  return cleaned || null;
};
const anyNonNull = arr => arr.some(v => v != null);

// Nickname → canonical first name, mirrors src/utils/photoUtils.ts nicknameMap.
// Used in Phase E to recognize "Dan Baek" and "Daniel S. Baek" as the same person.
const NICKNAME_TO_CANONICAL = {
  dan: 'daniel', daniel: 'daniel',
  rob: 'robert', bob: 'robert', robert: 'robert',
  bill: 'william', will: 'william', william: 'william',
  rick: 'richard', dick: 'richard', richard: 'richard',
  mike: 'michael', michael: 'michael',
  chris: 'christopher', christopher: 'christopher',
  matt: 'matthew', matthew: 'matthew',
  tony: 'anthony', anthony: 'anthony',
};
// Last-name suffix patterns: "Espinoza II" -> "espinoza", "Castro Jr." -> "castro".
// Mirrors the suffixPatterns array in src/utils/photoUtils.ts so dedup logic and
// photo-lookup logic agree on what counts as a name suffix.
const LAST_NAME_SUFFIX_RE = /\s+(jr\.?|junior|sr\.?|senior|i{1,3}|iv|2nd|3rd|4th)$/i;
function stripLastSuffix(s) {
  return norm(s).replace(LAST_NAME_SUFFIX_RE, '');
}
function canonicalNameKey(lastName, firstName) {
  const ln = stripLastSuffix(lastName);
  let fn = stripMiddle(firstName);
  if (NICKNAME_TO_CANONICAL[fn]) fn = NICKNAME_TO_CANONICAL[fn];
  return ln + '|' + fn;
}

// Generic chunked multi-row INSERT. Postgres has a ~32k bind-param ceiling; we cap chunks
// so we never approach it. Avoids the per-row round-trip cost on remote Neon connections.
async function batchInsert(client, table, columns, rows, chunkSize = 100) {
  if (rows.length === 0) return 0;
  const colList = columns.join(', ');
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = [];
    const values = [];
    let p = 1;
    for (const row of chunk) {
      placeholders.push('(' + columns.map(() => '$' + (p++)).join(', ') + ')');
      for (const col of columns) values.push(row[col] === undefined ? null : row[col]);
    }
    const sql = `INSERT INTO ${table} (${colList}) VALUES ${placeholders.join(', ')}`;
    const res = await client.query(sql, values);
    total += res.rowCount;
  }
  return total;
}

async function migrate() {
  if (DRY_RUN) console.log('*** DRY RUN: nothing will be committed ***\n');

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

    // ---- Phase A: reset state ----
    const reset = await client.query('UPDATE personnel SET is_current = false');
    console.log('Phase A: reset is_current=false on ' + reset.rowCount + ' rows');
    const wipeOld = await client.query("DELETE FROM personnel WHERE roster_year IN (2025, 2026)");
    console.log('Phase A: deleted ' + wipeOld.rowCount + ' pre-existing 2025/2026 rows');

    // Load 2024 baseline (now the only remaining year) for carry-forward.
    const baseline2024 = await client.query(
      `SELECT id, last_name, first_name, badge_number, classification, division,
              regular_pay, premiums, overtime, payout, other_pay, health_dental_vision
         FROM personnel WHERE roster_year = 2024`
    );
    const by2024 = new Map();
    for (const r of baseline2024.rows) {
      const k = norm(r.last_name) + '|' + stripMiddle(r.first_name);
      if (!by2024.has(k)) by2024.set(k, []);
      by2024.get(k).push(r);
    }
    console.log('Loaded ' + baseline2024.rows.length + ' baseline 2024 records (' + by2024.size + ' unique name keys)');

    // Build a 2025 payroll lookup keyed by canonical name (suffix-stripped +
    // nickname-mapped). Used by Phase C to prefer 2025 payroll over 2024 carry-forward
    // when populating 2026 records. The canonical key lets "Roberto Espinoza II"
    // (2026) find "Roberto Espinoza" (2025) and "Dan Padron" (2026) find "Daniel J.
    // Padron" (2025) — same person, different name shapes across sources.
    const by2025 = new Map();
    let collisions2025 = 0;
    for (const row of csv2025) {
      const k = canonicalNameKey(row['Last Name'], row['First Name']);
      if (by2025.has(k)) {
        collisions2025++;
        console.warn('  WARN: duplicate canonical name in 2025 CSV, keeping first: ' + row['Last Name'] + ', ' + row['First Name']);
        continue;
      }
      by2025.set(k, {
        regular_pay: parseMoney(row['Regular Pay']),
        premiums: parseMoney(row['Premiums']),
        overtime: parseMoney(row['Overtime']),
        payout: parseMoney(row['Payout']),
        other_pay: parseMoney(row['Other']),
        health_dental_vision: parseMoney(row['Health Dental Vision']),
      });
    }
    if (collisions2025) console.log('  2025 name collisions: ' + collisions2025);

    // ---- Phase B: prepare 2025 records ----
    const rows2025 = [];
    let matched2025 = 0, ambiguous2025 = 0, unmatched2025 = 0;
    for (const row of csv2025) {
      const lastName = (row['Last Name'] || '').trim();
      const firstName = (row['First Name'] || '').trim();
      if (!lastName && !firstName) continue;

      const rawClass = (row['Classification'] || '').trim();
      const regularPay = parseMoney(row['Regular Pay']);
      const overtime = parseMoney(row['Overtime']);
      const payout = parseMoney(row['Payout']);
      const premiums = parseMoney(row['Premiums']);
      const otherPay = parseMoney(row['Other']);
      const hdv = parseMoney(row['Health Dental Vision']);
      const hasAnyPay = anyNonNull([regularPay, premiums, overtime, payout, otherPay, hdv]);

      const k = norm(lastName) + '|' + stripMiddle(firstName);
      const matches = by2024.get(k);
      let badge = null, division = null, classification;
      if (matches && matches.length >= 1) {
        // Phase C uses badge as a tiebreaker; mirror that here even though CSV rows
        // have no badge, so it falls through to matches[0] in the no-badge case.
        const target = matches[0];
        badge = target.badge_number || null;
        division = target.division || null;
        classification = target.classification || (rawClass ? baseRank(rawClass) : null);
        if (matches.length > 1) ambiguous2025++;
        matched2025++;
      } else {
        // No 2024 match: normalize the CSV value through baseRank so we don't
        // pollute the dataset with "(Temp Up)" / "(RM)" / etc. on 2025-only personnel.
        classification = rawClass ? baseRank(rawClass) : null;
        unmatched2025++;
      }

      rows2025.push({
        last_name: lastName,
        first_name: firstName,
        badge_number: badge,
        classification,
        division,
        regular_pay: regularPay,
        premiums,
        overtime,
        payout,
        other_pay: otherPay,
        health_dental_vision: hdv,
        roster_year: 2025,
        is_current: false,
        payroll_year: hasAnyPay ? 2025 : null,
      });
    }

    const inserted2025 = await batchInsert(
      client,
      'personnel',
      ['last_name', 'first_name', 'badge_number', 'classification', 'division',
       'regular_pay', 'premiums', 'overtime', 'payout', 'other_pay', 'health_dental_vision',
       'roster_year', 'is_current', 'payroll_year'],
      rows2025
    );
    console.log('\nPhase B: inserted ' + inserted2025 + ' rows for roster_year=2025');
    console.log('  Carry-forward (badge/division/classification from 2024): ' + matched2025);
    console.log('  Ambiguous 2024 matches (took first):                     ' + ambiguous2025);
    console.log('  Unmatched (no 2024 record):                              ' + unmatched2025);

    // ---- Phase C: prepare 2026 records ----
    // Payroll source priority: 2025 (most recent) > 2024 > null.
    const rows2026 = [];
    let payrollFrom2025 = 0, payrollFrom2024 = 0, payrollNone = 0;
    for (const r of namedXlsx) {
      // 2024 lookup uses the strict middle-initial-stripped key (preserves exact
      // last-name shape, so "Espinoza II" in 2026 finds "Espinoza II" in 2024).
      const strictKey = norm(r.last) + '|' + stripMiddle(r.first);
      // 2025 lookup uses the broader canonical key (suffix-stripped + nickname-mapped)
      // because the 2025 payroll CSV often drops last-name suffixes
      // ("Espinoza II" -> "Espinoza") and uses nicknames inconsistently.
      const canonKey = canonicalNameKey(r.last, r.first);
      const pay2025 = by2025.get(canonKey);
      const matches2024 = by2024.get(strictKey);
      const carry2024 = (matches2024 && matches2024.length > 0)
        ? (matches2024.find(m => r.badge && m.badge_number === r.badge) || matches2024[0])
        : null;

      let pay, payrollYear;
      if (pay2025 && anyNonNull(Object.values(pay2025))) {
        pay = pay2025;
        payrollYear = 2025;
        payrollFrom2025++;
      } else if (carry2024 && anyNonNull([
        carry2024.regular_pay, carry2024.premiums, carry2024.overtime,
        carry2024.payout, carry2024.other_pay, carry2024.health_dental_vision,
      ])) {
        pay = {
          regular_pay: carry2024.regular_pay,
          premiums: carry2024.premiums,
          overtime: carry2024.overtime,
          payout: carry2024.payout,
          other_pay: carry2024.other_pay,
          health_dental_vision: carry2024.health_dental_vision,
        };
        payrollYear = 2024;
        payrollFrom2024++;
      } else {
        pay = { regular_pay: null, premiums: null, overtime: null, payout: null, other_pay: null, health_dental_vision: null };
        payrollYear = null;
        payrollNone++;
      }

      const classification = carry2024 ? carry2024.classification : baseRank(r.rankTitle);

      rows2026.push({
        last_name: r.last,
        first_name: r.first,
        badge_number: r.badge,
        classification,
        division: r.division,
        regular_pay: pay.regular_pay,
        premiums: pay.premiums,
        overtime: pay.overtime,
        payout: pay.payout,
        other_pay: pay.other_pay,
        health_dental_vision: pay.health_dental_vision,
        gender: r.gender,
        ethnicity: r.ethnicity,
        height: r.height,
        weight: r.weight,
        year_of_hire: r.yearOfHire,
        rank_title: r.rankTitle,
        roster_year: 2026,
        is_current: false,
        payroll_year: payrollYear,
      });
    }
    // Sort redacted rows by XLSX rowNumber so the assigned REDACTED-NNN IDs are stable
    // across re-runs (the XLSX row order doesn't change between migration runs).
    const redactedSorted = [...redactedXlsx].sort((a, b) => a.rowNumber - b.rowNumber);
    redactedSorted.forEach((r, i) => {
      const idNumber = String(i + 1).padStart(3, '0');
      // Names stay as the literal XLSX "XXXXXXX" strings to satisfy NOT NULL.
      // badge_number gets a stable REDACTED-NNN identifier so the 31 anonymous
      // records can be distinguished from each other in the UI and so photos
      // can be dropped in later under a matching filename.
      rows2026.push({
        last_name: r.last || 'XXXXXXX',
        first_name: r.first || 'XXXXXXX',
        badge_number: 'REDACTED-' + idNumber,
        classification: baseRank(r.rankTitle),
        division: r.division,
        regular_pay: null,
        premiums: null,
        overtime: null,
        payout: null,
        other_pay: null,
        health_dental_vision: null,
        gender: r.gender,
        ethnicity: r.ethnicity,
        height: r.height,
        weight: r.weight,
        year_of_hire: r.yearOfHire,
        rank_title: r.rankTitle,
        roster_year: 2026,
        is_current: false,
        payroll_year: null,
      });
    });

    const inserted2026 = await batchInsert(
      client,
      'personnel',
      ['last_name', 'first_name', 'badge_number', 'classification', 'division',
       'regular_pay', 'premiums', 'overtime', 'payout', 'other_pay', 'health_dental_vision',
       'gender', 'ethnicity', 'height', 'weight', 'year_of_hire', 'rank_title',
       'roster_year', 'is_current', 'payroll_year'],
      rows2026
    );
    console.log('\nPhase C: inserted ' + inserted2026 + ' rows for roster_year=2026');
    console.log('  Named:    ' + namedXlsx.length);
    console.log('    Payroll from 2025: ' + payrollFrom2025);
    console.log('    Payroll from 2024: ' + payrollFrom2024);
    console.log('    No payroll source: ' + payrollNone);
    console.log('  Redacted: ' + redactedXlsx.length + ' (no payroll)');

    // ---- Phase D: rebuild is_current ----
    // Named personnel: latest year wins per stripped-name key. The partition key
    // mirrors the JS `norm`/`stripMiddle` (lowercase + collapse-whitespace + strip
    // trailing single-letter initial), so it stays in sync if either side changes.
    const namedUpdate = await client.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY LOWER(REGEXP_REPLACE(TRIM(last_name), '\\s+', ' ', 'g')),
                              LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(first_name), '\\s+[A-Za-z]\\.?$', ''), '\\s+', ' ', 'g'))
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

    const redactedUpdate = await client.query(`
      UPDATE personnel SET is_current = true
       WHERE roster_year = 2026 AND last_name LIKE 'XXXX%'
    `);
    console.log('Phase D: marked ' + redactedUpdate.rowCount + ' redacted 2026 records as is_current=true');

    // ---- Phase E: nickname/badge-aware dedup ----
    // Phase D partitions by stripped name, but "Dan Baek" (2026) and "Daniel S. Baek"
    // (2025) end up in DIFFERENT partitions because the strip rule only handles trailing
    // single-letter initials, not nicknames. Same problem with Mike/Michael, Bob/Robert,
    // etc. Same-badge across years (e.g., name-change cases like Booth/Ramsey at 3800)
    // also slip through Phase D since the names differ entirely.
    //
    // This phase loads all named is_current=true records, groups them via union-find
    // on shared badge OR shared canonical-with-nickname name, and keeps only the
    // latest year per group. Older records flip back to is_current=false.
    const currentNamed = await client.query(`
      SELECT id, last_name, first_name, badge_number, roster_year
        FROM personnel
       WHERE is_current = true AND last_name NOT LIKE 'XXXX%'
    `);

    // Union-find over (badge OR canonical-name) equivalence.
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      // path compression
      let cur = x;
      while (parent.get(cur) !== r) { const nxt = parent.get(cur); parent.set(cur, r); cur = nxt; }
      return r;
    };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

    for (const row of currentNamed.rows) parent.set(row.id, row.id);

    // Group by badge (treats null as not-a-group).
    const byBadge = new Map();
    for (const row of currentNamed.rows) {
      if (!row.badge_number) continue;
      if (!byBadge.has(row.badge_number)) byBadge.set(row.badge_number, []);
      byBadge.get(row.badge_number).push(row.id);
    }
    for (const [, ids] of byBadge) {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    }

    // Group by canonical (nickname-mapped) name.
    const byCanonical = new Map();
    for (const row of currentNamed.rows) {
      const k = canonicalNameKey(row.last_name, row.first_name);
      if (!byCanonical.has(k)) byCanonical.set(k, []);
      byCanonical.get(k).push(row.id);
    }
    for (const [, ids] of byCanonical) {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    }

    // Collect groups; for each group with size > 1, keep one winner (latest roster_year).
    const groups = new Map();
    for (const row of currentNamed.rows) {
      const r = find(row.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(row);
    }
    const losers = [];
    let mergedGroups = 0;
    for (const [, members] of groups) {
      if (members.length < 2) continue;
      mergedGroups++;
      members.sort((a, b) => (b.roster_year - a.roster_year) || (a.id < b.id ? 1 : -1));
      const [winner, ...rest] = members;
      console.log(`  Merging group: keeping ${winner.first_name} ${winner.last_name} ` +
                  `#${winner.badge_number || '(no badge)'} year=${winner.roster_year}; ` +
                  `flipping ${rest.length}:`);
      for (const r of rest) {
        console.log(`    -> ${r.first_name} ${r.last_name} #${r.badge_number || '(no badge)'} year=${r.roster_year}`);
        losers.push(r.id);
      }
    }
    if (losers.length > 0) {
      await client.query('UPDATE personnel SET is_current = false WHERE id = ANY($1::uuid[])', [losers]);
    }
    console.log('\nPhase E: collapsed ' + mergedGroups + ' duplicate groups; ' + losers.length + ' records flipped to is_current=false');

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

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN complete — changes rolled back.');
    } else {
      await client.query('COMMIT');
      console.log('\nMigration committed successfully.');
    }
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

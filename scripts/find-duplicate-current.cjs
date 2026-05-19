// Find is_current=true records that look like duplicates of the same person
// despite the Phase D PARTITION BY thinking they're different (because of
// nickname / middle-name shape differences).
require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// Nickname map from photoUtils.ts.
const nicknameMap = {
  daniel: 'daniel', dan: 'daniel',
  robert: 'robert', rob: 'robert', bob: 'robert',
  william: 'william', bill: 'william', will: 'william',
  richard: 'richard', rick: 'richard', dick: 'richard',
  michael: 'michael', mike: 'michael',
  christopher: 'christopher', chris: 'christopher',
  matthew: 'matthew', matt: 'matthew',
  anthony: 'anthony', tony: 'anthony',
};

// Canonical form: lowercase, strip trailing single-letter initial,
// collapse internal whitespace, then map common nicknames to canonical first name.
function canonical(last, first) {
  const ln = (last || '').toLowerCase().trim().replace(/\s+/g, ' ');
  let fn = (first || '').toLowerCase().trim().replace(/\s+/g, ' ');
  fn = fn.replace(/\s+[a-z]\.?$/i, ''); // strip trailing initial
  // Map nickname -> canonical
  if (nicknameMap[fn]) fn = nicknameMap[fn];
  return ln + '|' + fn;
}

(async () => {
  const r = await pool.query(`
    SELECT id, first_name, last_name, badge_number, roster_year
    FROM personnel
    WHERE is_current = true AND last_name NOT LIKE 'XXXX%'
    ORDER BY last_name, first_name
  `);
  console.log('is_current named records: ' + r.rows.length);

  const byCanonical = new Map();
  for (const row of r.rows) {
    const k = canonical(row.last_name, row.first_name);
    if (!byCanonical.has(k)) byCanonical.set(k, []);
    byCanonical.get(k).push(row);
  }

  const dupes = [...byCanonical.entries()].filter(([k, rows]) => rows.length > 1);
  console.log('\nCanonical-name duplicates: ' + dupes.length);
  for (const [k, rows] of dupes) {
    console.log('  ' + k);
    for (const row of rows) {
      console.log('    -> "' + row.first_name + ' ' + row.last_name + '" badge=' + row.badge_number + ' year=' + row.roster_year);
    }
  }

  // Also check: badge-based duplicates (same badge across years still marked current)
  const byBadge = new Map();
  for (const row of r.rows) {
    if (!row.badge_number) continue;
    const b = row.badge_number;
    if (!byBadge.has(b)) byBadge.set(b, []);
    byBadge.get(b).push(row);
  }
  const badgeDupes = [...byBadge.entries()].filter(([b, rows]) => rows.length > 1);
  console.log('\nSame-badge duplicates (different years, both is_current): ' + badgeDupes.length);
  for (const [b, rows] of badgeDupes.slice(0, 10)) {
    console.log('  badge ' + b);
    for (const row of rows) console.log('    -> ' + row.first_name + ' ' + row.last_name + ' year=' + row.roster_year);
  }

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

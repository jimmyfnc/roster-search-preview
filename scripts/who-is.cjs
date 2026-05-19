// Quick lookup tool: shows all records for a person across years, plus
// whether the deployed frontend will find a photo for the is_current one.
// Usage:
//   node scripts/who-is.cjs "joey belizario"
//   node scripts/who-is.cjs belizario
//   .\scripts\run-against-vercel-prod.ps1 scripts/who-is.cjs "joey belizario"
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const query = process.argv.slice(2).join(' ').trim();
if (!query) { console.error('Usage: node scripts/who-is.cjs <name or badge>'); process.exit(1); }

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) { console.error('No DB URL'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// Minimal version of photoUtils' filename generation, just enough to spot-check.
function probableFilenames(person) {
  if (!person.badge_number || !person.first_name || !person.last_name) return [];
  if (/^X+$/i.test(person.last_name.replace(/\s+/g, ''))) return [];
  const fmt = s => s.toLowerCase().trim().replace(/\s+/g, '_').replace(/['"]/g, '');
  const ln = fmt(person.last_name);
  const fn = fmt(person.first_name);
  const fnStripped = fn.replace(/_[a-z]\.?$/i, '');
  const b = person.badge_number;
  const out = new Set([
    `${ln}_${fn}_${b}.webp`,
    `${ln}_${fnStripped}_${b}.webp`,
    `${ln}_${fn}.webp`,
    `${ln}_${fnStripped}.webp`,
  ]);
  return [...out];
}

(async () => {
  const r = await pool.query(`
    SELECT id, first_name, last_name, badge_number, roster_year, is_current, payroll_year,
           regular_pay, overtime, payout, division, rank_title
    FROM personnel
    WHERE last_name ILIKE $1 OR first_name ILIKE $1 OR badge_number ILIKE $1
       OR (last_name || ' ' || first_name) ILIKE $1
       OR (first_name || ' ' || last_name) ILIKE $1
    ORDER BY roster_year DESC, is_current DESC
  `, ['%' + query + '%']);

  if (r.rows.length === 0) {
    console.log('No records matched: ' + query);
    await pool.end();
    return;
  }

  console.log('=== Matches for: "' + query + '" ===\n');
  const photosDir = path.join(__dirname, '..', 'public', 'photos');
  const existingPhotos = new Set(fs.readdirSync(photosDir).filter(f => /\.webp$/i.test(f)));

  for (const row of r.rows) {
    console.log(row.first_name + ' ' + row.last_name);
    console.log('  id:            ' + row.id);
    console.log('  badge:         ' + (row.badge_number || '(none)'));
    console.log('  roster_year:   ' + row.roster_year);
    console.log('  is_current:    ' + row.is_current);
    console.log('  payroll_year:  ' + (row.payroll_year || '(none)'));
    console.log('  division:      ' + (row.division || '(none)'));
    console.log('  rank_title:    ' + (row.rank_title || '(none)'));
    if (row.regular_pay) console.log('  regular_pay:   $' + row.regular_pay);
    const fnames = probableFilenames(row);
    if (fnames.length) {
      const hits = fnames.filter(f => existingPhotos.has(f));
      if (hits.length) {
        console.log('  photo:         ' + hits[0] + ' ✓');
      } else {
        console.log('  photo:         NONE FOUND (tried: ' + fnames.slice(0, 3).join(', ') + ')');
      }
    } else {
      console.log('  photo:         (no badge or redacted — can\'t look up)');
    }
    console.log('');
  }

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

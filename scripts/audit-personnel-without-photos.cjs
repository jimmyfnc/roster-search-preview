// For every is_current=true personnel record, determine whether ANY photoUtils
// filename variation would resolve to a file on disk. Lists the personnel who
// will fall back to initials in the UI.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) { console.error('No DB URL'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const PHOTOS_DIR = path.join(__dirname, '..', 'public', 'photos');

// Mirror photoUtils.ts variation generation (with-badge cases) so this audit
// matches what the deployed frontend will actually try.
function photoVariations(lastName, firstName, badge) {
  if (!lastName || !firstName || !badge) return [];
  const fmt = (s) => s.replace(/\s+/g, '_').replace(/['"]/g, '');
  const ln = lastName.toLowerCase();
  const fn = firstName.toLowerCase();
  const formattedFirstName = fmt(fn);
  const formattedLastName = fmt(ln);

  const suffixPatterns = [
    { pattern: /\s+(jr\.?|junior)$/i, replacement: '-jr', concat: 'jr' },
    { pattern: /\s+(sr\.?|senior)$/i, replacement: '-sr', concat: 'sr' },
    { pattern: /\s+(ii|2nd)$/i, replacement: 'ii', concat: 'ii' },
    { pattern: /\s+(iii|3rd)$/i, replacement: 'iii', concat: 'iii' },
    { pattern: /\s+(iv|4th)$/i, replacement: 'iv', concat: 'iv' },
  ];

  let baseLastName = ln;
  let suffix = null;
  for (const p of suffixPatterns) {
    if (p.pattern.test(ln)) {
      baseLastName = ln.replace(p.pattern, '');
      suffix = p;
      break;
    }
  }
  const baseLastFmt = fmt(baseLastName);

  const nicknameMap = {
    daniel: ['dan'], robert: ['rob', 'bob'], william: ['bill', 'will'],
    richard: ['rick', 'dick'], michael: ['mike'], christopher: ['chris'],
    matthew: ['matt'], anthony: ['tony'],
  };
  const firstNameVariants = [formattedFirstName, ...(nicknameMap[fn] || [])];

  const badgeVariants = [badge, badge.toLowerCase(), badge.toUpperCase()];
  const exts = ['.webp', '.webpX'];

  // Stripped-middle-initial variant ("james_d." -> "james"), matches photoUtils.ts fix.
  const strippedFirst = formattedFirstName.replace(/_[a-z]\.?$/i, '');
  if (strippedFirst && strippedFirst !== formattedFirstName) {
    firstNameVariants.push(strippedFirst);
  }

  const out = new Set();
  for (const ext of exts) {
    for (const b of badgeVariants) {
      for (const fnv of firstNameVariants) {
        // base format
        out.add(`${formattedLastName}_${fnv}_${b}${ext}`);
        if (suffix) {
          out.add(`${baseLastFmt}${suffix.replacement}_${fnv}_${b}${ext}`);
          out.add(`${baseLastFmt}${suffix.concat}_${fnv}_${b}${ext}`);
          out.add(`${baseLastFmt}_${suffix.concat}_${fnv}_${b}${ext}`);
          out.add(`${baseLastFmt}_${fnv}_${b}${ext}`);
        }
        // Compound last name (e.g., "Garcia Beltran"): last part, first part
        if (formattedLastName.includes('_')) {
          const parts = formattedLastName.split('_');
          out.add(`${parts[parts.length - 1]}_${fnv}_${b}${ext}`);
          out.add(`${parts[0]}_${fnv}_${b}${ext}`);
        }
        if (baseLastFmt.includes('_')) {
          const parts = baseLastFmt.split('_');
          out.add(`${parts[parts.length - 1]}_${fnv}_${b}${ext}`);
          out.add(`${parts[0]}_${fnv}_${b}${ext}`);
        }
      }
    }
    // Without-badge fallback variants
    for (const fnv of firstNameVariants) {
      out.add(`${formattedLastName}_${fnv}${ext}`);
      if (suffix) out.add(`${baseLastFmt}_${fnv}${ext}`);
    }
  }
  // Gonzalez typo special case mirrored from photoUtils.ts
  if (ln === 'gonzalez') {
    for (const ext of exts) {
      for (const b of badgeVariants) {
        for (const fnv of firstNameVariants) {
          out.add(`gonazalez_${fnv}_${b}${ext}`);
        }
      }
    }
  }
  return [...out];
}

(async () => {
  const r = await pool.query(`
    SELECT id, first_name, last_name, badge_number, roster_year
    FROM personnel
    WHERE is_current = true
    ORDER BY last_name, first_name
  `);
  console.log('Current personnel: ' + r.rows.length);

  const existingFiles = new Set(fs.readdirSync(PHOTOS_DIR).filter(f => /\.webp$/i.test(f)));
  console.log('Photos on disk: ' + existingFiles.size + '\n');

  const missingNamed = [];
  const missingRedactedOrNoBadge = [];

  for (const row of r.rows) {
    const isRedacted = row.last_name && /^X+$/i.test(row.last_name.replace(/\s+/g, ''));
    if (isRedacted) {
      missingRedactedOrNoBadge.push(row);
      continue;
    }
    if (!row.badge_number) {
      missingRedactedOrNoBadge.push(row);
      continue;
    }
    const candidates = photoVariations(row.last_name, row.first_name, row.badge_number);
    if (!candidates.some(c => existingFiles.has(c))) {
      missingNamed.push(row);
    }
  }

  console.log('=== Personnel with no photo file the frontend can find ===');
  console.log('Named personnel with badge (genuine gap): ' + missingNamed.length);
  for (const row of missingNamed) {
    console.log('  ' + row.last_name + ', ' + row.first_name + ' #' + row.badge_number + ' (roster_year=' + row.roster_year + ')');
  }
  console.log('');
  console.log('Redacted or no-badge (expected, can\'t look up a photo): ' + missingRedactedOrNoBadge.length);

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

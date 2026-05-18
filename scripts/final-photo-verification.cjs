// Final verification: uses a verbatim copy of getPhotoUrlVariations from
// src/utils/photoUtils.ts (no reimplementation) and runs it against every
// is_current=true personnel record. Reports any whose variations don't
// resolve to a file in public/photos/.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ===== BEGIN verbatim port of src/utils/photoUtils.ts (TS types stripped) =====
function generatePhotoVariations(person) {
  const variations = [];
  if (!person.last_name || !person.first_name) return variations;

  const lastName = person.last_name.toLowerCase().trim();
  const firstName = person.first_name.toLowerCase().trim();

  const suffixPatterns = [
    { pattern: /\s+(jr\.?|junior)$/i, replacement: '-jr' },
    { pattern: /\s+(sr\.?|senior)$/i, replacement: '-sr' },
    { pattern: /\s+(ii|2nd)$/i, replacement: 'ii' },
    { pattern: /\s+(iii|3rd)$/i, replacement: 'iii' },
    { pattern: /\s+(iv|4th)$/i, replacement: 'iv' },
  ];

  const nicknameMap = {
    'daniel': ['dan'],
    'daniel ': ['dan'],
    'robert': ['rob', 'bob'],
    'william': ['bill', 'will'],
    'richard': ['rick', 'dick'],
    'michael': ['mike'],
    'christopher': ['chris'],
    'matthew': ['matt'],
    'anthony': ['tony']
  };

  let baseLastName = lastName;
  let suffixVariation = '';
  for (const { pattern, replacement } of suffixPatterns) {
    if (pattern.test(lastName)) {
      baseLastName = lastName.replace(pattern, '');
      suffixVariation = replacement;
      break;
    }
  }

  const formatName = (name) => name.replace(/\s+/g, '_').replace(/['"]/g, '');
  const formattedFirstName = formatName(firstName);
  const formattedBaseLastName = formatName(baseLastName);

  const generateCompoundNameVariations = (first, last, badge, ext) => {
    const cv = [];
    if (last.includes('_')) {
      const lp = last.split('_');
      cv.push(`/photos/${lp[lp.length - 1]}_${first}_${badge}${ext}`);
      cv.push(`/photos/${lp[0]}_${first}_${badge}${ext}`);
    }
    if (first.includes('_')) {
      const fp = first.split('_');
      cv.push(`/photos/${last}_${fp[0]}_${badge}${ext}`);
      if (fp.length === 2) cv.push(`/photos/${last}_${fp[1]}_${fp[0]}_${badge}${ext}`);
    }
    if (last.includes('de_')) {
      const dp = last.split('de_');
      if (dp.length === 2) {
        cv.push(`/photos/${dp[0]}_de_${dp[1]}_${first}_${badge}${ext}`);
        cv.push(`/photos/${dp[0]}_${dp[1]}_${first}_${badge}${ext}`);
      }
    }
    return cv;
  };

  if (person.badge_number) {
    const extensions = ['.webp', '.webpX'];
    const badgeVariations = [
      person.badge_number,
      person.badge_number.toLowerCase(),
      person.badge_number.toUpperCase()
    ];

    for (const ext of extensions) {
      for (const badge of badgeVariations) {
        const firstNameVariations = [formattedFirstName];
        const lowerFirstName = firstName.toLowerCase();
        if (nicknameMap[lowerFirstName]) {
          firstNameVariations.push(...nicknameMap[lowerFirstName]);
        }
        const strippedFirst = formattedFirstName.replace(/_[a-z]\.?$/i, '');
        if (strippedFirst && strippedFirst !== formattedFirstName) {
          firstNameVariations.push(strippedFirst);
          if (nicknameMap[strippedFirst]) firstNameVariations.push(...nicknameMap[strippedFirst]);
        }

        for (const firstNameVar of firstNameVariations) {
          if (suffixVariation && !suffixVariation.startsWith('-')) {
            variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${firstNameVar}_${badge}${ext}`);
          }
          if (suffixVariation && suffixVariation.startsWith('-')) {
            variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${firstNameVar}_${badge}${ext}`);
          }
          if (suffixVariation === '-jr') {
            variations.push(`/photos/${formattedBaseLastName}jr_${firstNameVar}_${badge}${ext}`);
          }
          if (suffixVariation === '-sr') {
            variations.push(`/photos/${formattedBaseLastName}sr_${firstNameVar}_${badge}${ext}`);
          }
          if (suffixVariation === '-jr') {
            variations.push(`/photos/${formattedBaseLastName}_jr_${firstNameVar}_${badge}${ext}`);
          }
          if (suffixVariation === '-sr') {
            variations.push(`/photos/${formattedBaseLastName}_sr_${firstNameVar}_${badge}${ext}`);
          }
          const formattedLastName = formatName(lastName);
          variations.push(`/photos/${formattedLastName}_${firstNameVar}_${badge}${ext}`);
          if (suffixVariation) {
            variations.push(`/photos/${formattedBaseLastName}_${firstNameVar}_${badge}${ext}`);
          }
          variations.push(...generateCompoundNameVariations(firstNameVar, formattedBaseLastName, badge, ext));
          variations.push(...generateCompoundNameVariations(firstNameVar, formattedLastName, badge, ext));
        }
      }
    }
  }

  if (person.last_name.toLowerCase() === 'gonzalez') {
    const typoLastName = 'gonazalez';
    const extensions = ['.webp', '.webpX'];
    for (const ext of extensions) {
      if (person.badge_number) {
        const badgeVariations = [
          person.badge_number,
          person.badge_number.toLowerCase(),
          person.badge_number.toUpperCase()
        ];
        for (const badge of badgeVariations) {
          variations.push(`/photos/${typoLastName}_${formattedFirstName}_${badge}${ext}`);
        }
      }
      variations.push(`/photos/${typoLastName}_${formattedFirstName}${ext}`);
    }
  }

  const extensions = ['.webp', '.webpX'];
  for (const ext of extensions) {
    if (suffixVariation && !suffixVariation.startsWith('-')) {
      variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${formattedFirstName}${ext}`);
    }
    if (suffixVariation && suffixVariation.startsWith('-')) {
      variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${formattedFirstName}${ext}`);
    }
    if (suffixVariation === '-jr') {
      variations.push(`/photos/${formattedBaseLastName}jr_${formattedFirstName}${ext}`);
    }
    if (suffixVariation === '-sr') {
      variations.push(`/photos/${formattedBaseLastName}sr_${formattedFirstName}${ext}`);
    }
    const formattedLastName = formatName(lastName);
    variations.push(`/photos/${formattedLastName}_${formattedFirstName}${ext}`);
    if (suffixVariation) {
      variations.push(`/photos/${formattedBaseLastName}_${formattedFirstName}${ext}`);
    }
  }

  return [...new Set(variations)];
}
// ===== END verbatim port =====

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) { console.error('No DB URL'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const PHOTOS_DIR = path.join(__dirname, '..', 'public', 'photos');

(async () => {
  const r = await pool.query(`
    SELECT id, first_name, last_name, badge_number, roster_year, is_current
    FROM personnel WHERE is_current = true
    ORDER BY last_name, first_name
  `);
  console.log('Current personnel: ' + r.rows.length);

  const existingFiles = new Set(fs.readdirSync(PHOTOS_DIR).filter(f => /\.webp$/i.test(f)));
  console.log('Photos on disk (post-cleanup): ' + existingFiles.size + '\n');

  const missingNamed = [];
  const missingRedactedOrNoBadge = [];
  const found = [];

  for (const row of r.rows) {
    const isRedacted = row.last_name && /^X+$/i.test(row.last_name.replace(/\s+/g, ''));
    if (isRedacted || !row.badge_number) {
      missingRedactedOrNoBadge.push(row);
      continue;
    }
    const variations = generatePhotoVariations(row);
    // variations are URLs like "/photos/foo.webp" — strip the prefix to compare with filenames
    const candidateFiles = variations.map(v => v.replace(/^\/photos\//, ''));
    const hit = candidateFiles.find(f => existingFiles.has(f));
    if (hit) {
      found.push({ row, hit });
    } else {
      missingNamed.push({ row, candidateFiles });
    }
  }

  console.log('=== FINAL VERIFICATION (using exact photoUtils.ts logic) ===');
  console.log('Personnel with photo successfully resolvable: ' + found.length);
  console.log('Personnel WITH BADGE but NO resolvable photo:  ' + missingNamed.length);
  console.log('Personnel redacted / no badge (expected):       ' + missingRedactedOrNoBadge.length);
  console.log('');

  if (missingNamed.length === 0) {
    console.log('NO MISSING PHOTOS — every named is_current personnel resolves to a photo file.');
  } else {
    console.log('TRULY MISSING (no photo file matches any photoUtils variation):');
    for (const m of missingNamed) {
      console.log('  ' + m.row.last_name + ', ' + m.row.first_name + ' #' + m.row.badge_number +
                  ' (roster_year=' + m.row.roster_year + ')');
    }
    console.log('');
    console.log('Sample variations tried for first missing entry (' + missingNamed[0].row.last_name +
                ', ' + missingNamed[0].row.first_name + ' #' + missingNamed[0].row.badge_number + '):');
    for (const v of missingNamed[0].candidateFiles.slice(0, 8)) console.log('  ' + v);
    console.log('  ... (' + missingNamed[0].candidateFiles.length + ' total variations)');
  }

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

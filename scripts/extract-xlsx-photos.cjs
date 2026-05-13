// Extract embedded personnel photos from the 2026 XLSX, sharp-convert PNG -> WebP,
// and write to public/photos/ using the standard lastname_firstname_badge.webp naming.
//
// Safe to run independently of the database migration. Overwrites existing 295 dupes
// per user direction (so the higher-quality XLSX versions win).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ensureExtracted, readSheet, readImageAnchors } = require('./xlsx-helper.cjs');

const XLSX_PATH = path.join(__dirname, '..', 'public', 'data', 'NSP_2026_SAPD_260114_ROSTER.xlsx');
const EXTRACT_DIR = path.join(os.tmpdir(), 'nsp_xlsx_photos');
const OUT_DIR = path.join(__dirname, '..', 'public', 'photos');

// Match the existing public/photos/ naming: lowercase, spaces -> underscores, strip
// surrounding quotes and trailing punctuation (which Windows treats fragile in paths).
function nameToken(s) {
  return (s || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[.,;:!?]+$/, '')
    .replace(/\s+/g, '_');
}

async function main() {
  console.log('Extracting XLSX to ' + EXTRACT_DIR);
  ensureExtracted(XLSX_PATH, EXTRACT_DIR);

  const { rows } = readSheet(EXTRACT_DIR);
  const rowByNumber = new Map();
  for (const r of rows) rowByNumber.set(r.rowNumber, r);

  const anchors = readImageAnchors(EXTRACT_DIR);
  console.log('Anchors: ' + anchors.length);

  let written = 0, overwritten = 0, skipped = 0, unnamed = 0;
  for (const a of anchors) {
    const info = rowByNumber.get(a.row);
    if (!info) {
      skipped++;
      continue;
    }
    if (info.isRedacted || !info.last || !info.first || !info.badge) {
      unnamed++;
      continue;
    }
    const outName = `${nameToken(info.last)}_${nameToken(info.first)}_${info.badge}.webp`;
    const outPath = path.join(OUT_DIR, outName);
    const existed = fs.existsSync(outPath);
    try {
      await sharp(a.file).webp({ quality: 90 }).toFile(outPath);
    } catch (e) {
      console.error('  FAILED ' + outName + ': ' + e.message);
      continue;
    }
    if (existed) overwritten++;
    else written++;
  }

  console.log('\n=== PHOTO EXTRACTION SUMMARY ===');
  console.log('New photos written:        ' + written);
  console.log('Existing photos refreshed: ' + overwritten);
  console.log('Skipped (no row match):    ' + skipped);
  console.log('Skipped (redacted/unnamed/no badge): ' + unnamed);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

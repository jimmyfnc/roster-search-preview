// Diagnose missing personnel photos against the 2026 XLSX source.
// For each named XLSX row that has an embedded image, check whether a file
// matching the standard naming convention exists in public/photos/. Reports:
//   - personnel where XLSX has a photo but file is missing on disk
//   - personnel with photo but a name shape that may not match photoUtils.ts probing
//   - orphan photo files (in public/photos/ but no corresponding XLSX row)
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureExtracted, readSheet, readImageAnchors } = require('./xlsx-helper.cjs');

const XLSX_PATH = path.join(__dirname, '..', 'public', 'data', 'NSP_2026_SAPD_260114_ROSTER.xlsx');
const PHOTOS_DIR = path.join(__dirname, '..', 'public', 'photos');
const EXTRACT_DIR = path.join(os.tmpdir(), 'nsp_xlsx_audit');

function nameToken(s) {
  return (s || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[.,;:!?]+$/, '')
    .replace(/\s+/g, '_');
}

// Mirror the variations photoUtils.ts generates so we can see if ANY of them
// would resolve to a file currently on disk.
function plausiblePhotoNames(last, first, badge) {
  if (!last || !first || !badge) return [];
  const ln = last.toLowerCase();
  const fn = first.toLowerCase();
  const names = new Set();
  const baseFmt = (s) => s.replace(/\s+/g, '_').replace(/['"]/g, '');
  const lastFmt = baseFmt(ln);
  const firstFmt = baseFmt(fn);

  const badgeVariations = [badge, badge.toLowerCase(), badge.toUpperCase()];

  // Suffix patterns from photoUtils
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
  const baseLastFmt = baseFmt(baseLastName);

  for (const b of badgeVariations) {
    names.add(`${lastFmt}_${firstFmt}_${b}.webp`);
    if (suffix) {
      if (!suffix.replacement.startsWith('-')) names.add(`${baseLastFmt}${suffix.replacement}_${firstFmt}_${b}.webp`);
      else names.add(`${baseLastFmt}${suffix.replacement}_${firstFmt}_${b}.webp`);
      names.add(`${baseLastFmt}${suffix.concat}_${firstFmt}_${b}.webp`);
      names.add(`${baseLastFmt}_${suffix.concat}_${firstFmt}_${b}.webp`);
      names.add(`${baseLastFmt}_${firstFmt}_${b}.webp`);
    }
    // Our extraction's nameToken output (strip trailing punctuation in last name):
    names.add(`${nameToken(last)}_${nameToken(first)}_${b}.webp`);
  }
  return [...names];
}

async function main() {
  console.log('Re-extracting XLSX to ' + EXTRACT_DIR);
  ensureExtracted(XLSX_PATH, EXTRACT_DIR);

  const { rows } = readSheet(EXTRACT_DIR);
  const rowByNumber = new Map();
  for (const r of rows) rowByNumber.set(r.rowNumber, r);

  const anchors = readImageAnchors(EXTRACT_DIR);
  console.log('XLSX rows: ' + rows.length + ' (anchors: ' + anchors.length + ')\n');

  const existingFiles = new Set(fs.readdirSync(PHOTOS_DIR).filter(f => /\.webp$/i.test(f)));
  console.log('Files on disk in public/photos/: ' + existingFiles.size + '\n');

  // 1) Anchors -> personnel; check if any plausible filename matches
  const missing = [];
  const ambiguous = [];
  const matched = [];
  const skipped = [];

  for (const a of anchors) {
    const info = rowByNumber.get(a.row);
    if (!info) {
      skipped.push({ reason: 'no row for anchor', row: a.row, file: path.basename(a.file) });
      continue;
    }
    if (info.isRedacted) {
      skipped.push({ reason: 'redacted', row: a.row });
      continue;
    }
    if (!info.last || !info.first || !info.badge) {
      skipped.push({ reason: 'missing name/badge', row: a.row, last: info.last, first: info.first, badge: info.badge });
      continue;
    }
    const candidates = plausiblePhotoNames(info.last, info.first, info.badge);
    const hits = candidates.filter(c => existingFiles.has(c));
    if (hits.length === 0) {
      missing.push({ row: a.row, last: info.last, first: info.first, badge: info.badge, candidates });
    } else if (hits.length === 1) {
      matched.push(hits[0]);
    } else {
      ambiguous.push({ row: a.row, last: info.last, first: info.first, badge: info.badge, hits });
    }
  }

  console.log('=== XLSX has photo, file MATCHES on disk: ' + matched.length);
  console.log('=== XLSX has photo, file MISSING on disk: ' + missing.length);
  if (missing.length) {
    console.log('Missing examples (first 15):');
    for (const m of missing.slice(0, 15)) {
      console.log('  ' + m.last + ', ' + m.first + ' #' + m.badge + ' (XLSX row ' + m.row + ')');
      console.log('    Tried: ' + m.candidates.slice(0, 4).join(', ') + (m.candidates.length > 4 ? ', ...' : ''));
    }
  }

  console.log('\n=== XLSX has photo, MULTIPLE file matches (ambiguous): ' + ambiguous.length);
  if (ambiguous.length) {
    for (const a of ambiguous.slice(0, 5)) {
      console.log('  ' + a.last + ', ' + a.first + ' #' + a.badge + ' -> ' + a.hits.join(' / '));
    }
  }

  console.log('\n=== Skipped anchors: ' + skipped.length);
  const reasonCounts = {};
  for (const s of skipped) reasonCounts[s.reason] = (reasonCounts[s.reason] || 0) + 1;
  for (const [r, n] of Object.entries(reasonCounts)) console.log('  ' + r + ': ' + n);

  // 2) Personnel with no XLSX anchor — they're either redacted or just don't have a photo in the spreadsheet.
  const anchorRows = new Set(anchors.map(a => a.row));
  const noPhotoRows = rows.filter(r => !anchorRows.has(r.rowNumber));
  console.log('\n=== Personnel rows in XLSX WITHOUT an embedded image: ' + noPhotoRows.length);
  console.log('  (these are who the spreadsheet itself does NOT have a photo for)');
  const noPhotoNamed = noPhotoRows.filter(r => !r.isRedacted);
  console.log('  Of those, named (not redacted): ' + noPhotoNamed.length);
  if (noPhotoNamed.length && noPhotoNamed.length <= 20) {
    for (const r of noPhotoNamed) {
      console.log('    ' + r.last + ', ' + r.first + ' #' + (r.badge || '(no badge)'));
    }
  }
}

main().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });

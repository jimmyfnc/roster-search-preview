// Analysis-only script for the new 2025 CSV and 2026 XLSX.
// Does not touch the database. Reports findings to stdout.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Papa = require('papaparse');

const TMP = path.join(os.tmpdir(), 'nsp_xlsx_inspect');

// ---- Helpers ----
const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const stripMiddle = s => norm(s).replace(/\s+[a-z]\.?$/, '');

// ---- 1) Read XLSX bits ----
const sheetXml = fs.readFileSync(path.join(TMP, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
const sstPath = path.join(TMP, 'xl', 'sharedStrings.xml');
let sst = [];
if (fs.existsSync(sstPath)) {
  const sstXml = fs.readFileSync(sstPath, 'utf8');
  sst = [...sstXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map(m =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
  );
}

function cellsOfRow(rowXml) {
  const cells = [...rowXml.matchAll(/<c r="([A-Z]+\d+)"(?:\s+s="[^"]*")?(?:\s+t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)];
  const out = {};
  for (const c of cells) {
    const ref = c[1], t = c[2], inner = c[3];
    const col = ref.replace(/\d+/, '');
    let val = '';
    const vm = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
    if (vm) {
      val = t === 's' ? (sst[parseInt(vm[1], 10)] || '') : vm[1];
    } else {
      const im = inner.match(/<is>([\s\S]*?)<\/is>/);
      if (im) {
        const tm = im[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (tm) val = tm[1];
      }
    }
    out[col] = val;
  }
  return out;
}

const rowMatches = [...sheetXml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
const headerCells = cellsOfRow(rowMatches[0][2]);
console.log('=== XLSX HEADERS ===');
console.log(JSON.stringify(headerCells));
console.log('');

const colOf = name => {
  for (const [k, v] of Object.entries(headerCells)) {
    if ((v || '').toLowerCase().trim() === name.toLowerCase()) return k;
  }
  return null;
};
const badgeCol = colOf('Badge #') || colOf('Badge#') || colOf('Badge');
const lnCol = colOf('Last Name');
const fnCol = colOf('First Name');

const rowToInfo = {};
let dataRows = 0;
for (let i = 1; i < rowMatches.length; i++) {
  const rNum = parseInt(rowMatches[i][1], 10);
  const cells = cellsOfRow(rowMatches[i][2]);
  if (!cells[lnCol] && !cells[fnCol]) continue;
  dataRows++;
  // Excel stores badges as numbers, so "3678" comes through as "3678.0" — normalize.
  let badge = cells[badgeCol] || '';
  if (/^\d+\.0+$/.test(badge)) badge = badge.split('.')[0];
  rowToInfo[rNum] = {
    last: cells[lnCol] || '',
    first: cells[fnCol] || '',
    badge,
  };
}
console.log('XLSX data rows: ' + dataRows);

// ---- 2) Parse drawing1.xml ----
const drawing = fs.readFileSync(path.join(TMP, 'xl', 'drawings', 'drawing1.xml'), 'utf8');
const drels = fs.readFileSync(path.join(TMP, 'xl', 'drawings', '_rels', 'drawing1.xml.rels'), 'utf8');
const relMap = {};
for (const m of drels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  relMap[m[1]] = m[2];
}
const anchors = [...drawing.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)[\s\S]*?<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<a:blip[^>]*r:embed="([^"]+)"/g)];
console.log('Drawing anchors: ' + anchors.length);

const imageRows = anchors.map(a => ({
  row: parseInt(a[2], 10) + 1, // xdr:row is 0-indexed
  file: relMap[a[3]],
}));

// ---- 3) Map photos -> personnel ----
let assigned = 0, noBadge = 0, noRow = 0;
const photoMap = [];
for (const ir of imageRows) {
  const info = rowToInfo[ir.row];
  if (!info) { noRow++; continue; }
  if (!info.badge || /^X+$/i.test(info.badge)) noBadge++;
  photoMap.push({ file: ir.file, ...info });
  assigned++;
}
console.log('');
console.log('=== PHOTO -> PERSONNEL MAPPING ===');
console.log('Total images: ' + imageRows.length);
console.log('Mapped to a data row: ' + assigned);
console.log('Rows with blank/X badge: ' + noBadge);
console.log('Anchors w/o data row: ' + noRow);

// ---- 4) Existing photo coverage ----
const existing = fs.readdirSync(path.join(__dirname, '..', 'public', 'photos')).filter(f => /\.webp$/.test(f));
const existingBadges = new Set();
for (const f of existing) {
  const m = f.match(/_(\d+)\.webp$/);
  if (m) existingBadges.add(m[1]);
}
console.log('');
console.log('=== PHOTO OVERLAP ===');
console.log('Existing photos in public/photos/: ' + existing.length);

let dupePhotos = 0, newPhotos = 0, noBadgeForCheck = 0;
const newSamples = [];
for (const p of photoMap) {
  if (!p.badge || /^X+$/i.test(p.badge)) { noBadgeForCheck++; continue; }
  if (existingBadges.has(p.badge)) dupePhotos++;
  else {
    newPhotos++;
    if (newSamples.length < 5) newSamples.push(`${p.last} ${p.first} #${p.badge}`);
  }
}
console.log('XLSX photos with badge: ' + (dupePhotos + newPhotos));
console.log('  - Already have a photo for that badge: ' + dupePhotos);
console.log('  - NEW photo (badge not in public/photos/): ' + newPhotos);
console.log('XLSX photos w/o usable badge: ' + noBadgeForCheck);
if (newSamples.length) {
  console.log('Sample new-photo personnel:');
  newSamples.forEach(s => console.log('  ' + s));
}

// ---- 5) Photo coverage of the current DB's 2026 roster ----
const csv2026 = Papa.parse(
  fs.readFileSync('public/data/NSP_UPDATE_SAPD_202603 - MASTER.csv', 'utf8'),
  { header: true, skipEmptyLines: true }
).data;

const curBadges = new Set();
for (const r of csv2026) {
  const b = (r['Badge #'] || '').trim();
  if (b && !/^X+$/i.test(b)) curBadges.add(b);
}
let curHas = 0, curMissing = 0;
for (const b of curBadges) (existingBadges.has(b) ? curHas++ : curMissing++);
const xlsxBadges = new Set(photoMap.filter(p => p.badge && !/^X+$/i.test(p.badge)).map(p => p.badge));
let canFill = 0;
for (const b of curBadges) if (!existingBadges.has(b) && xlsxBadges.has(b)) canFill++;
console.log('');
console.log('=== CURRENT 2026 ROSTER PHOTO COVERAGE ===');
console.log('2026 CSV badges: ' + curBadges.size);
console.log('  - Already have photo: ' + curHas);
console.log('  - Missing photo: ' + curMissing);
console.log('  - Of those missing, XLSX supplies: ' + canFill);

// ---- 6) XLSX identity vs current 2026 DB ----
const cur2026 = new Set();
for (const r of csv2026) {
  const k = norm(r['Last Name']) + '|' + stripMiddle(r['First Name']);
  cur2026.add(k);
}
let xlsxInDB = 0, xlsxNewPersonnel = 0;
for (const p of photoMap) {
  const k = norm(p.last) + '|' + stripMiddle(p.first);
  if (cur2026.has(k)) xlsxInDB++;
  else xlsxNewPersonnel++;
}
console.log('');
console.log('=== XLSX ROW IDENTITY vs CURRENT 2026 DB ===');
console.log('XLSX rows (w/ image) matching a 2026 DB record: ' + xlsxInDB);
console.log('XLSX rows (w/ image) NOT in 2026 DB (would be new): ' + xlsxNewPersonnel);

// ---- 7) Quick 2025 payroll join health ----
const csv2024 = Papa.parse(
  fs.readFileSync('public/data/SAPD ROSTER 202403.csv', 'utf8'),
  { header: true, skipEmptyLines: true }
).data;
const csv2025 = Papa.parse(
  fs.readFileSync('public/data/NSP_SAPD_2025_PAYROLL - SAPD_2025_PAYROLL.csv', 'utf8'),
  { header: true, skipEmptyLines: true }
).data;
const by2024 = new Map();
for (const r of csv2024) {
  const k = norm(r['Last Name']) + '|' + stripMiddle(r['First Name']);
  if (!by2024.has(k)) by2024.set(k, []);
  by2024.get(k).push(r);
}
let matched = 0, unmatched = 0, ambiguous = 0;
for (const r of csv2025) {
  const k = norm(r['Last Name']) + '|' + stripMiddle(r['First Name']);
  const hits = by2024.get(k);
  if (!hits) unmatched++;
  else if (hits.length > 1) ambiguous++;
  else matched++;
}
console.log('');
console.log('=== 2025 PAYROLL JOIN (using middle-strip key) ===');
console.log('2025 rows: ' + csv2025.length);
console.log('  - 1:1 match in 2024: ' + matched);
console.log('  - Ambiguous (multiple 2024 candidates): ' + ambiguous);
console.log('  - Unmatched (would be new personnel): ' + unmatched);

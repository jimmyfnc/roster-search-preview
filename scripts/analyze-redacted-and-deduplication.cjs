// Follow-up analysis:
//  (a) find redacted rows in the 2026 XLSX
//  (b) inspect the 2025 payroll "Note" column for redaction markers
//  (c) sketch the "latest record per person" deduplication scope
const fs = require('fs');
const os = require('os');
const path = require('path');
const Papa = require('papaparse');

const TMP = path.join(os.tmpdir(), 'nsp_xlsx_inspect');

const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const stripMiddle = s => norm(s).replace(/\s+[a-z]\.?$/, '');

// ---- Reload XLSX rows ----
const sheetXml = fs.readFileSync(path.join(TMP, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
const sstXml = fs.readFileSync(path.join(TMP, 'xl', 'sharedStrings.xml'), 'utf8');
const sst = [...sstXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map(m =>
  [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
);
function cellsOfRow(rowXml) {
  const cells = [...rowXml.matchAll(/<c r="([A-Z]+\d+)"(?:\s+s="[^"]*")?(?:\s+t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)];
  const out = {};
  for (const c of cells) {
    const ref = c[1], t = c[2], inner = c[3];
    const col = ref.replace(/\d+/, '');
    let val = '';
    const vm = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
    if (vm) val = t === 's' ? (sst[parseInt(vm[1], 10)] || '') : vm[1];
    else {
      const im = inner.match(/<is>([\s\S]*?)<\/is>/);
      if (im) { const tm = im[1].match(/<t[^>]*>([\s\S]*?)<\/t>/); if (tm) val = tm[1]; }
    }
    out[col] = val;
  }
  return out;
}
const rowMatches = [...sheetXml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
const headers = cellsOfRow(rowMatches[0][2]);
const colOf = name => {
  for (const [k, v] of Object.entries(headers)) {
    if ((v || '').toLowerCase().trim() === name.toLowerCase()) return k;
  }
  return null;
};
const lnC = colOf('Last Name'), fnC = colOf('First Name'), bC = colOf('Badge #');

const xlsxRows = [];
for (let i = 1; i < rowMatches.length; i++) {
  const cells = cellsOfRow(rowMatches[i][2]);
  let badge = cells[bC] || '';
  if (/^\d+\.0+$/.test(badge)) badge = badge.split('.')[0];
  const row = {
    rowNumber: parseInt(rowMatches[i][1], 10),
    last: cells[lnC] || '',
    first: cells[fnC] || '',
    badge,
    division: cells[colOf('Division')] || '',
    rankTitle: cells[colOf('RankTitle')] || '',
    gender: cells[colOf('Gender')] || '',
    ethnicity: cells[colOf('Ethnicity')] || '',
    height: cells[colOf('Height')] || '',
    weight: cells[colOf('Weight')] || '',
    yearOfHire: cells[colOf('Year of Hire')] || '',
  };
  if (!row.last && !row.first && !row.badge) continue;
  xlsxRows.push(row);
}
console.log('=== XLSX TOTAL DATA ROWS ===');
console.log('Rows: ' + xlsxRows.length);

// ---- (a) Redaction detection in XLSX ----
const isRedactedField = v => /^X+$/i.test((v || '').replace(/\s+/g, '')) || /redact/i.test(v);
const redactedXlsx = xlsxRows.filter(r =>
  isRedactedField(r.last) || isRedactedField(r.first) || isRedactedField(r.badge)
);
console.log('');
console.log('=== REDACTED ROWS IN XLSX ===');
console.log('Count: ' + redactedXlsx.length);
console.log('First 3 redacted XLSX rows:');
redactedXlsx.slice(0, 3).forEach(r => {
  console.log('  row ' + r.rowNumber + ': ' + JSON.stringify(r));
});
console.log('Last 3 redacted XLSX rows:');
redactedXlsx.slice(-3).forEach(r => {
  console.log('  row ' + r.rowNumber + ': ' + JSON.stringify(r));
});

// ---- (b) 2025 payroll CSV inspection ----
const csv2025 = Papa.parse(
  fs.readFileSync('public/data/NSP_SAPD_2025_PAYROLL - SAPD_2025_PAYROLL.csv', 'utf8'),
  { header: true, skipEmptyLines: true }
).data;

const withNote = csv2025.filter(r => (r['Note'] || '').trim());
console.log('');
console.log('=== 2025 CSV NOTE COLUMN ===');
console.log('Total 2025 rows: ' + csv2025.length);
console.log('Rows with non-empty Note: ' + withNote.length);
console.log('Distinct Note values:');
const noteCounts = {};
for (const r of withNote) {
  const n = (r['Note'] || '').trim();
  noteCounts[n] = (noteCounts[n] || 0) + 1;
}
for (const [n, c] of Object.entries(noteCounts)) {
  console.log('  "' + n + '" (' + c + ')');
}
console.log('Sample noted rows:');
withNote.slice(0, 5).forEach(r => console.log('  ' + r['Last Name'] + ', ' + r['First Name'] + ' | Note: "' + r['Note'] + '"'));

// ---- (c) The 75 unmatched 2025: do their names appear among redacted XLSX? ----
// We can't match by name to redacted XLSX (which have no name). But we can check:
// Are the 75 unmatched 2025 personnel all noted in the Note column as redacted?
const csv2024 = Papa.parse(
  fs.readFileSync('public/data/SAPD ROSTER 202403.csv', 'utf8'),
  { header: true, skipEmptyLines: true }
).data;
const by2024 = new Set();
for (const r of csv2024) by2024.add(norm(r['Last Name']) + '|' + stripMiddle(r['First Name']));

const unmatched2025 = csv2025.filter(r => !by2024.has(norm(r['Last Name']) + '|' + stripMiddle(r['First Name'])));
console.log('');
console.log('=== 75 UNMATCHED 2025 ROWS ===');
console.log('Count: ' + unmatched2025.length);
const unmatchedNoted = unmatched2025.filter(r => (r['Note'] || '').trim());
console.log('Of those, with non-empty Note: ' + unmatchedNoted.length);
const matched2025 = csv2025.filter(r => by2024.has(norm(r['Last Name']) + '|' + stripMiddle(r['First Name'])));
const matchedNoted = matched2025.filter(r => (r['Note'] || '').trim());
console.log('Of the 261 matched, with non-empty Note: ' + matchedNoted.length);
console.log('First 5 unmatched + their Note:');
unmatched2025.slice(0, 5).forEach(r => console.log('  ' + r['Last Name'] + ', ' + r['First Name'] + ' | Note: "' + (r['Note'] || '') + '"'));

// ---- (d) XLSX vs 2025 payroll cross-check ----
const xlsxKey = r => norm(r.last) + '|' + stripMiddle(r.first);
const xlsxNames = new Set(xlsxRows.filter(r => !isRedactedField(r.last) && !isRedactedField(r.first)).map(xlsxKey));
let unmatchedAlsoInXlsx = 0, unmatchedNotInXlsx = 0;
const samplesInXlsx = [], samplesNotInXlsx = [];
for (const r of unmatched2025) {
  const k = norm(r['Last Name']) + '|' + stripMiddle(r['First Name']);
  if (xlsxNames.has(k)) {
    unmatchedAlsoInXlsx++;
    if (samplesInXlsx.length < 5) samplesInXlsx.push(r['Last Name'] + ', ' + r['First Name']);
  } else {
    unmatchedNotInXlsx++;
    if (samplesNotInXlsx.length < 5) samplesNotInXlsx.push(r['Last Name'] + ', ' + r['First Name']);
  }
}
console.log('');
console.log('=== UNMATCHED-IN-2024 BUT PRESENT IN 2026 XLSX? ===');
console.log('Of the 75 unmatched (no 2024 row), how many ARE in the 2026 XLSX by name?');
console.log('  Present in XLSX: ' + unmatchedAlsoInXlsx + ' (these are NEW hires, in 2025 + 2026)');
console.log('  NOT in XLSX:    ' + unmatchedNotInXlsx + ' (possibly redacted in XLSX, or 2025-only)');
console.log('Samples present in XLSX: ' + samplesInXlsx.join(' | '));
console.log('Samples NOT in XLSX:     ' + samplesNotInXlsx.join(' | '));

// ---- (e) Universe of distinct personnel across 2024/2025/2026 ----
const allKeys = new Set();
for (const r of csv2024) allKeys.add(norm(r['Last Name']) + '|' + stripMiddle(r['First Name']));
for (const r of csv2025) allKeys.add(norm(r['Last Name']) + '|' + stripMiddle(r['First Name']));
for (const r of xlsxRows) {
  if (!isRedactedField(r.last) && !isRedactedField(r.first)) {
    allKeys.add(norm(r.last) + '|' + stripMiddle(r.first));
  }
}
console.log('');
console.log('=== DISTINCT PERSONNEL UNIVERSE (by name across all three sources) ===');
console.log('Total distinct names: ' + allKeys.size);
console.log('(Plus ' + redactedXlsx.length + ' redacted XLSX rows we cannot name-match)');

// ---- (f) Latest-record-per-person preview ----
// Strategy: for each distinct name, pick latest source they appear in:
//   2026 (XLSX) > 2025 (payroll) > 2024 (roster)
let pickedFrom = { '2026': 0, '2025': 0, '2024': 0 };
for (const key of allKeys) {
  const inXlsx = xlsxRows.some(r => !isRedactedField(r.last) && !isRedactedField(r.first) && norm(r.last) + '|' + stripMiddle(r.first) === key);
  if (inXlsx) { pickedFrom['2026']++; continue; }
  const in2025 = csv2025.some(r => norm(r['Last Name']) + '|' + stripMiddle(r['First Name']) === key);
  if (in2025) { pickedFrom['2025']++; continue; }
  pickedFrom['2024']++;
}
console.log('');
console.log('=== "LATEST RECORD PER PERSON" PREVIEW (named only) ===');
console.log('If we tag the latest source per person as is_current=true:');
console.log('  From 2026 (XLSX):    ' + pickedFrom['2026']);
console.log('  From 2025 (payroll): ' + pickedFrom['2025']);
console.log('  From 2024 (roster):  ' + pickedFrom['2024']);
console.log('  + Redacted 2026 XLSX rows kept as current (un-named): ' + redactedXlsx.length);
console.log('  Total is_current=true rows under new model: ' + (pickedFrom['2026'] + pickedFrom['2025'] + pickedFrom['2024'] + redactedXlsx.length));

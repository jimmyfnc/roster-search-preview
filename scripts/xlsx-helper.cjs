// Shared XLSX helpers for the 2025/2026 migration scripts.
// XLSX is a zip; we extract via adm-zip (cross-platform) and parse the XML by hand
// to avoid a heavy XLSX parser dependency.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function ensureExtracted(xlsxPath, extractDir) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error('XLSX not found: ' + xlsxPath);
  }
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });
  new AdmZip(xlsxPath).extractAllTo(extractDir, /* overwrite */ true);
}

function readSharedStrings(extractDir) {
  const sstPath = path.join(extractDir, 'xl', 'sharedStrings.xml');
  if (!fs.existsSync(sstPath)) return [];
  const xml = fs.readFileSync(sstPath, 'utf8');
  return [...xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map(m =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
  );
}

function cellsOfRow(rowXml, sst) {
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

function normalizeBadge(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Excel serializes integers as floats: "3678.0" -> "3678".
  if (/^\d+\.0+$/.test(trimmed)) return trimmed.split('.')[0];
  if (/^X+$/i.test(trimmed)) return null;
  return trimmed;
}

// Excel sometimes serializes "65" as "65.0" or "67.5"; we coerce only when the value is clearly a clean integer.
function normalizeInt(raw) {
  if (raw == null || raw === '') return null;
  const num = parseFloat(String(raw).replace(/,/g, ''));
  if (isNaN(num)) return null;
  return Math.round(num);
}

function normalizeHeight(raw) {
  if (raw == null || raw === '') return null;
  // The XLSX stores height as "601.0" meaning 6'01". Keep as text since the existing schema uses TEXT.
  // Strip trailing .0 for cleanliness.
  let v = String(raw).trim();
  if (/^\d+\.0+$/.test(v)) v = v.split('.')[0];
  return v || null;
}

function readSheet(extractDir, sheetName = 'sheet1.xml') {
  const sst = readSharedStrings(extractDir);
  const sheetXml = fs.readFileSync(path.join(extractDir, 'xl', 'worksheets', sheetName), 'utf8');
  const rowMatches = [...sheetXml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  const headerCells = cellsOfRow(rowMatches[0][2], sst);

  const colOf = name => {
    for (const [k, v] of Object.entries(headerCells)) {
      if ((v || '').toLowerCase().trim() === name.toLowerCase()) return k;
    }
    return null;
  };

  const cols = {
    last: colOf('Last Name'),
    first: colOf('First Name'),
    badge: colOf('Badge #') || colOf('Badge#') || colOf('Badge'),
    division: colOf('Division'),
    gender: colOf('Gender'),
    ethnicity: colOf('Ethnicity'),
    height: colOf('Height'),
    weight: colOf('Weight'),
    rankTitle: colOf('RankTitle') || colOf('Rank Title') || colOf('Rank'),
    yearOfHire: colOf('Year of Hire'),
  };

  const isRedactedToken = s => /^X+$/i.test((s || '').replace(/\s+/g, ''));

  const rows = [];
  for (let i = 1; i < rowMatches.length; i++) {
    const rowNumber = parseInt(rowMatches[i][1], 10);
    const cells = cellsOfRow(rowMatches[i][2], sst);
    const last = cells[cols.last] || '';
    const first = cells[cols.first] || '';
    const rawBadge = cells[cols.badge] || '';
    if (!last && !first && !rawBadge) continue;

    const rawRank = cells[cols.rankTitle] || null;
    const rankTitle = rawRank && isRedactedToken(rawRank) ? null : rawRank;

    rows.push({
      rowNumber,
      last,
      first,
      badge: normalizeBadge(rawBadge),
      rawBadge,
      division: cells[cols.division] || null,
      gender: cells[cols.gender] || null,
      ethnicity: cells[cols.ethnicity] || null,
      height: normalizeHeight(cells[cols.height]),
      weight: normalizeInt(cells[cols.weight]),
      rankTitle,
      yearOfHire: normalizeInt(cells[cols.yearOfHire]),
      isRedacted:
        isRedactedToken(last) || isRedactedToken(first) || isRedactedToken(rawBadge),
    });
  }

  return { rows, cols };
}

function readImageAnchors(extractDir) {
  const drawingPath = path.join(extractDir, 'xl', 'drawings', 'drawing1.xml');
  const relsPath = path.join(extractDir, 'xl', 'drawings', '_rels', 'drawing1.xml.rels');
  const drawing = fs.readFileSync(drawingPath, 'utf8');
  const rels = fs.readFileSync(relsPath, 'utf8');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[m[1]] = m[2];
  }
  const anchors = [
    ...drawing.matchAll(
      /<xdr:(twoCellAnchor|oneCellAnchor)[\s\S]*?<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<a:blip[^>]*r:embed="([^"]+)"/g
    ),
  ];

  // Guard against zip-slip: any image target whose resolved path escapes extractDir is rejected.
  const safeRoot = path.resolve(extractDir);
  const out = [];
  for (const a of anchors) {
    const target = relMap[a[3]] || '';
    // Target looks like "../media/image1.png" relative to xl/drawings/.
    const filePath = path.resolve(path.join(extractDir, 'xl', 'drawings', target));
    if (!filePath.startsWith(safeRoot + path.sep) && filePath !== safeRoot) {
      throw new Error('Zip-slip rejected for drawing target: ' + target);
    }
    out.push({ row: parseInt(a[2], 10) + 1, file: filePath });
  }
  return out;
}

module.exports = { ensureExtracted, readSheet, readImageAnchors };

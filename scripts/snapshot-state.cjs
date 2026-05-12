// One-off DB state snapshot. Safe to run anytime.
require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
if (!url) { console.error('No DB URL'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log('=== STATE SNAPSHOT ===');
  const cols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='personnel' ORDER BY ordinal_position"
  );
  console.log('Columns (' + cols.rows.length + '):');
  for (const c of cols.rows) console.log('  ' + c.column_name + ' (' + c.data_type + ')');

  const colNames = cols.rows.map(r => r.column_name);
  const hasYear = colNames.includes('roster_year');
  const hasCurrent = colNames.includes('is_current');
  const hasRank = colNames.includes('rank_title');

  const total = await pool.query('SELECT COUNT(*)::int AS c FROM personnel');
  console.log('\nTotal personnel rows: ' + total.rows[0].c);

  if (hasYear && hasCurrent) {
    const counts = await pool.query(
      'SELECT roster_year, is_current, COUNT(*)::int AS c FROM personnel GROUP BY roster_year, is_current ORDER BY roster_year NULLS FIRST, is_current'
    );
    console.log('By roster_year/is_current:');
    for (const row of counts.rows) {
      console.log('  roster_year=' + row.roster_year + ', is_current=' + row.is_current + ': ' + row.c);
    }
  } else {
    console.log('roster_year column present: ' + hasYear);
    console.log('is_current column present:  ' + hasCurrent);
  }
  console.log('rank_title column present:  ' + hasRank);

  // Tables list
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
  );
  console.log('\nAll tables: ' + tables.rows.map(r => r.table_name).join(', '));

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

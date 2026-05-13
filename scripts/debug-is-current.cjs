// Diagnose the is_current discrepancy seen via /api/personnel/all.
require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
if (!url) { console.error('No DB URL in env'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const c1 = await pool.query("SELECT COUNT(*)::int AS c FROM personnel WHERE is_current = true");
  console.log('Direct SQL: is_current=true count = ' + c1.rows[0].c);
  const c2 = await pool.query("SELECT COUNT(*)::int AS c FROM personnel");
  console.log('Direct SQL: total count = ' + c2.rows[0].c);
  const c3 = await pool.query("SELECT COUNT(*)::int AS c FROM personnel WHERE is_current IS NULL");
  console.log('Direct SQL: is_current IS NULL count = ' + c3.rows[0].c);

  const all = await pool.query(`
    SELECT roster_year, is_current, COUNT(*)::int AS c
    FROM personnel GROUP BY roster_year, is_current ORDER BY roster_year, is_current
  `);
  console.log('\nBy year/current:');
  for (const r of all.rows) console.log('  year=' + r.roster_year + ', is_current=' + r.is_current + ': ' + r.c);

  // Achutegui specifically
  const a = await pool.query(`
    SELECT id, last_name, first_name, badge_number, roster_year, is_current,
           gender, rank_title
    FROM personnel WHERE last_name = 'Achutegui'
    ORDER BY roster_year
  `);
  console.log('\nAchutegui records:');
  for (const r of a.rows) console.log('  year=' + r.roster_year + ', current=' + r.is_current + ', badge=' + r.badge_number + ', gender=' + r.gender + ', rank=' + r.rank_title);

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

// Executes scripts/rollback-2025-2026.sql against the configured DB.
// Reports pre/post counts. One transaction.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
if (!url) { console.error('No DB URL'); process.exit(1); }

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const SQL_PATH = path.join(__dirname, 'rollback-2025-2026.sql');

(async () => {
  const pre = await pool.query("SELECT COUNT(*)::int AS c FROM personnel");
  console.log('Pre-rollback row count: ' + pre.rows[0].c);

  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  console.log('Executing rollback...');
  await pool.query(sql);

  const post = await pool.query("SELECT COUNT(*)::int AS c FROM personnel");
  console.log('Post-rollback row count: ' + post.rows[0].c);

  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='personnel' ORDER BY ordinal_position"
  );
  console.log('Columns (' + cols.rows.length + '): ' + cols.rows.map(r => r.column_name).join(', '));

  await pool.end();
  console.log('Rollback complete.');
})().catch(async e => {
  console.error('ROLLBACK FAILED:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});

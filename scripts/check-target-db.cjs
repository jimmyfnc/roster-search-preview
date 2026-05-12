// Confirms which DB we're pointed at before running a migration.
// Prints the host and a row count — no writes. Run this FIRST.
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
if (!url) { console.error('No DATABASE_URL in env'); process.exit(1); }

const host = (url.split('@')[1] || '').split('/')[0];
console.log('DB host: ' + host);

const isNeon = /neon\.tech/i.test(host);
const isRailway = /rlwy\.net|railway\.internal/i.test(host);
console.log('Provider: ' + (isNeon ? 'Neon (preview)' : isRailway ? 'Railway (PRODUCTION)' : 'unknown'));

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await pool.query('SELECT COUNT(*)::int AS c FROM personnel');
  console.log('personnel rows: ' + c.rows[0].c);
  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

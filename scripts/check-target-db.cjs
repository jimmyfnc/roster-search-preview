// Confirms which DB we're pointed at before running a migration.
// Prints the host and a row count — no writes. Run this FIRST.
//
// The label specifically distinguishes Neon Dev (safe iteration) from Neon Prod
// (whose changes are immediately visible on the deployed Vercel preview at
// `*-jimmyfncs-projects.vercel.app`). See CLAUDE.md "Environments" for context.
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
if (!url) { console.error('No DATABASE_URL in env'); process.exit(1); }

const host = (url.split('@')[1] || '').split('/')[0];
console.log('DB host: ' + host);

const isNeonProd = /ep-autumn-pine/i.test(host);
const isNeonDev = /ep-mute-queen/i.test(host);
const isNeon = /neon\.tech/i.test(host);
const isRailway = /rlwy\.net|railway\.internal/i.test(host);

let provider;
if (isNeonProd) provider = 'Neon (preview PROD branch — affects deployed Vercel preview)';
else if (isNeonDev) provider = 'Neon (preview DEV branch — safe iteration)';
else if (isNeon) provider = 'Neon (unknown branch — INVESTIGATE before writing)';
else if (isRailway) provider = 'Railway (PRODUCTION live site)';
else provider = 'unknown';

console.log('Provider: ' + provider);

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await pool.query('SELECT COUNT(*)::int AS c FROM personnel');
  console.log('personnel rows: ' + c.rows[0].c);
  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

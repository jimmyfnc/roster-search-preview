// One-off patch: NULL out payroll_year on records that have it stamped but
// no actual payroll values (all six payroll columns are NULL). Those records
// were misleading: "Payroll data is current as of 2024." with nothing below.
require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const host = (url.split('@')[1] || '').split('/')[0];
  console.log('DB host: ' + host);

  const preview = await pool.query(`
    SELECT roster_year, COUNT(*)::int AS c
    FROM personnel
    WHERE payroll_year IS NOT NULL
      AND regular_pay IS NULL
      AND premiums IS NULL
      AND overtime IS NULL
      AND payout IS NULL
      AND other_pay IS NULL
      AND health_dental_vision IS NULL
    GROUP BY roster_year ORDER BY roster_year
  `);
  console.log('Records that will be patched (payroll_year set, all 6 payroll fields null):');
  let total = 0;
  for (const r of preview.rows) {
    console.log('  roster_year=' + r.roster_year + ': ' + r.c);
    total += r.c;
  }
  console.log('Total: ' + total);

  if (total === 0) {
    console.log('Nothing to patch.');
    await pool.end();
    return;
  }

  const res = await pool.query(`
    UPDATE personnel
       SET payroll_year = NULL
     WHERE payroll_year IS NOT NULL
       AND regular_pay IS NULL
       AND premiums IS NULL
       AND overtime IS NULL
       AND payout IS NULL
       AND other_pay IS NULL
       AND health_dental_vision IS NULL
  `);
  console.log('\nUPDATE affected ' + res.rowCount + ' rows.');

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

// Shows how payroll_year is distributed across is_current=true records,
// cross-tabbed with roster_year, so you can see exactly what each record category shows.
require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const host = (url.split('@')[1] || '').split('/')[0];
  console.log('DB host: ' + host);
  console.log('');

  // Cross-tab: roster_year x payroll_year x has-payroll for is_current=true rows
  const r = await pool.query(`
    SELECT
      roster_year,
      payroll_year,
      CASE WHEN regular_pay IS NOT NULL OR premiums IS NOT NULL OR overtime IS NOT NULL OR payout IS NOT NULL OR other_pay IS NOT NULL
           THEN 'has payroll' ELSE 'no payroll' END AS payroll_status,
      CASE WHEN last_name LIKE 'XXXX%' THEN 'yes' ELSE 'no' END AS redacted,
      COUNT(*)::int AS count
    FROM personnel
    WHERE is_current = true
    GROUP BY roster_year, payroll_year, payroll_status, redacted
    ORDER BY roster_year, payroll_year NULLS LAST, redacted
  `);
  console.log('=== is_current=true records, grouped ===');
  console.log('roster_year | payroll_year | payroll | redacted | count');
  console.log('------------|--------------|---------|----------|------');
  for (const row of r.rows) {
    console.log(
      String(row.roster_year).padEnd(11) + ' | ' +
      String(row.payroll_year || '-').padEnd(12) + ' | ' +
      row.payroll_status.padEnd(7) + ' | ' +
      row.redacted.padEnd(8) + ' | ' +
      row.count
    );
  }

  // Simple totals to compare with disclaimer text
  const t = await pool.query(`
    SELECT
      CASE
        WHEN payroll_year = 2025 THEN 'Payroll data is current as of 2025.'
        WHEN payroll_year = 2024 THEN 'Payroll data is current as of 2024.'
        ELSE 'No payroll data available for this record.'
      END AS disclaimer,
      COUNT(*)::int AS count
    FROM personnel
    WHERE is_current = true
    GROUP BY disclaimer
    ORDER BY count DESC
  `);
  console.log('');
  console.log('=== What each current record\'s disclaimer says ===');
  for (const row of t.rows) {
    console.log('  ' + row.count + ' records: "' + row.disclaimer + '"');
  }

  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

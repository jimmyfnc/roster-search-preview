require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || process.env.VITE_DATABASE_URL;
if (!url) { console.error('No DB URL in env'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await pool.query(`
    SELECT id, last_name, first_name, badge_number, roster_year, is_current,
           payroll_year, regular_pay, premiums, overtime, payout, other_pay, health_dental_vision
    FROM personnel WHERE last_name = 'Achutegui' ORDER BY roster_year DESC
  `);
  for (const row of r.rows) {
    console.log(JSON.stringify(row, null, 2));
  }
  await pool.end();
})();

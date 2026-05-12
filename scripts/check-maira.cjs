require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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

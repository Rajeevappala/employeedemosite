require('dotenv').config();
const pool = require('../Backend/config/database');

async function inspectSchema() {
  const tables = ['employees', 'attendance', 'leave_requests', 'payroll_records', 'documents'];
  for (const table of tables) {
    try {
      const res = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      console.log(`\nTABLE: public.${table}`);
      console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
      
      const sample = await pool.query(`SELECT * FROM public.${table} LIMIT 2`);
      console.log(`SAMPLE ROW:`, sample.rows[0]);
    } catch (err) {
      console.error(`Error inspecting ${table}:`, err.message);
    }
  }
  await pool.end();
}

inspectSchema();

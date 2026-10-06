const path = require('path');
require('../Backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../Backend/.env') });
const pool = require('../Backend/config/database');

async function main() {
  try {
    const docs = await pool.query(
      "SELECT id, employee_id, document_type, file_name, storage_key, month, year, created_at FROM public.documents WHERE document_type = 'Payslip'"
    );
    console.log('PAYSLIP DOCUMENTS COUNT:', docs.rowCount);
    console.log('PAYSLIP DOCUMENTS:', JSON.stringify(docs.rows, null, 2));

    const pr = await pool.query("SELECT * FROM public.payroll_records LIMIT 5");
    console.log('PAYROLL RECORDS COUNT:', pr.rowCount);
    console.log('SAMPLE PAYROLL RECORDS:', JSON.stringify(pr.rows, null, 2));

    const emps = await pool.query("SELECT employee_id, first_name, last_name, email, role FROM public.employees LIMIT 5");
    console.log('EMPLOYEES:', JSON.stringify(emps.rows, null, 2));
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await pool.end();
  }
}

main();

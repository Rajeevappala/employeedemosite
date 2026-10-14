require('dotenv').config();
const pool = require('../../config/database');

async function migrate() {
  console.log('Running migration: Add PF contribution columns to public.pf_details...');
  try {
    await pool.query(`
      ALTER TABLE public.pf_details 
      ADD COLUMN IF NOT EXISTS employee_contribution NUMERIC(12, 2);
    `);
    console.log('  -> Added column: employee_contribution NUMERIC(12, 2)');

    await pool.query(`
      ALTER TABLE public.pf_details 
      ADD COLUMN IF NOT EXISTS employer_contribution NUMERIC(12, 2);
    `);
    console.log('  -> Added column: employer_contribution NUMERIC(12, 2)');

    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'pf_details' 
      ORDER BY ordinal_position
    `);
    console.log('Updated pf_details columns:');
    console.table(result.rows);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

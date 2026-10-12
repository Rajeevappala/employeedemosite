const path = require('path');
require('dotenv').config();
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = require('../config/database');

async function migrateBankDetails() {
  console.log('--- RUNNING EMPLOYEE BANK DETAILS DATABASE MIGRATION ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create employee_bank_details table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.employee_bank_details (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id VARCHAR(20) UNIQUE NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
        account_holder_name VARCHAR(255) NOT NULL,
        bank_name VARCHAR(100) NOT NULL,
        account_number_encrypted TEXT NOT NULL,
        account_number_last4 VARCHAR(4) NOT NULL,
        ifsc_code VARCHAR(20) NOT NULL,
        branch_name VARCHAR(150),
        branch_city VARCHAR(100),
        branch_state VARCHAR(100),
        account_type VARCHAR(50) NOT NULL DEFAULT 'Savings',
        verification_status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (verification_status IN ('Pending', 'Verified', 'Rejected')),
        admin_remarks TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
      );
    `);

    // Create index on employee_id
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_bank_details_employee_id 
      ON public.employee_bank_details(employee_id);
    `);

    // Create index on verification_status
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_bank_details_verification_status 
      ON public.employee_bank_details(verification_status);
    `);

    await client.query('COMMIT');
    console.log('✅ Employee bank details table created successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Bank details migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrateBankDetails();
}

module.exports = migrateBankDetails;

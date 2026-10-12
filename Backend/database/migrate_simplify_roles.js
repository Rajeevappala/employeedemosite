const pool = require('../config/database');

/**
 * Migration: Simplify Roles to ADMIN and EMPLOYEE.
 * - Converts all SUPER_ADMIN accounts to ADMIN.
 * - Updates users_role_check constraint to strictly ('EMPLOYEE', 'ADMIN').
 * - Creates statutory_payroll_archive table for legal compliance.
 */
async function migrateSimplifyRoles() {
  const client = await pool.connect();
  try {
    console.log('--- STARTING ROLE SIMPLIFICATION MIGRATION ---');
    await client.query('BEGIN');

    // 1. Convert all existing SUPER_ADMIN accounts to ADMIN
    const updateRes = await client.query(`
      UPDATE public.users
      SET role = 'ADMIN', status = 'ACTIVE', updated_at = NOW()
      WHERE role = 'SUPER_ADMIN'
      RETURNING id, email, role, status
    `);
    console.log(`Updated ${updateRes.rowCount} SUPER_ADMIN account(s) to ADMIN:`);
    updateRes.rows.forEach(r => console.log(`  - ${r.email} -> Role: ${r.role}, Status: ${r.status}`));

    // 2. Drop legacy role check constraint if exists
    await client.query(`
      ALTER TABLE public.users
      DROP CONSTRAINT IF EXISTS users_role_check
    `);
    console.log('Dropped legacy users_role_check constraint.');

    // 3. Add strict constraint allowing ONLY ('EMPLOYEE', 'ADMIN')
    await client.query(`
      ALTER TABLE public.users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('EMPLOYEE', 'ADMIN'))
    `);
    console.log('Added strict users_role_check constraint CHECK (role IN (\'EMPLOYEE\', \'ADMIN\')).');

    // 4. Create statutory_payroll_archive table for legal compliance
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.statutory_payroll_archive (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        original_payroll_id UUID,
        employee_id VARCHAR(50),
        month VARCHAR(20),
        year INTEGER,
        basic_salary NUMERIC(12, 2),
        hra NUMERIC(12, 2),
        allowances NUMERIC(12, 2),
        gross_salary NUMERIC(12, 2),
        pf_employee NUMERIC(12, 2),
        professional_tax NUMERIC(12, 2),
        other_deductions NUMERIC(12, 2),
        total_deductions NUMERIC(12, 2),
        net_salary NUMERIC(12, 2),
        processed_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '8 years')
      )
    `);
    console.log('Created statutory_payroll_archive table (8-year retention policy).');

    await client.query('COMMIT');
    console.log('✅ Migration committed successfully.');

    // 5. Verification query
    const admins = await client.query(`
      SELECT id, email, role, status FROM public.users WHERE role = 'ADMIN' ORDER BY email
    `);
    console.log('--- ALL CURRENT ACTIVE ADMINS ---');
    console.table(admins.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrateSimplifyRoles()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateSimplifyRoles;

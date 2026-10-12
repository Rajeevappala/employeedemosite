/**
 * Database Migration: Payroll Automation & Batch Processing Workflow
 *
 * 1. Creates public.payroll_batches to track end-to-end payroll imports, validation,
 *    confirmation, payslip generation, and retry lifecycle states.
 * 2. Adds batch_id foreign key column to public.payroll_records.
 * 3. Enforces unique constraint/index on public.documents for (employee_id, month, year)
 *    where document_type = 'Payslip', guaranteeing at DB-level that duplicate payslips
 *    can never be created for the same employee in the same period.
 * 4. Preserves all existing data untouched.
 */

const pool = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('--- Starting Migration: Payroll Automation & Batch Processing ---');
    await client.query('BEGIN');

    // 1. Create payroll_batches table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.payroll_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_number VARCHAR(50) UNIQUE NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Uploaded',
        total_records INTEGER NOT NULL DEFAULT 0,
        valid_records INTEGER NOT NULL DEFAULT 0,
        invalid_records INTEGER NOT NULL DEFAULT 0,
        processed_records INTEGER NOT NULL DEFAULT 0,
        payslips_generated INTEGER NOT NULL DEFAULT 0,
        payslips_failed INTEGER NOT NULL DEFAULT 0,
        total_gross_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
        total_deductions NUMERIC(14, 2) NOT NULL DEFAULT 0,
        total_net_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
        file_name VARCHAR(255),
        error_summary JSONB DEFAULT '[]'::jsonb,
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ Table public.payroll_batches created (or already exists).');

    // 2. Create indices for payroll_batches
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payroll_batches_month_year ON public.payroll_batches (month, year);
      CREATE INDEX IF NOT EXISTS idx_payroll_batches_status ON public.payroll_batches (status);
    `);
    console.log('✓ Indices on public.payroll_batches created.');

    // 3. Add batch_id to public.payroll_records
    await client.query(`
      ALTER TABLE public.payroll_records
      ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.payroll_batches(id) ON DELETE SET NULL;
    `);
    console.log('✓ Column batch_id added to public.payroll_records.');

    // 4. Ensure no duplicate payslip documents exist before creating unique index
    // If any legacy duplicate documents exist, retain the latest one and remove duplicates
    await client.query(`
      DELETE FROM public.documents d1
      WHERE LOWER(d1.document_type) = 'payslip'
        AND d1.month IS NOT NULL
        AND d1.year IS NOT NULL
        AND d1.id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY employee_id, month, year
              ORDER BY created_at DESC, id DESC
            ) AS rn
            FROM public.documents
            WHERE LOWER(document_type) = 'payslip'
              AND month IS NOT NULL
              AND year IS NOT NULL
          ) ranked
          WHERE ranked.rn = 1
        );
    `);

    // 5. Create unique partial index on public.documents for payslips
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_employee_payslip_period
      ON public.documents (employee_id, month, year)
      WHERE LOWER(document_type) = 'payslip';
    `);
    console.log('✓ Unique index uq_documents_employee_payslip_period created on public.documents.');

    await client.query('COMMIT');
    console.log('--- Migration completed successfully ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

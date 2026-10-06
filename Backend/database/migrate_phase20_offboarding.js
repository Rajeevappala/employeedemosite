require('dotenv').config();
const pool = require('../config/database');

async function migrate() {
  console.log('--- STARTING PHASE 20 OFFBOARDING MIGRATION ---');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Create exit_requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.exit_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id VARCHAR(20) NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
        resignation_date DATE NOT NULL DEFAULT CURRENT_DATE,
        requested_relieving_date DATE NOT NULL,
        approved_relieving_date DATE,
        reason TEXT NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED' 
          CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED')),
        admin_remarks TEXT,
        reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Created table: exit_requests');

    // 2. Create partial unique index on exit_requests to prevent multiple active requests
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_exit_requests_employee_id ON public.exit_requests(employee_id);
      CREATE INDEX IF NOT EXISTS idx_exit_requests_status ON public.exit_requests(status);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_exit_request ON public.exit_requests(employee_id)
        WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED');
    `);
    console.log('✅ Created indexes and unique constraint for exit_requests');

    // 3. Create exit_clearances table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.exit_clearances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exit_request_id UUID NOT NULL REFERENCES public.exit_requests(id) ON DELETE CASCADE,
        department VARCHAR(50) NOT NULL 
          CHECK (department IN ('IT', 'FINANCE', 'HR', 'DEPARTMENT_HEAD')),
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING' 
          CHECK (status IN ('PENDING', 'CLEARED', 'REJECTED', 'WAIVED')),
        remarks TEXT,
        cleared_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        cleared_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_exit_clearance_request_dept UNIQUE (exit_request_id, department)
      );
    `);
    console.log('✅ Created table: exit_clearances');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_exit_clearances_request_id ON public.exit_clearances(exit_request_id);
      CREATE INDEX IF NOT EXISTS idx_exit_clearances_status ON public.exit_clearances(status);
    `);
    console.log('✅ Created indexes for exit_clearances');

    // 4. Create fnf_settlements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.fnf_settlements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exit_request_id UUID UNIQUE NOT NULL REFERENCES public.exit_requests(id) ON DELETE CASCADE,
        employee_id VARCHAR(20) NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
        working_days NUMERIC(6, 2) NOT NULL DEFAULT 30,
        payable_days NUMERIC(6, 2) NOT NULL DEFAULT 0,
        prorated_salary NUMERIC(12, 2) NOT NULL DEFAULT 0,
        encashed_leave_days NUMERIC(6, 2) NOT NULL DEFAULT 0,
        leave_encashment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        gratuity_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        bonus_or_incentive NUMERIC(12, 2) NOT NULL DEFAULT 0,
        notice_period_recovery NUMERIC(12, 2) NOT NULL DEFAULT 0,
        other_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total_earnings NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
        net_payable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        settlement_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
        relieving_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
        experience_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' 
          CHECK (status IN ('DRAFT', 'FINALIZED')),
        finalized_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        finalized_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Created table: fnf_settlements');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fnf_settlements_employee_id ON public.fnf_settlements(employee_id);
      CREATE INDEX IF NOT EXISTS idx_fnf_settlements_status ON public.fnf_settlements(status);
    `);
    console.log('✅ Created indexes for fnf_settlements');

    await client.query('COMMIT');
    console.log('--- PHASE 20 MIGRATION COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Phase 20 Migration Failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch(() => process.exit(1));
}

module.exports = { migrate };

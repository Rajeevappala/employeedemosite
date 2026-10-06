require('dotenv').config();
const pool = require('../config/database');

async function migrate() {
  console.log('--- STARTING PHASE 17 ANNOUNCEMENTS MIGRATION ---');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create announcements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.announcements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'High', 'Urgent')),
        target_type VARCHAR(30) NOT NULL DEFAULT 'ALL' CHECK (target_type IN ('ALL', 'DEPARTMENT', 'EMPLOYEE')),
        target_department VARCHAR(100) NULL,
        target_employee_id VARCHAR(20) NULL REFERENCES public.employees(employee_id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
        publish_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NULL,
        created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    console.log('✅ Created table: announcements');

    // 2. Create announcement_reads table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.announcement_reads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
        employee_id VARCHAR(20) NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
        read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_announcement_employee_read UNIQUE (announcement_id, employee_id)
      );
    `);
    console.log('✅ Created table: announcement_reads');

    // 3. Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_status ON public.announcements(status);
      CREATE INDEX IF NOT EXISTS idx_announcements_publish_at ON public.announcements(publish_at);
      CREATE INDEX IF NOT EXISTS idx_announcements_target_type ON public.announcements(target_type);
      CREATE INDEX IF NOT EXISTS idx_announcements_target_department ON public.announcements(target_department);
      CREATE INDEX IF NOT EXISTS idx_announcements_target_employee_id ON public.announcements(target_employee_id);
      CREATE INDEX IF NOT EXISTS idx_announcement_reads_employee_id ON public.announcement_reads(employee_id);
      CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement_id ON public.announcement_reads(announcement_id);
    `);
    console.log('✅ Created indexes for announcements & announcement_reads');

    await client.query('COMMIT');
    console.log('--- PHASE 17 MIGRATION COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));

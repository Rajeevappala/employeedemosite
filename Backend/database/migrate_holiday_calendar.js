const path = require('path');
require('dotenv').config();
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = require('../config/database');

async function migrateHolidayCalendar() {
  console.log('--- RUNNING HOLIDAY CALENDAR DATABASE MIGRATION ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create organization_holidays table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_holidays (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        holiday_date DATE NOT NULL,
        holiday_name VARCHAR(200) NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        CONSTRAINT uq_organization_holidays_date UNIQUE (holiday_date)
      );
    `);

    // 2. Indexes for efficient date filtering and sorting
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organization_holidays_date 
      ON public.organization_holidays(holiday_date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organization_holidays_created_at 
      ON public.organization_holidays(created_at);
    `);

    await client.query('COMMIT');
    console.log('✅ organization_holidays table created successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrateHolidayCalendar()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateHolidayCalendar;

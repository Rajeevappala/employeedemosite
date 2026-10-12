const path = require('path');
require('dotenv').config();
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = require('../config/database');

async function migrateWorkAttendanceSettings() {
  console.log('--- RUNNING WORK & ATTENDANCE SETTINGS DATABASE MIGRATION ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create organization_work_settings singleton table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_work_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        default_work_week VARCHAR(30) NOT NULL DEFAULT '5-Day Work Week',
        default_work_start_time TIME NOT NULL DEFAULT '09:30:00',
        default_work_end_time TIME NOT NULL DEFAULT '18:30:00',
        default_break_duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (default_break_duration_minutes >= 0 AND default_break_duration_minutes <= 480),
        default_weekly_off_days JSONB NOT NULL DEFAULT '["Saturday", "Sunday"]'::jsonb,
        allow_half_day BOOLEAN NOT NULL DEFAULT TRUE,
        allow_work_from_home BOOLEAN NOT NULL DEFAULT TRUE,
        is_singleton BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        CONSTRAINT uq_org_work_settings_singleton UNIQUE (is_singleton),
        CONSTRAINT chk_org_work_settings_singleton_true CHECK (is_singleton IS TRUE)
      );
    `);

    // 2. Ensure initial seed record exists
    await client.query(`
      INSERT INTO public.organization_work_settings (
        default_work_week,
        default_work_start_time,
        default_work_end_time,
        default_break_duration_minutes,
        default_weekly_off_days,
        allow_half_day,
        allow_work_from_home
      )
      VALUES (
        '5-Day Work Week',
        '09:30:00',
        '18:30:00',
        60,
        '["Saturday", "Sunday"]'::jsonb,
        TRUE,
        TRUE
      )
      ON CONFLICT (is_singleton) DO NOTHING;
    `);

    // 3. Index on updated_at
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_org_work_settings_updated_at 
      ON public.organization_work_settings(updated_at);
    `);

    await client.query('COMMIT');
    console.log('✅ Work & Attendance settings table created and seeded successfully.');
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
  migrateWorkAttendanceSettings()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateWorkAttendanceSettings;

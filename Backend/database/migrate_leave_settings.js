const path = require('path');
require('dotenv').config();
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = require('../config/database');

async function migrateLeaveSettings() {
  console.log('--- RUNNING LEAVE MANAGEMENT SETTINGS DATABASE MIGRATION ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create organization_leave_settings singleton table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_leave_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        default_annual_paid_leave INTEGER NOT NULL DEFAULT 18 CHECK (default_annual_paid_leave >= 0),
        default_annual_sick_leave INTEGER NOT NULL DEFAULT 10 CHECK (default_annual_sick_leave >= 0),
        default_annual_unpaid_leave INTEGER NOT NULL DEFAULT 0 CHECK (default_annual_unpaid_leave >= 0),
        allow_carry_forward BOOLEAN NOT NULL DEFAULT TRUE,
        max_carry_forward_days INTEGER NOT NULL DEFAULT 5 CHECK (max_carry_forward_days >= 0),
        allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
        require_admin_approval BOOLEAN NOT NULL DEFAULT TRUE,
        minimum_leave_notice_days INTEGER NOT NULL DEFAULT 1 CHECK (minimum_leave_notice_days >= 0),
        maximum_continuous_leave_days INTEGER NOT NULL DEFAULT 14 CHECK (maximum_continuous_leave_days > 0),
        is_singleton BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        CONSTRAINT uq_org_leave_settings_singleton UNIQUE (is_singleton),
        CONSTRAINT chk_org_leave_settings_singleton_true CHECK (is_singleton IS TRUE)
      );
    `);

    // 2. Ensure initial seed record exists
    await client.query(`
      INSERT INTO public.organization_leave_settings (
        default_annual_paid_leave,
        default_annual_sick_leave,
        default_annual_unpaid_leave,
        allow_carry_forward,
        max_carry_forward_days,
        allow_negative_balance,
        require_admin_approval,
        minimum_leave_notice_days,
        maximum_continuous_leave_days
      )
      VALUES (
        18,
        10,
        0,
        TRUE,
        5,
        FALSE,
        TRUE,
        1,
        14
      )
      ON CONFLICT (is_singleton) DO NOTHING;
    `);

    // 3. Index on updated_at
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_org_leave_settings_updated_at 
      ON public.organization_leave_settings(updated_at);
    `);

    await client.query('COMMIT');
    console.log('✅ Leave settings table created and seeded successfully.');
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
  migrateLeaveSettings()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateLeaveSettings;

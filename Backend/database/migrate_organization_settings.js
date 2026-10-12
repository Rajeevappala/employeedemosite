const path = require('path');
require('dotenv').config();
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = require('../config/database');

async function migrateOrganizationSettings() {
  console.log('--- RUNNING ORGANIZATION SETTINGS DATABASE MIGRATION ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create organization_settings singleton table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_name VARCHAR(200) NOT NULL,
        legal_name VARCHAR(200),
        address_line_1 TEXT,
        address_line_2 TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100) NOT NULL DEFAULT 'India',
        phone VARCHAR(50),
        email VARCHAR(255),
        website VARCHAR(255),
        logo_path TEXT,
        is_singleton BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        CONSTRAINT uq_organization_settings_singleton UNIQUE (is_singleton),
        CONSTRAINT chk_organization_settings_singleton_true CHECK (is_singleton IS TRUE)
      );
    `);

    // 2. Ensure initial seed record exists with GaintPro Software Technologies
    await client.query(`
      INSERT INTO public.organization_settings (
        organization_name,
        country
      )
      VALUES (
        'GaintPro Software Technologies',
        'India'
      )
      ON CONFLICT (is_singleton) DO NOTHING;
    `);

    // 3. Index on updated_at
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organization_settings_updated_at 
      ON public.organization_settings(updated_at);
    `);

    await client.query('COMMIT');
    console.log('✅ Organization settings table created and seeded successfully.');
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
  migrateOrganizationSettings()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateOrganizationSettings;

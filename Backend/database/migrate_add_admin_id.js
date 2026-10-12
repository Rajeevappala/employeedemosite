/**
 * Database Migration: Add admin_id column to public.users
 *
 * 1. Adds admin_id VARCHAR(50) NULL to public.users.
 * 2. Adds unique constraint uq_users_admin_id (PostgreSQL allows multiple NULLs).
 * 3. Adds index on admin_id.
 * 4. Preserves all existing data untouched (existing admins remain NULL until assigned).
 */

const pool = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('--- Starting Migration: Add admin_id column to public.users ---');
    await client.query('BEGIN');

    // 1. Add admin_id column if not exists
    await client.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS admin_id VARCHAR(50) NULL;
    `);
    console.log('✓ Column admin_id added (or already exists).');

    // 2. Add unique constraint if not exists
    const constraintCheck = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'uq_users_admin_id'
    `);
    if (constraintCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE public.users
        ADD CONSTRAINT uq_users_admin_id UNIQUE (admin_id);
      `);
      console.log('✓ Unique constraint uq_users_admin_id created.');
    } else {
      console.log('✓ Unique constraint uq_users_admin_id already exists.');
    }

    // 3. Create index for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_admin_id ON public.users (admin_id);
    `);
    console.log('✓ Index idx_users_admin_id created.');

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

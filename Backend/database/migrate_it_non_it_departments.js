/**
 * Migration: Department Classification Simplification (IT / Non-IT)
 * 
 * - Ensures 'IT' and 'Non-IT' exist in public.organization_departments as active (is_active = true).
 * - Deactivates (is_active = false) all legacy department master records 
 *   (e.g., Engineering, Finance, Human Resources, Marketing, Operations, Sales, Technology).
 * - Preserves all existing employee data in public.employees (no records deleted or silently modified).
 * - Additive, non-destructive, transactional, and idempotent.
 */

const pool = require('../config/database');

async function migrateDepartmentClassification() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATION] Starting IT / Non-IT Department Classification migration...');
    await client.query('BEGIN');

    // 1. Ensure master table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_departments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_org_departments_name_lower 
      ON public.organization_departments (LOWER(TRIM(name)));
    `);

    // 2. Insert or activate 'IT'
    await client.query(`
      INSERT INTO public.organization_departments (name, description, is_active)
      VALUES ('IT', 'Information Technology', true)
      ON CONFLICT (LOWER(TRIM(name))) 
      DO UPDATE SET is_active = true, updated_at = NOW();
    `);

    // 3. Insert or activate 'Non-IT'
    await client.query(`
      INSERT INTO public.organization_departments (name, description, is_active)
      VALUES ('Non-IT', 'Non-Information Technology', true)
      ON CONFLICT (LOWER(TRIM(name))) 
      DO UPDATE SET is_active = true, updated_at = NOW();
    `);

    // 4. Deactivate all legacy department records (do not delete)
    const deactivateRes = await client.query(`
      UPDATE public.organization_departments
      SET is_active = false, updated_at = NOW()
      WHERE LOWER(TRIM(name)) NOT IN ('it', 'non-it')
      RETURNING name;
    `);

    await client.query('COMMIT');

    const deactivatedNames = deactivateRes.rows.map(r => r.name);
    console.log(`[MIGRATION] Successfully activated IT and Non-IT departments.`);
    console.log(`[MIGRATION] Deactivated legacy departments: ${deactivatedNames.join(', ') || 'None'}`);
    console.log('[MIGRATION] IT / Non-IT department migration completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[MIGRATION ERROR] IT / Non-IT migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
  migrateDepartmentClassification()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateDepartmentClassification;

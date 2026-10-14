const pool = require('../config/database');

/**
 * Migration: Restrict Active Designations to exactly two roles:
 * 1. Associate Software Engineer
 * 2. Associate
 *
 * Safety Guarantees:
 * - Does NOT delete any records from organization_designations or employees.
 * - Does NOT modify existing employee records or historical payroll records.
 * - Sets older designations to is_active = false so they are not selectable.
 * - Ensures Associate Software Engineer and Associate are active.
 */
async function migrateRestrictDesignations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('[MIGRATION] Applying designation restriction to 2 roles...');

    const allowedDesignations = [
      { name: 'Associate Software Engineer', desc: 'Software engineering, development, and technical delivery' },
      { name: 'Associate', desc: 'Operational, domain, and business associate role' },
    ];

    for (const d of allowedDesignations) {
      await client.query(`
        INSERT INTO public.organization_designations (name, description, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (LOWER(TRIM(name))) 
        DO UPDATE SET is_active = true, updated_at = NOW();
      `, [d.name, d.desc]);
    }

    // Deactivate all other designations
    const deactRes = await client.query(`
      UPDATE public.organization_designations
      SET is_active = false, updated_at = NOW()
      WHERE LOWER(TRIM(name)) NOT IN ('associate software engineer', 'associate')
      RETURNING id, name, is_active;
    `);

    console.log(`[MIGRATION] Deactivated ${deactRes.rowCount} legacy designations:`, deactRes.rows.map(r => r.name));

    await client.query('COMMIT');
    console.log('[MIGRATION] Designation restriction completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[MIGRATION FAILED] Error applying designation restriction:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateRestrictDesignations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateRestrictDesignations;

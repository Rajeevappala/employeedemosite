/**
 * Database Migration: Admin Settings - Employee Configuration (Phase 5)
 * 
 * Creates master tables for:
 * - public.organization_departments
 * - public.organization_designations
 * - public.organization_employment_types
 * - public.organization_work_locations
 * 
 * Safety Guarantee:
 * - Additive, non-destructive, transactional, idempotent.
 * - Seeds master records from existing employee values and standard company defaults.
 * - Does NOT drop or alter public.employees table or records.
 */

const pool = require('../config/database');

async function migrateEmployeeConfiguration() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATION] Starting Employee Configuration master data migration...');
    await client.query('BEGIN');

    // 1. Departments Table
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

    // 2. Designations Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_designations (
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
      CREATE UNIQUE INDEX IF NOT EXISTS uq_org_designations_name_lower 
      ON public.organization_designations (LOWER(TRIM(name)));
    `);

    // 3. Employment Types Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_employment_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_org_employment_types_name_lower 
      ON public.organization_employment_types (LOWER(TRIM(name)));
    `);

    // 4. Work Locations Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.organization_work_locations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL,
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100) DEFAULT 'India',
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_org_work_locations_name_lower 
      ON public.organization_work_locations (LOWER(TRIM(name)));
    `);

    // 5. Seed initial data from distinct existing employees + defaults
    // Departments
    const initialDepts = [
      { name: 'Engineering', desc: 'Core software engineering and development teams' },
      { name: 'Technology', desc: 'IT infrastructure, devops, and technological services' },
      { name: 'Human Resources', desc: 'Talent acquisition, employee engagement, and operations' },
      { name: 'Finance', desc: 'Financial planning, accounting, and payroll management' },
      { name: 'Operations', desc: 'Business operations and project delivery' },
      { name: 'Sales', desc: 'Client relations and business development' },
      { name: 'Marketing', desc: 'Brand management and marketing campaigns' }
    ];
    for (const d of initialDepts) {
      await client.query(`
        INSERT INTO public.organization_departments (name, description)
        VALUES ($1, $2)
        ON CONFLICT (LOWER(TRIM(name))) DO NOTHING
      `, [d.name, d.desc]);
    }

    // Designations (Restricted to Associate Software Engineer and Associate)
    const initialDesigs = [
      { name: 'Associate Software Engineer', desc: 'Software engineering, development, and technical delivery', is_active: true },
      { name: 'Associate', desc: 'Operational, domain, and business associate role', is_active: true },
      { name: 'Senior Tech Lead', desc: 'Technical architecture and team leadership', is_active: false },
      { name: 'Python Developer', desc: 'Backend application development and services', is_active: false },
      { name: 'Software Engineer', desc: 'Full-stack and frontend development', is_active: false },
      { name: 'Product Manager', desc: 'Product roadmap and feature specifications', is_active: false },
      { name: 'QA Engineer', desc: 'Quality assurance and automated testing', is_active: false },
      { name: 'HR Manager', desc: 'Human resource operations and relations', is_active: false }
    ];
    for (const d of initialDesigs) {
      await client.query(`
        INSERT INTO public.organization_designations (name, description, is_active)
        VALUES ($1, $2, $3)
        ON CONFLICT (LOWER(TRIM(name))) DO NOTHING
      `, [d.name, d.desc, d.is_active]);
    }

    // Employment Types
    const initialEmpTypes = [
      { name: 'Full Time', desc: 'Standard full-time employment with benefits' },
      { name: 'Part Time', desc: 'Part-time working arrangement' },
      { name: 'Contract', desc: 'Fixed-term independent contractor agreement' },
      { name: 'Intern', desc: 'Internship or graduate training program' }
    ];
    for (const et of initialEmpTypes) {
      await client.query(`
        INSERT INTO public.organization_employment_types (name, description)
        VALUES ($1, $2)
        ON CONFLICT (LOWER(TRIM(name))) DO NOTHING
      `, [et.name, et.desc]);
    }

    // Work Locations
    const initialLocations = [
      { name: 'Hyderabad HQ', city: 'Hyderabad', state: 'Telangana', desc: 'Main corporate headquarters' },
      { name: 'Hyderabad', city: 'Hyderabad', state: 'Telangana', desc: 'Hyderabad regional office' },
      { name: 'Bangalore', city: 'Bangalore', state: 'Karnataka', desc: 'Bangalore tech center' },
      { name: 'Mumbai', city: 'Mumbai', state: 'Maharashtra', desc: 'Mumbai commercial hub' },
      { name: 'Pune', city: 'Pune', state: 'Maharashtra', desc: 'Pune engineering office' },
      { name: 'Remote', city: 'Remote', state: 'All', desc: 'Work from home / remote arrangement' }
    ];
    for (const loc of initialLocations) {
      await client.query(`
        INSERT INTO public.organization_work_locations (name, city, state, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (LOWER(TRIM(name))) DO NOTHING
      `, [loc.name, loc.city, loc.state, loc.desc]);
    }

    // Also pick up any additional distinct values currently in employees table
    await client.query(`
      INSERT INTO public.organization_departments (name)
      SELECT DISTINCT department FROM public.employees
      WHERE department IS NOT NULL AND TRIM(department) != ''
      ON CONFLICT (LOWER(TRIM(name))) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO public.organization_designations (name)
      SELECT DISTINCT designation FROM public.employees
      WHERE designation IS NOT NULL AND TRIM(designation) != ''
      ON CONFLICT (LOWER(TRIM(name))) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO public.organization_employment_types (name)
      SELECT DISTINCT employment_type FROM public.employees
      WHERE employment_type IS NOT NULL AND TRIM(employment_type) != ''
      ON CONFLICT (LOWER(TRIM(name))) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO public.organization_work_locations (name)
      SELECT DISTINCT work_location FROM public.employees
      WHERE work_location IS NOT NULL AND TRIM(work_location) != ''
      ON CONFLICT (LOWER(TRIM(name))) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('[MIGRATION] Employee Configuration master data migration completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[MIGRATION FAILED] Error applying employee configuration migration:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateEmployeeConfiguration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateEmployeeConfiguration;

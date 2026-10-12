const path = require('path');
require('dotenv').config();
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = require('../config/database');

async function migrateExitWorkflow() {
  console.log('--- RUNNING EXIT WORKFLOW DATABASE MIGRATION ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Add release_date to documents
    await client.query(`
      ALTER TABLE public.documents 
      ADD COLUMN IF NOT EXISTS release_date DATE;
    `);

    // 2. Add is_active to documents (for document versioning & replacement)
    await client.query(`
      ALTER TABLE public.documents 
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    `);

    // 3. Add exit_request_id to documents
    await client.query(`
      ALTER TABLE public.documents 
      ADD COLUMN IF NOT EXISTS exit_request_id UUID REFERENCES public.exit_requests(id) ON DELETE SET NULL;
    `);

    // 4. Add remarks to documents
    await client.query(`
      ALTER TABLE public.documents 
      ADD COLUMN IF NOT EXISTS remarks TEXT;
    `);

    // 5. Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_release_date ON public.documents(release_date);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_exit_request ON public.documents(exit_request_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_is_active ON public.documents(is_active);
    `);

    await client.query('COMMIT');
    console.log('✅ Exit workflow columns and indexes applied successfully.');
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
  migrateExitWorkflow()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateExitWorkflow;

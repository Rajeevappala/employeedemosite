const path = require('path');
const fs = require('fs');

// Ensure dotenv loads from Backend/.env if not present in process.env.DATABASE_URL
require('dotenv').config();
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = require('../config/database');

async function migrateProduction() {
  console.log('--- STARTING IDEMPOTENT PRODUCTION DATABASE MIGRATION ---');
  const schemaPath = path.join(__dirname, 'production_schema.sql');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  let client;

  try {
    client = await pool.connect();
    console.log('Acquired database connection client. Beginning transaction...');
    await client.query('BEGIN');

    await client.query(sql);

    await client.query('COMMIT');
    console.log('✅ Consolidated production schema applied successfully (Transaction committed).');
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Failed to rollback transaction:', rollbackErr.message);
      }
    }
    const sanitizedError = (err && err.message)
      ? err.message.replace(/:\/\/[^@]+@/, '://***:***@')
      : 'Unknown migration error';
    console.error('❌ Migration failed:', sanitizedError);
    throw err;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

if (require.main === module) {
  migrateProduction()
    .then(() => {
      console.log('--- PRODUCTION MIGRATION FINISHED SUCCESSFULLY ---');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration process exited with error');
      process.exit(1);
    });
}

module.exports = { migrateProduction };

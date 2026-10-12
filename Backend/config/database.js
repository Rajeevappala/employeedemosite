require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

/**
 * Build SSL configuration for PostgreSQL connection
 * In production, TLS is enabled with rejectUnauthorized: true by default.
 * In development, SSL is disabled unless explicitly requested via DATABASE_SSL=true.
 */
function getSslConfiguration() {
  const isProduction = process.env.NODE_ENV === 'production';
  const sslExplicit = process.env.DATABASE_SSL;

  // Determine whether SSL should be enabled
  let enableSsl = false;
  if (sslExplicit !== undefined && sslExplicit !== '') {
    enableSsl = sslExplicit === 'true' || sslExplicit === '1';
  } else if (isProduction) {
    enableSsl = true;
  }

  if (!enableSsl) {
    if (isProduction) {
      console.warn('⚠️  [SECURITY WARNING] Database SSL is explicitly disabled in production mode.');
    }
    return false;
  }

  const sslConfig = {};

  // Reject unauthorized configuration (defaults to true in production)
  if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' || process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === '0') {
    sslConfig.rejectUnauthorized = false;
    console.warn('⚠️  [SECURITY WARNING] DATABASE_SSL_REJECT_UNAUTHORIZED is set to false. TLS certificate authority verification is bypassed.');
  } else {
    sslConfig.rejectUnauthorized = true;
  }

  // Custom CA Certificate support
  if (process.env.DATABASE_CA_CERT_PATH) {
    try {
      if (fs.existsSync(process.env.DATABASE_CA_CERT_PATH)) {
        sslConfig.ca = fs.readFileSync(process.env.DATABASE_CA_CERT_PATH, 'utf8');
      } else {
        console.error(`❌ DATABASE_CA_CERT_PATH specified (${process.env.DATABASE_CA_CERT_PATH}) but file does not exist.`);
      }
    } catch (readErr) {
      console.error('❌ Failed to read custom CA certificate file:', readErr.message);
    }
  } else if (process.env.DATABASE_CA_CERT) {
    sslConfig.ca = process.env.DATABASE_CA_CERT;
  }

  return sslConfig;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getSslConfiguration(),
});

pool.on('error', (err) => {
  const sanitizedMessage = (err && err.message)
    ? err.message.replace(/:\/\/[^@]+@/, '://***:***@')
    : 'Unknown error';
  console.error('Unexpected error on idle PostgreSQL client:', sanitizedMessage);
});

module.exports = pool;

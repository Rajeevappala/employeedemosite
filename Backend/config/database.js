require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  const sanitizedMessage = (err && err.message)
    ? err.message.replace(/:\/\/[^@]+@/, '://***:***@')
    : 'Unknown error';
  console.error('Unexpected error on idle PostgreSQL client:', sanitizedMessage);
});

module.exports = pool;

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.SUPABASE_DB_HOST     || `db.${process.env.SUPABASE_PROJECT_ID}.supabase.co`,
  port:     parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  database: process.env.SUPABASE_DB_NAME     || 'postgres',
  user:     process.env.SUPABASE_DB_USER     || 'postgres',
  password: process.env.SUPABASE_DATABASE_PASSWORD,
  ssl:      { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[pgClient] erro inesperado no pool:', err.message);
});

module.exports = pool;

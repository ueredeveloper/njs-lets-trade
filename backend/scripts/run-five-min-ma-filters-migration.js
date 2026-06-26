'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../supabase/pgClient');

async function main() {
  const sqlPath = path.join(__dirname, '../../supabase/add-five-min-bot-columns.sql');
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const statements = raw
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  for (const stmt of statements) {
    await pool.query(`${stmt};`);
  }

  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'five_min_bot_state'
       AND column_name IN ('rsi_buy', 'rsi_sell', 'ma_filters')
     ORDER BY column_name`,
  );
  console.log('Colunas:', rows.map(r => r.column_name).join(', ') || '(nenhuma)');
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

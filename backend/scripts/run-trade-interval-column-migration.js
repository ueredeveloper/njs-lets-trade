'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../supabase/pgClient');

async function main() {
  const sqlPath = path.join(__dirname, '../bot/shared/add-trade-interval-column.sql');
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const statements = raw
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  for (const stmt of statements) {
    console.log('Executando:', stmt.slice(0, 60).replace(/\s+/g, ' ') + '…');
    await pool.query(`${stmt};`);
  }

  await pool.query(`NOTIFY pgrst, 'reload schema';`);

  const { rows } = await pool.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'rsi_multi_bot_trades' AND column_name = 'interval'`,
  );
  console.log(rows.length === 1 ? 'OK: coluna criada' : 'FALHOU: coluna não encontrada');
  console.table(rows);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

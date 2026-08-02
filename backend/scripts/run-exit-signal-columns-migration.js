'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../supabase/pgClient');

async function main() {
  const sqlPath = path.join(__dirname, '../bot/shared/add-exit-signal-columns.sql');
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
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'rsi_multi_bot_trades'
       AND column_name IN ('target_level', 'target_level_value', 'signal_time', 'via_fast_check')
     ORDER BY column_name`,
  );
  console.log(rows.length === 4 ? 'OK: 4 colunas criadas' : `FALHOU: só ${rows.length}/4 colunas encontradas`);
  console.table(rows);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

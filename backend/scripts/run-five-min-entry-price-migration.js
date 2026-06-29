'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../supabase/pgClient');

async function main() {
  const sqlPath = path.join(__dirname, '../../supabase/add-five-min-entry-price.sql');
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
     WHERE table_name = 'five_min_bot_state'
       AND column_name = 'entry_price'`,
  );
  console.log(rows.length ? `OK: entry_price (${rows[0].data_type})` : 'FALHOU: coluna não encontrada');
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

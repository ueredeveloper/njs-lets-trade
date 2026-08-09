'use strict';

/**
 * Ignição de Volume — monitora todos os pares USDT ativos via WebSocket público da
 * Binance e avisa por WhatsApp quando um par tem um salto de volume (ver
 * backend/market/volumeIgnitionMonitor.js pra lógica de detecção).
 *
 * Roda como processo próprio (Termux) — o painel (PC) não compartilha memória com
 * este processo, então os eventos são gravados no Supabase (volume_ignition_events /
 * volume_ignition_status) pra o painel conseguir exibir. Ver supabase/add-volume-ignition-events.sql.
 *
 * Uso:
 *   node backend/bot/volume-ignition/volume-ignition-bot.js
 *
 * Ou via package.json (junto com VWAP Bands + Bollinger Bands):
 *   npm run bots:bands
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const volumeIgnitionMonitor = require('../../market/volumeIgnitionMonitor');

volumeIgnitionMonitor.start().catch((err) => {
  console.error('[volume-ignition-bot] falha ao iniciar:', err.message);
  process.exit(1);
});

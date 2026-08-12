'use strict';

/**
 * Fonte única (em memória, por processo) do limiar (%) do filtro de tendência da mediana da
 * Bollinger — editável em Configurações, vale pra toda moeda (bollinger_median_trend_config
 * no Supabase; rotas GET/PUT /services/sb/bollinger-median-trend-config em
 * backend/services/supabaseService.js). Usado tanto pelo bot real
 * (backend/bot/bollinger-bands/strategyEngine.js) quanto pelas simulações/estatísticas
 * (backend/utils/bbMedianTrendTrades.js, backend/utils/analyseBollingerBandRecovery.js) — cada
 * processo (bot standalone, server Express) chama refreshMedianTrendThreshold() no boot e
 * periodicamente pra ficar sincronizado, em vez de cada arquivo ter sua própria constante fixa.
 */

const { sbReq } = require('../bot/shared/supabaseRest');

const DEFAULT_MIN_AVG_DIFF_PCT = 0.2;
let current = DEFAULT_MIN_AVG_DIFF_PCT;

function getMedianTrendThreshold() {
  return current;
}

function setMedianTrendThreshold(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) current = n;
}

async function refreshMedianTrendThreshold() {
  const userId = process.env.SUPABASE_DEFAULT_USER_ID;
  if (!userId) return;
  try {
    const rows = await sbReq('GET', 'bollinger_median_trend_config', null, `?user_id=eq.${userId}&limit=1`);
    const value = rows?.[0]?.min_avg_diff_pct;
    if (value != null) setMedianTrendThreshold(value);
  } catch {
    // Falha de rede/Supabase: mantém o último valor conhecido em memória.
  }
}

module.exports = {
  DEFAULT_MIN_AVG_DIFF_PCT,
  getMedianTrendThreshold,
  setMedianTrendThreshold,
  refreshMedianTrendThreshold,
};

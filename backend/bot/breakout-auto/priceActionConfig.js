'use strict';

/**
 * Config do bot "Price action" (Explosão de Alta automática, bullishBreakoutAuto.js) — editável em
 * Configurações → Price action no painel (PUT /services/sb/price-action-config), gravada em
 * `price_action_bot_config` (migração supabase/add-price-action-bot-config.sql). O bot relê a cada
 * varredura (15 min) — mudança salva vale sem reiniciar. Sem linha/tabela → DEFAULTS.
 *
 * Padrão (v1.191.0) = a configuração validada na caixa Price action do gráfico: alvo +15% / stop
 * −30%, BTC 4h > EMA50, moeda > EMA20 1d, MACD 4h > 0, EMA20 1d do BTC subindo (período de baixa)
 * e moeda entre as 40 maiores altas 24h.
 */

const { DEFAULT_REGIME } = require('./marketRegime');
const { BULLISH_PATTERNS } = require('../shared/candleCloseCondition');

const TABLE = 'price_action_bot_config';

const DEFAULTS = Object.freeze({
  enabled: true,
  usdt: 20, // v1.192.0 (era 25)
  maxActive: 3,
  minBodyPct: 5,
  minVolume24h: 1_000_000,
  firstOfMove: true,
  // Padrões de ALTA que liberam a entrada com corpo abaixo do mínimo (v1.187.0) — todos por padrão.
  // Lista vazia = só a regra do corpo.
  bullishPatterns: [...BULLISH_PATTERNS],
  targetPct: 15,
  stopPct: 30,
  regime: { ...DEFAULT_REGIME },
});

const num = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v, def) => (typeof v === 'boolean' ? v : def);

/** Normaliza/valida (vem do painel). Stop mínimo 10% — mesmo piso de toda OCO real (manualOcoStop.js). */
function normalizePriceActionConfig(raw = {}) {
  const r = raw.regime ?? {};
  const d = DEFAULTS;
  return {
    enabled: bool(raw.enabled, d.enabled),
    usdt: num(raw.usdt, d.usdt, 6, 10_000),
    maxActive: Math.trunc(num(raw.maxActive, d.maxActive, 1, 50)),
    minBodyPct: num(raw.minBodyPct, d.minBodyPct, 0.5, 50),
    minVolume24h: num(raw.minVolume24h, d.minVolume24h, 0, 1e10),
    firstOfMove: bool(raw.firstOfMove, d.firstOfMove),
    bullishPatterns: Array.isArray(raw.bullishPatterns)
      ? BULLISH_PATTERNS.filter((p) => raw.bullishPatterns.includes(p))
      : [...d.bullishPatterns],
    targetPct: num(raw.targetPct, d.targetPct, 1, 200),
    stopPct: num(raw.stopPct, d.stopPct, 10, 90),
    regime: {
      btcEma50_4h: bool(r.btcEma50_4h, d.regime.btcEma50_4h),
      coinEma20_1d: bool(r.coinEma20_1d, d.regime.coinEma20_1d),
      coinMacd4h: bool(r.coinMacd4h, d.regime.coinMacd4h),
      btcEma20_1dRising: bool(r.btcEma20_1dRising, d.regime.btcEma20_1dRising),
      // 0 = desligado
      topGainers: Math.trunc(num(r.topGainers, d.regime.topGainers, 0, 500)),
      minVolume24h: num(r.minVolume24h, d.regime.minVolume24h, 0, 1e10),
    },
  };
}

/** Lê a config salva (via sbReq do bot). Tabela ausente / erro → DEFAULTS (o bot segue rodando). */
async function loadPriceActionConfig(sbReq, userId) {
  if (!userId) return normalizePriceActionConfig();
  try {
    const rows = await sbReq('GET', TABLE, null, `?user_id=eq.${userId}&select=config&limit=1`);
    return normalizePriceActionConfig(rows?.[0]?.config ?? {});
  } catch {
    return normalizePriceActionConfig();
  }
}

module.exports = { TABLE, DEFAULTS, BULLISH_PATTERNS, normalizePriceActionConfig, loadPriceActionConfig };

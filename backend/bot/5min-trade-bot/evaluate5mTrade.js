'use strict';

/**
 * Avaliação ao vivo do bot 5m com os parâmetros escolhidos pelo usuário.
 * Usa candles recentes da exchange (mesma fonte do histórico).
 */

const { computeRsiSeries, COOLDOWN_CANDLES, RSI_PERIOD } = require('./suggest5mRsi');
const {
  normalizeMaFilters,
  buildMaLookupMap,
  passesMaFilters,
  detailMaFilters,
  describeMaFilters,
  formatMaFilterLabel,
} = require('./maFilter');

const ENTRY_COOLDOWN_MS = COOLDOWN_CANDLES * 5 * 60 * 1000; // 2h

const ACTION_LABELS = {
  compraria:              '🟢 Compraria agora',
  venderia:               '🔴 Venderia tudo agora',
  dca_compraria:          '🟢 DCA — compraria mais',
  aguardar:               '⏳ Aguardando sinal',
  entrada_bloqueada_ma:   '🚫 Entrada bloqueada (MA)',
  dca_bloqueada_ma:       '🚫 DCA bloqueada (MA)',
  dca_aguardando_cooldown:'⏳ DCA — cooldown 2h',
  mantem_posicao:         '📊 Mantém posição',
};

function formatCooldown(ms) {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${m > 0 ? `${m}m` : ''}` : `${m}m`;
}

function canDcaAgain(lastBuyTime) {
  if (!lastBuyTime) return true;
  return Date.now() - new Date(lastBuyTime).getTime() >= ENTRY_COOLDOWN_MS;
}

function cooldownRemaining(lastBuyTime) {
  if (!lastBuyTime) return 0;
  return Math.max(0, ENTRY_COOLDOWN_MS - (Date.now() - new Date(lastBuyTime).getTime()));
}

/**
 * @param {object} cMap — candles por intervalo ('5m', '1h', …)
 * @param {object} params — rsiBuy, rsiSell, maFilters, phase, lastBuyTime, buyCount
 */
function evaluate5mTradeLive(cMap, params = {}) {
  const rsiBuy   = Number(params.rsiBuy  ?? 30);
  const rsiSell  = Number(params.rsiSell ?? 70);
  const phase    = params.phase === 'BOUGHT' ? 'BOUGHT' : 'WATCHING';
  const maCfg    = normalizeMaFilters(params.maFilters);
  const buyCount = Number(params.buyCount ?? 0) || 0;

  const candles5m = cMap?.['5m'];
  if (!candles5m?.length || candles5m.length < RSI_PERIOD + 2) {
    return { error: 'candles_insuficientes', phase, rsiBuy, rsiSell, maFilters: maCfg };
  }

  const series = computeRsiSeries(candles5m, RSI_PERIOD);
  const last   = series[series.length - 1];
  if (last.rsi == null) {
    return { error: 'rsi_insuficiente', phase, rsiBuy, rsiSell, maFilters: maCfg };
  }

  const rsiNow   = parseFloat(last.rsi.toFixed(2));
  const price    = Number(last.close);
  const openTime = last.openTime;
  const maLookup = buildMaLookupMap(cMap, maCfg);
  const maPass   = passesMaFilters(price, openTime, maLookup, maCfg);
  const maChecks = detailMaFilters(price, openTime, maLookup, maCfg);

  const rsiBuySignal  = rsiNow < rsiBuy;
  const rsiSellSignal = rsiNow > rsiSell;
  const fastThreshold = Math.max(rsiSell - 2, rsiBuy + 5);
  const fastPoll      = rsiNow >= fastThreshold;

  let action  = 'aguardar';
  let allowed = false;
  let reason  = '';
  let detail  = null;

  if (phase === 'WATCHING') {
    if (!rsiBuySignal) {
      action = 'aguardar';
      reason = `RSI ${rsiNow} ≥ ${rsiBuy} — sem sobrevenda no candle 5m atual`;
      if (rsiNow >= fastThreshold) {
        detail = `RSI próximo da saída (≥ ${fastThreshold}) — bot faria poll a cada 30s`;
      }
    } else if (!maPass.ok) {
      action = 'entrada_bloqueada_ma';
      const f = maPass.filter;
      reason = `RSI ${rsiNow} < ${rsiBuy} mas ${formatMaFilterLabel(f)} não atendido`;
      if (maPass.distPct != null) reason += ` (preço ${maPass.distPct}% vs MA)`;
      if (maPass.threshold != null) {
        detail = `Piso: ${maPass.threshold.toFixed(6)} · preço ${price.toFixed(6)}`;
      }
    } else {
      action  = 'compraria';
      allowed = true;
      reason  = `RSI ${rsiNow} < ${rsiBuy}`;
      if (maCfg.enabled) reason += ` e filtros MA OK`;
      else reason += ' — entrada permitida';
    }
  } else {
    if (rsiSellSignal) {
      action  = 'venderia';
      allowed = true;
      reason  = `RSI ${rsiNow} > ${rsiSell} — venda total`;
      if (buyCount > 1) detail = `${buyCount} entradas na posição`;
    } else if (rsiBuySignal) {
      const remaining = cooldownRemaining(params.lastBuyTime);
      if (!canDcaAgain(params.lastBuyTime)) {
        action = 'dca_aguardando_cooldown';
        reason = `RSI ${rsiNow} < ${rsiBuy} mas faltam ${formatCooldown(remaining)} para DCA`;
      } else if (!maPass.ok) {
        action = 'dca_bloqueada_ma';
        reason = `RSI baixo e cooldown OK, mas MA bloqueou (${formatMaFilterLabel(maPass.filter)})`;
      } else {
        action  = 'dca_compraria';
        allowed = true;
        reason  = `RSI ${rsiNow} < ${rsiBuy}, cooldown 2h OK e MA OK — nova entrada DCA`;
      }
    } else {
      action = 'mantem_posicao';
      reason = `RSI ${rsiNow} entre ${rsiBuy} e ${rsiSell} — mantém posição`;
    }
  }

  return {
    symbol:           params.symbol ?? null,
    exchange:         params.exchange ?? null,
    evaluatedAt:      new Date().toISOString(),
    phase,
    buyCount:         phase === 'BOUGHT' ? buyCount : 0,
    price:            parseFloat(price.toFixed(8)),
    rsiNow,
    rsiBuy,
    rsiSell,
    rsiBuySignal,
    rsiSellSignal,
    fastPoll,
    fastThreshold,
    maFilters:        maCfg,
    maDescription:    describeMaFilters(maCfg),
    maPass:           maPass.ok,
    maChecks,
    action,
    actionLabel:      ACTION_LABELS[action] ?? action,
    allowed,
    reason,
    detail,
    cooldownRemainingMs: phase === 'BOUGHT' && rsiBuySignal && !canDcaAgain(params.lastBuyTime)
      ? cooldownRemaining(params.lastBuyTime)
      : 0,
    paramsUsed: {
      rsiBuy,
      rsiSell,
      maFilters: maCfg,
      phase,
      lastBuyTime: params.lastBuyTime ?? null,
    },
  };
}

module.exports = {
  evaluate5mTradeLive,
  ACTION_LABELS,
  ENTRY_COOLDOWN_MS,
};

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
  entrada_bloqueada_padrao: '🚫 Entrada bloqueada (padrão 1h)',
  dca_bloqueada_padrao:     '🚫 DCA bloqueada (padrão 1h)',
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

const { checkRecoveryPatternsLive, evaluateRecoveryEntry } = require('./recoveryPattern');
const { normalizeRecoveryPattern, recoveryPatternLabel } = require('./recoveryPatternConfig');
const { normalizeSellScope, sellScopeLabel } = require('./sellScopeConfig');
const { maKey } = require('./maFilter');

function checkCandlePatterns(cMap, recoveryPattern = null) {
  const cfg = normalizeRecoveryPattern(recoveryPattern);
  return checkRecoveryPatternsLive(cMap?.['1h'], cfg.types.length ? cfg.types : null);
}

function recoveryEvalForEntry(cMap, maCfg, price, openTime, recoveryPattern) {
  const cfg = normalizeRecoveryPattern(recoveryPattern);
  if (!cfg.types.length) return { ok: true, patternRequired: false };

  const active = maCfg.enabled
    ? maCfg.filters.find(f => f.enabled && f.mode === 'above')
    : { period: 50, interval: '1h', tolerancePct: 3 };
  const period = active?.period ?? 50;
  const interval = active?.interval ?? '1h';
  const tol = active?.tolerancePct ?? 3;
  const maLookup = buildMaLookupMap(cMap, { enabled: true, filters: [{ ...active, enabled: true }] });
  const key = maKey(period, interval);
  const series = maLookup[key];
  let ma = null;
  if (series?.length) {
    for (const pt of series) {
      if (pt.openTime <= openTime) ma = pt.ma;
      else break;
    }
  }
  const patternLive = checkRecoveryPatternsLive(cMap?.['1h'], cfg.types);
  return evaluateRecoveryEntry(price, ma, tol, cfg, patternLive);
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
  const sellScope = normalizeSellScope(params.sellScope).scope;

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

  const recoveryCfg = normalizeRecoveryPattern(params.recoveryPattern);
  const candlePatterns = checkCandlePatterns(cMap, recoveryCfg);
  const recoveryEval   = recoveryEvalForEntry(cMap, maCfg, price, openTime, recoveryCfg);
  const patternRequired = recoveryEval.patternRequired === true;

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
    } else if (patternRequired && !recoveryEval.ok) {
      action  = 'entrada_bloqueada_padrao';
      allowed = false;
      if (recoveryEval.reason === 'tres_vermelhos_1h') {
        reason = `RSI ${rsiNow} < ${rsiBuy} mas 3 candles 1h vermelhos — queda em direção à MA`;
      } else {
        const zone = recoveryEval.zone === 'above_ma'
          ? `acima MA +${recoveryCfg.abovePct}%`
          : 'entre MA e adaptação';
        reason  = `RSI ${rsiNow} < ${rsiBuy} mas padrão 1h ausente na zona ${zone} (${recoveryPatternLabel(recoveryCfg)})`;
      }
    } else {
      action  = 'compraria';
      allowed = true;
      reason  = `RSI ${rsiNow} < ${rsiBuy}`;
      if (patternRequired && recoveryEval.ok) reason += ` e padrão 1h OK (${recoveryEval.zone})`;
      if (maCfg.enabled) reason += ` e filtros MA OK`;
      else if (!patternRequired) reason += ' — entrada permitida';
    }
  } else {
    if (rsiSellSignal) {
      action  = 'venderia';
      allowed = true;
      reason  = `RSI ${rsiNow} > ${rsiSell} — ${sellScopeLabel(sellScope).toLowerCase()}`;
      if (buyCount > 1) detail = `${buyCount} entradas na posição`;
    } else if (rsiBuySignal) {
      const remaining = cooldownRemaining(params.lastBuyTime);
      if (!canDcaAgain(params.lastBuyTime)) {
        action = 'dca_aguardando_cooldown';
        reason = `RSI ${rsiNow} < ${rsiBuy} mas faltam ${formatCooldown(remaining)} para DCA`;
      } else if (!maPass.ok) {
        action = 'dca_bloqueada_ma';
        reason = `RSI baixo e cooldown OK, mas MA bloqueou (${formatMaFilterLabel(maPass.filter)})`;
      } else if (patternRequired && !recoveryEval.ok) {
        action = 'dca_bloqueada_padrao';
        reason = recoveryEval.reason === 'tres_vermelhos_1h'
          ? 'DCA bloqueada: 3 candles 1h vermelhos'
          : `RSI baixo mas padrão 1h ausente (${recoveryPatternLabel(recoveryCfg)})`;
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
    candlePatterns,
    recoveryEval,
    cooldownRemainingMs: phase === 'BOUGHT' && rsiBuySignal && !canDcaAgain(params.lastBuyTime)
      ? cooldownRemaining(params.lastBuyTime)
      : 0,
    paramsUsed: {
      rsiBuy,
      rsiSell,
      maFilters: maCfg,
      sellScope,
      phase,
      lastBuyTime: params.lastBuyTime ?? null,
    },
  };
}

module.exports = {
  evaluate5mTradeLive,
  checkCandlePatterns,
  ACTION_LABELS,
  ENTRY_COOLDOWN_MS,
};

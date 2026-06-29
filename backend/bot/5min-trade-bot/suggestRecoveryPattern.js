'use strict';

const ti = require('technicalindicators');
const { RSI_PERIOD } = require('./suggest5mRsi');
const { RECOVERY_PATTERN_TYPES, RECOVERY_PATTERN_LABELS } = require('./recoveryPatternConfig');
const { patternMatchesAt, lastClosed1hIndex, getPatternVisual } = require('./recoveryPattern');

/**
 * Para cada entrada RSI<rsiBuy no 5m, verifica padrão 1h no momento da entrada
 * e mede alta % até RSI>rsiSell.
 */
function analyzeRecoveryPatterns(candles5m, candles1h, rsiBuy, rsiSell, rsiPeriod = RSI_PERIOD) {
  if (!candles5m?.length || candles1h?.length < 10) {
    return { ok: false, reason: 'dados_insuficientes' };
  }

  const completed1h = candles1h.slice(0, -1);
  const closes5m    = candles5m.map(c => c.close);
  const rsiArr        = ti.RSI.calculate({ values: closes5m, period: rsiPeriod });
  const stats         = Object.fromEntries(RECOVERY_PATTERN_TYPES.map(t => [t, {
    entries: 0, wins: 0, rises: [],
  }]));

  let inDip          = false;
  let entryPrice     = 0;
  let entryPatterns  = [];

  for (let i = 0; i < rsiArr.length; i++) {
    const rsi   = rsiArr[i];
    const idx5m = rsiPeriod + i;
    const c5    = candles5m[idx5m];
    if (!c5) continue;

    if (!inDip && rsi < rsiBuy) {
      inDip         = true;
      entryPrice    = c5.close;
      const h1Idx   = lastClosed1hIndex(candles1h, c5.openTime ?? 0);
      entryPatterns = h1Idx >= 0
        ? RECOVERY_PATTERN_TYPES.filter(t => patternMatchesAt(completed1h, h1Idx, t))
        : [];
    } else if (inDip && rsi >= rsiSell) {
      const risePct = entryPrice > 0 ? (c5.close - entryPrice) / entryPrice * 100 : 0;
      for (const type of entryPatterns) {
        const s = stats[type];
        s.entries++;
        s.rises.push(parseFloat(risePct.toFixed(2)));
        if (risePct > 0) s.wins++;
      }
      inDip         = false;
      entryPatterns = [];
    }
  }

  const patterns = RECOVERY_PATTERN_TYPES.map(type => {
    const s = stats[type];
    const avgRisePct = s.entries > 0
      ? parseFloat((s.rises.reduce((a, b) => a + b, 0) / s.entries).toFixed(2))
      : null;
    const winRate = s.entries > 0
      ? parseFloat((s.wins / s.entries * 100).toFixed(1))
      : null;
    return {
      type,
      visual:     getPatternVisual(type),
      label:      RECOVERY_PATTERN_LABELS[type],
      entries:    s.entries,
      wins:       s.wins,
      winRate,
      avgRisePct,
    };
  }).filter(p => p.entries > 0);

  patterns.sort((a, b) => {
    const scoreA = (a.winRate ?? 0) * 0.55 + Math.max(0, a.avgRisePct ?? 0) * 0.45;
    const scoreB = (b.winRate ?? 0) * 0.55 + Math.max(0, b.avgRisePct ?? 0) * 0.45;
    return scoreB - scoreA;
  });

  const qualified = patterns.filter(p => p.entries >= 2);
  const best      = qualified[0] ?? patterns[0] ?? null;
  const recommended = best?.type ?? 'three_one';

  return {
    ok:          true,
    rsiBuy,
    rsiSell,
    patterns,
    recommended,
    summary: best
      ? `${best.label}: ${best.entries}× RSI<${rsiBuy} · win ${best.winRate}% · +${best.avgRisePct}% médio`
      : 'Poucos dados no histórico — padrão 3↑1↓ sugerido',
  };
}

module.exports = { analyzeRecoveryPatterns };

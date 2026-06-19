'use strict';

/**
 * Sugere o limiar % acima da MA de referência para ativar regras 3/4 candles.
 *
 * Para cada sinal histórico RSI+MA válido, mede o % acima da MA e simula o trade.
 * Varre limiares e escolhe o que maximiza o benefício líquido das regras 3/4
 * (bloqueios que salvam prejuízo − oportunidades perdidas).
 */

const {
  computeRsiSeries, maSnapAt, simulateForwardTrade, classifyExtensionOutcome,
} = require('./extensionBacktest');
const { lastMa } = require('./adaptiveMaDip');

/** Evita dependência circular com strategyEngine no load do módulo. */
function engine() {
  return require('./strategyEngine');
}

const DEFAULT_OPTS = {
  defaultAbovePct: 5,
  minAbovePct:     2,
  maxAbovePct:     15,
  minSignalsInZone: 2,
  sweepStep:       0.5,
};

function extensionConfirmed(extAnalysis, extension) {
  if (!extension.threeCandles && !extension.fourCandles) return true;
  const logic = extension.confirmLogic ?? 'any';
  return logic === 'all'
    ? (extAnalysis.threeOk && extAnalysis.fourOk)
    : (extAnalysis.threeOk || extAnalysis.fourOk);
}

function collectEntrySignals(cMap, config) {
  const {
    checkRsi, analyzeExtension, getExtensionIntervals, evaluateEntry,
    computeAdaptiveDips, maKey,
  } = engine();
  const entryCandles = cMap[config.entryRsi.interval];
  const exitCandles  = cMap[config.exitRsi.interval];
  if (!entryCandles?.length) return [];

  const entrySeries = computeRsiSeries(entryCandles, config.entryRsi.period);
  const exitSeries  = config.entryRsi.interval === config.exitRsi.interval &&
    config.entryRsi.period === config.exitRsi.period
    ? entrySeries
    : computeRsiSeries(exitCandles, config.exitRsi.period);

  const adaptiveDips = computeAdaptiveDips(cMap, config);
  const withoutExt   = { ...config, extension: { ...config.extension, enabled: false } };
  const ext          = config.extension ?? {};
  const extIv        = ext.maInterval ?? '1h';
  const extP         = ext.maPeriod ?? 50;
  const extKey       = maKey(extP, extIv);
  const { threeInterval, fourInterval } = getExtensionIntervals(ext);

  const signals = [];

  for (let i = 0; i < entrySeries.length; i++) {
    const { openTime, close, rsi: entryRsi } = entrySeries[i];
    if (!checkRsi(entryRsi, config.entryRsi)) continue;

    const maSnap = maSnapAt(cMap, config, openTime);
    const baseCheck = evaluateEntry({
      entryRsi, close, entryTimeMs: openTime, config: withoutExt, maSnap, adaptiveDips, cMap,
    });
    if (!baseCheck.allowed) continue;

    const md = maSnap[extKey];
    if (!md?.ma) continue;

    const aboveMaPct = (close / md.ma - 1) * 100;
    const extAnalysis = analyzeExtension(close, md.ma, {
      three: cMap[threeInterval],
      four:  cMap[fourInterval],
    }, { ...ext, enabled: true }, openTime);

    const confirmed = extensionConfirmed(extAnalysis, ext);
    const forward   = simulateForwardTrade(i, entrySeries, exitSeries, cMap, config, adaptiveDips);

    signals.push({
      entryTime: openTime,
      aboveMaPct: parseFloat(aboveMaPct.toFixed(2)),
      threeOk: extAnalysis.threeOk,
      fourOk: extAnalysis.fourOk,
      confirmed,
      pnlPct: forward.pnlPct,
      outcome: classifyExtensionOutcome(confirmed, forward.pnlPct),
    });
  }

  return signals;
}

function netBenefitAtThreshold(signals, threshold) {
  let saved = 0;
  let missed = 0;
  let inZone = 0;
  for (const s of signals) {
    if (s.aboveMaPct < threshold) continue;
    inZone++;
    if (s.confirmed) continue;
    if (s.pnlPct < 0) saved += Math.abs(s.pnlPct);
    else missed += s.pnlPct;
  }
  return { netBenefit: saved - missed, saved, missed, inZone };
}

function sweepBestThreshold(signals, opts) {
  let best = { threshold: opts.defaultAbovePct, netBenefit: -Infinity, inZone: 0 };

  for (let t = opts.minAbovePct; t <= opts.maxAbovePct; t += opts.sweepStep) {
    const r = netBenefitAtThreshold(signals, t);
    if (r.inZone < opts.minSignalsInZone) continue;
    if (r.netBenefit > best.netBenefit) {
      best = { threshold: parseFloat(t.toFixed(1)), ...r };
    }
  }
  return best;
}

function medianPositiveStretch(signals) {
  const stretches = signals.map(s => s.aboveMaPct).filter(p => p > 0).sort((a, b) => a - b);
  if (!stretches.length) return null;
  const mid = Math.floor((stretches.length - 1) / 2);
  return stretches.length % 2 ? stretches[mid] : (stretches[mid] + stretches[mid + 1]) / 2;
}

/**
 * @param {object} cMap
 * @param {object} config — trade_config do motor
 */
function suggestExtensionAbovePct(cMap, config, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const ext = config.extension ?? {};
  const extIv = ext.maInterval ?? '1h';
  const extP  = ext.maPeriod ?? 50;

  const signals = collectEntrySignals(cMap, config);
  if (!signals.length) {
    return {
      suggestedAbovePct: o.defaultAbovePct,
      usedDefault: true,
      reason: 'sem_sinais',
      signalCount: 0,
      maPeriod: extP,
      maInterval: extIv,
    };
  }

  const sweep     = sweepBestThreshold(signals, o);
  const medianPos = medianPositiveStretch(signals);
  const usedDefault = sweep.inZone < o.minSignalsInZone;

  let suggestedAbovePct = usedDefault
    ? (medianPos != null
      ? Math.max(o.minAbovePct, Math.min(o.maxAbovePct, parseFloat(medianPos.toFixed(1))))
      : o.defaultAbovePct)
    : sweep.threshold;

  // Snapshot ao vivo
  const entryCandles = cMap[config.entryRsi.interval];
  const maCandles    = cMap[extIv];
  const close        = entryCandles?.length ? entryCandles[entryCandles.length - 1].close : null;
  const ma           = maCandles?.length ? lastMa(maCandles, extP) : null;
  const aboveNowPct  = ma != null && close != null
    ? parseFloat(((close / ma - 1) * 100).toFixed(2))
    : null;

  const stretchedSignals = signals.filter(s => s.aboveMaPct >= suggestedAbovePct);

  return {
    suggestedAbovePct,
    usedDefault,
    reason: usedDefault ? 'poucos_sinais_na_zona' : null,
    signalCount: signals.length,
    signalsInZone: stretchedSignals.length,
    maPeriod: extP,
    maInterval: extIv,
    medianStretchPct: medianPos != null ? parseFloat(medianPos.toFixed(2)) : null,
    sweepNetBenefit: usedDefault ? null : parseFloat(sweep.netBenefit.toFixed(2)),
    sweepSavedPct: usedDefault ? null : sweep.saved,
    sweepMissedPct: usedDefault ? null : sweep.missed,
    aboveNowPct,
    extendedNow: aboveNowPct != null && aboveNowPct > suggestedAbovePct,
    currentMa: ma,
    currentPrice: close,
  };
}

function buildExtensionAboveReport(cMap, config, opts) {
  return suggestExtensionAbovePct(cMap, config, opts);
}

module.exports = {
  suggestExtensionAbovePct,
  buildExtensionAboveReport,
  collectEntrySignals,
  netBenefitAtThreshold,
  DEFAULT_OPTS,
};

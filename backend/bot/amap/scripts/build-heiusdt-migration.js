'use strict';
/** Gera trade_config HEIUSDT (15m + 1h) e SQL de migração. */
const fs = require('fs');
const path = require('path');
const { normalizeTradeConfig } = require('../tradeConfigSchema');
const { buildTradeConfig } = require('../strategyEngine');

function patch15(body) {
  const ma1hOnly = [{
    mode: 'strict_above', period: 50, interval: '1h',
    fixedDipPct: null, aboveMaEnabled: false,
  }];
  const extOff = {
    enabled: false, abovePct: 5, maPeriod: 50, maInterval: '1h',
    threeCandles: false, fourCandles: false, confirmLogic: 'any',
    threeInterval: '1h', fourInterval: '1h',
  };
  const entryMa = {
    period: 50, trigger: 'touch', interval: '1h',
    tolerancePct: 1.5, aboveMaCandles: 1, aboveMaEnabled: true,
  };
  return {
    ...body,
    label: 'AMAP 15m Swing HEI',
    entryRsi: { ...body.entryRsi, value: 40 },
    maConditions: ma1hOnly,
    extension: extOff,
    rule1: {
      ...body.rule1,
      entryRsi: { ...body.rule1.entryRsi, value: 40 },
      maConditions: ma1hOnly,
      maFilters: ma1hOnly,
      extension: extOff,
      maFiltersEnabled: true,
    },
    rule2: {
      ...body.rule2,
      entryMa: { ...body.rule2.entryMa, ...entryMa, fixedDipPct: '' },
    },
    entryMa: { ...body.entryMa, ...entryMa, enabled: true, fixedDipPct: '' },
    entryRsiPath: { enabled: true },
    maFiltersEnabled: true,
  };
}

function patch1h(body) {
  const ma4hOnly = [{
    mode: 'adaptive', period: 50, interval: '4h',
    fixedDipPct: 6, aboveMaCandles: 1, aboveMaEnabled: true,
  }];
  const extOff = {
    enabled: false, abovePct: 7, maPeriod: 50, maInterval: '4h',
    threeCandles: false, fourCandles: false, confirmLogic: 'any',
    threeInterval: '4h', fourInterval: '4h',
  };
  const entryMa = {
    period: 50, trigger: 'touch', interval: '4h',
    tolerancePct: 1.5, aboveMaCandles: 1, aboveMaEnabled: true,
  };
  return {
    ...body,
    label: 'AMAP 1h Swing HEI',
    entryRsi: { ...body.entryRsi, value: 38 },
    maConditions: ma4hOnly,
    extension: extOff,
    polling: {
      pollMs: body.pollMs ?? 300_000,
      fastPollMs: body.fastPollMs ?? 60_000,
      fastRsiThreshold: body.fastRsiThreshold ?? 60,
    },
    execution: {
      immediateEntry: body.immediateEntry ?? body.rule1?.immediateEntry ?? true,
      entryDiscount: body.entryDiscount ?? body.rule1?.entryDiscount ?? 0.015,
      pendingTimeoutMs: body.pendingTimeoutMs ?? body.rule1?.pendingTimeoutMs ?? 7_200_000,
      pendingCancelPct: body.pendingCancelPct ?? body.rule1?.pendingCancelPct ?? 0.003,
      pendingCancelOnExitRsi: body.pendingCancelOnExitRsi ?? true,
    },
    rule1: {
      ...body.rule1,
      entryRsi: { ...body.rule1.entryRsi, value: 38 },
      maConditions: ma4hOnly,
      maFilters: ma4hOnly,
      extension: extOff,
      maFiltersEnabled: true,
    },
    rule2: {
      ...body.rule2,
      entryMa: { ...body.rule2.entryMa, ...entryMa, fixedDipPct: '' },
    },
    entryMa: { ...body.entryMa, ...entryMa, enabled: true, fixedDipPct: '' },
    entryRsiPath: { enabled: true },
    maFiltersEnabled: true,
  };
}

/** Persiste no mesmo formato flat do Supabase (com rule1/rule2 + campos legados). */
function toDbTradeConfig(body) {
  const n = normalizeTradeConfig(body);
  const engine = buildTradeConfig(body);
  const maFilters = (n.maConditions ?? []).map(m => ({
    period: m.period, interval: m.interval, mode: m.mode,
    fixedDipPct: m.fixedDipPct ?? null,
    aboveMaEnabled: m.aboveMaEnabled === true,
    aboveMaCandles: m.aboveMaCandles ?? 10,
  }));
  return {
    label: n.label,
    rule1: {
      enabled: n.rule1.enabled,
      entryRsi: n.rule1.entryRsi,
      exitRsi: n.rule1.exitRsi,
      maFilters,
      maFiltersEnabled: n.rule1.maFiltersEnabled,
      extension: n.rule1.extension,
      stopLoss: n.rule1.stopLoss,
      adaptiveOpts: n.rule1.adaptiveOpts,
      immediateEntry: n.execution.immediateEntry,
      entryDiscount: n.execution.entryDiscount,
      pendingTimeoutMs: n.execution.pendingTimeoutMs,
      pendingCancelPct: n.execution.pendingCancelPct,
      pendingCancelOnExitRsi: n.execution.pendingCancelOnExitRsi,
    },
    rule2: {
      ...n.rule2,
      entryMa: {
        ...n.rule2.entryMa,
        fixedDipPct: n.rule2.entryMa.fixedDipPct ?? '',
      },
      entryDiscount: body.rule2?.entryDiscount ?? n.rule2.entryDiscount,
      pendingTimeoutMs: body.rule2?.pendingTimeoutMs ?? n.rule2.pendingTimeoutMs,
      pendingCancelPct: body.rule2?.pendingCancelPct ?? n.rule2.pendingCancelPct,
      adaptiveOpts: body.rule2?.adaptiveOpts ?? n.rule2.adaptiveOpts,
    },
    entryRsi: engine.entryRsi,
    exitRsi: engine.exitRsi,
    entryRsiPath: engine.entryRsiPath,
    entryMa: {
      ...engine.entryMa,
      fixedDipPct: engine.entryMa.fixedDipPct ?? '',
    },
    maFilters,
    maConditions: maFilters,
    maFiltersEnabled: n.rule1.maFiltersEnabled,
    extension: n.extension,
    stopLoss: n.stopLoss,
    adaptiveOpts: n.adaptiveOpts,
    immediateEntry: n.execution.immediateEntry,
    entryDiscount: n.execution.entryDiscount,
    pendingTimeoutMs: n.execution.pendingTimeoutMs,
    pendingCancelPct: n.execution.pendingCancelPct,
    pendingCancelOnExitRsi: n.execution.pendingCancelOnExitRsi,
    pollMs: n.polling.pollMs,
    fastPollMs: n.polling.fastPollMs,
    fastRsiThreshold: n.polling.fastRsiThreshold,
    minVolumeUsdt: n.volume.minVolumeUsdt,
    allowLowVolume: n.volume.allowLowVolume,
    aggressiveExitOnLowVolume: n.volume.aggressiveExitOnLowVolume,
  };
}

const user15 = require('../heiusdt-config-15m-source.json');
const user1h = require('../heiusdt-config-1h-source.json');

const tc15 = toDbTradeConfig(patch15(user15));
const tc1h = toDbTradeConfig(patch1h(user1h));

const sql = `-- HEIUSDT — ajuste trade_config (uptrend / mais entradas)
-- Execute no SQL Editor do Supabase.
-- rsi_multi_bot_state id 77 = amap-15m | id 99 = amap-1h

BEGIN;

-- ── amap-15m (id 77) ───────────────────────────────────────────────────────
UPDATE public.rsi_multi_bot_state
SET trade_config = '${JSON.stringify(tc15).replace(/'/g, "''")}'::jsonb,
    updated_at   = NOW()
WHERE id = 77 AND symbol = 'HEIUSDT' AND strategy_id = 'amap-15m';

UPDATE public.multitrade_favorites
SET trade_config    = '${JSON.stringify(tc15).replace(/'/g, "''")}'::jsonb,
    entry_rsi       = '{"interval":"15m","operator":"<","value":40,"period":14}'::jsonb,
    exit_rsi        = '{"interval":"1h","operator":">","value":70,"period":14}'::jsonb,
    ma_conditions   = '[{"mode":"strict_above","period":50,"interval":"1h","fixedDipPct":null,"aboveMaEnabled":false}]'::jsonb,
    rule_3_candles  = FALSE,
    rule_4_candles  = FALSE,
    updated_at      = NOW()
WHERE symbol = 'HEIUSDT' AND strategy_id = 'amap-15m';

-- ── amap-1h (id 99) ────────────────────────────────────────────────────────
UPDATE public.rsi_multi_bot_state
SET trade_config = '${JSON.stringify(tc1h).replace(/'/g, "''")}'::jsonb,
    updated_at   = NOW()
WHERE id = 99 AND symbol = 'HEIUSDT' AND strategy_id = 'amap-1h';

UPDATE public.multitrade_favorites
SET trade_config    = '${JSON.stringify(tc1h).replace(/'/g, "''")}'::jsonb,
    entry_rsi       = '{"interval":"1h","operator":"<","value":38,"period":14}'::jsonb,
    exit_rsi        = '{"interval":"1h","operator":">","value":65,"period":14}'::jsonb,
    ma_conditions   = '[{"mode":"adaptive","period":50,"interval":"4h","fixedDipPct":6,"aboveMaCandles":1,"aboveMaEnabled":true}]'::jsonb,
    rule_3_candles  = FALSE,
    rule_4_candles  = FALSE,
    updated_at      = NOW()
WHERE symbol = 'HEIUSDT' AND strategy_id = 'amap-1h';

COMMIT;

-- Verificar
SELECT id, symbol, strategy_id, trade_config->>'label' AS label,
       trade_config->'rule1'->'entryRsi'->>'value' AS rsi_entry,
       trade_config->'rule1'->'extension'->>'enabled' AS extension_on,
       jsonb_array_length(trade_config->'maFilters') AS ma_filters
FROM public.rsi_multi_bot_state
WHERE symbol = 'HEIUSDT'
ORDER BY strategy_id;
`;

const outDir = path.join(__dirname, '..');
fs.writeFileSync(path.join(outDir, 'migration-heiusdt-trade-config.sql'), sql);
fs.writeFileSync(path.join(outDir, 'heiusdt-trade-config-15m.json'), JSON.stringify(tc15, null, 2));
fs.writeFileSync(path.join(outDir, 'heiusdt-trade-config-1h.json'), JSON.stringify(tc1h, null, 2));
console.log('Written migration-heiusdt-trade-config.sql');

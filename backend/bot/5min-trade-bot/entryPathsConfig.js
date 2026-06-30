'use strict';

const DEFAULT_ENTRY_PATHS = {
  rsi:     { enabled: true },
  ma50_5m: { enabled: true, trigger: 'touch', tolerancePct: 0.5 },
  combine: 'any', // any = OR · all = AND (quando os dois ativos)
  pathCooldownHours: 2,
  pathCooldownSource: 'ma', // 'rsi' | 'ma' — qual mediana histórica define o período
};

function clampMa5mTolerancePct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_ENTRY_PATHS.ma50_5m.tolerancePct;
  return Math.max(0.1, Math.min(3, parseFloat(n.toFixed(2))));
}

function clampPathCooldownHours(raw) {
  const h = Number(raw);
  if (!Number.isFinite(h) || h <= 0) return DEFAULT_ENTRY_PATHS.pathCooldownHours;
  return Math.max(0.5, Math.min(48, parseFloat(h.toFixed(1))));
}

function normalizeEntryPaths(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      rsi:     { ...DEFAULT_ENTRY_PATHS.rsi },
      ma50_5m: { ...DEFAULT_ENTRY_PATHS.ma50_5m },
      combine: DEFAULT_ENTRY_PATHS.combine,
      pathCooldownHours: DEFAULT_ENTRY_PATHS.pathCooldownHours,
      pathCooldownSource: DEFAULT_ENTRY_PATHS.pathCooldownSource,
    };
  }
  const trigger = raw.ma50_5m?.trigger === 'cross_up' ? 'cross_up' : 'touch';
  return {
    rsi:     { enabled: raw.rsi?.enabled !== false },
    ma50_5m: {
      enabled: raw.ma50_5m?.enabled !== false,
      trigger,
      tolerancePct: clampMa5mTolerancePct(raw.ma50_5m?.tolerancePct),
    },
    combine: raw.combine === 'all' ? 'all' : 'any',
    pathCooldownHours: clampPathCooldownHours(raw.pathCooldownHours ?? DEFAULT_ENTRY_PATHS.pathCooldownHours),
    pathCooldownSource: raw.pathCooldownSource === 'rsi' ? 'rsi' : 'ma',
  };
}

function entryPathsLabel(cfg) {
  const n = normalizeEntryPaths(cfg);
  const parts = [];
  if (n.rsi.enabled) parts.push('RSI');
  if (n.ma50_5m.enabled) {
    const tol = n.ma50_5m.trigger === 'touch' ? ` ±${n.ma50_5m.tolerancePct}%` : '';
    parts.push(`MA50 5m (${n.ma50_5m.trigger}${tol})`);
  }
  if (!parts.length) return 'nenhum';
  if (parts.length === 2) {
    return `${parts.join(n.combine === 'all' ? ' + ' : ' ou ')}`;
  }
  return parts[0];
}

function hasEntryPath(cfg) {
  const n = normalizeEntryPaths(cfg);
  return n.rsi.enabled || n.ma50_5m.enabled;
}

function pathCooldownMs(cfg) {
  const n = normalizeEntryPaths(cfg);
  return n.pathCooldownHours * 3_600_000;
}

/** Após entrada por um caminho (OR), bloqueia o outro até pathCooldownHours. */
function applyPathAlternationCooldown(cfg, signal, { lastEntryPath, lastBuyTime } = {}) {
  if (!signal) return signal;
  const n = normalizeEntryPaths(cfg);
  if (n.combine !== 'any' || !n.rsi.enabled || !n.ma50_5m.enabled) return signal;
  if (!lastEntryPath || !lastBuyTime) return signal;

  const cooldownMs = pathCooldownMs(n);
  const elapsed    = Date.now() - new Date(lastBuyTime).getTime();
  if (elapsed >= cooldownMs) return signal;

  const blockedPath = lastEntryPath === 'rsi' ? 'ma50_5m' : 'rsi';
  const allowedPath = lastEntryPath;

  if (signal.rsiSignal && signal.maSignal) {
    if (allowedPath === 'rsi' && signal.rsiSignal) {
      return { ...signal, ok: true, path: 'rsi', maSignal: signal.maSignal };
    }
    if (allowedPath === 'ma50_5m' && signal.maSignal) {
      return { ...signal, ok: true, path: 'ma50_5m', rsiSignal: signal.rsiSignal };
    }
  }

  if (signal.path === blockedPath) {
    if (allowedPath === 'rsi' && signal.rsiSignal) {
      return { ...signal, ok: true, path: 'rsi' };
    }
    if (allowedPath === 'ma50_5m' && signal.maSignal) {
      return { ...signal, ok: true, path: 'ma50_5m' };
    }
    return {
      ...signal,
      ok: false,
      path: null,
      reason: 'path_cooldown',
      blockedPath,
      remainingMs: Math.max(0, cooldownMs - elapsed),
    };
  }
  return signal;
}

module.exports = {
  DEFAULT_ENTRY_PATHS,
  normalizeEntryPaths,
  entryPathsLabel,
  hasEntryPath,
  pathCooldownMs,
  applyPathAlternationCooldown,
  clampPathCooldownHours,
  clampMa5mTolerancePct,
};

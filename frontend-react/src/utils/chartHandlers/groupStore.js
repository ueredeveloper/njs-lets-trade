/**
 * Store genérico de "grupos" de um manipulador de indicador do gráfico — generalização direta de
 * makeBbGroup / defaultBbGroups / loadBbGroups / saveBbGroups (CandlestickChart.jsx). Cada
 * manipulador convertido pro padrão Bollinger/EMA (caixa com título + ON por grupo + × + "+ nome")
 * é dirigido por um descriptor (ver descriptors.js) e ganha um store destes.
 *
 * Persistência: localStorage direto, uma chave por manipulador (`descriptor.storageKey`), igual
 * bbGroups/quickEmaGroups. NÃO passa por uiPreferences.js/CurrencyContext.
 */

function coerceOption(options, raw, fallback) {
  if (!Array.isArray(options)) return raw === undefined ? fallback : raw;
  const numeric = options.every((o) => typeof o === 'number');
  const v = numeric ? Number(raw) : raw;
  return options.includes(v) ? v : fallback;
}

export function makeGroupStore(descriptor) {
  const {
    id,
    max = 4,
    storageKey,
    autoGroupIds = [],
    fields = [],
    flags = [],
  } = descriptor;

  const fieldDefaults = () => {
    const o = {};
    for (const f of fields) o[f.key] = typeof f.default === 'function' ? f.default() : f.default;
    return o;
  };
  const flagDefaults = () => {
    const o = {};
    for (const fl of flags) o[fl.key] = !!fl.default;
    return o;
  };

  function makeGroup(overrides) {
    return {
      id: `${id}${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      ...fieldDefaults(),
      ...flagDefaults(),
      ...overrides,
    };
  }

  function sanitize(g, i = 0) {
    const fd = fieldDefaults();
    const gd = flagDefaults();
    const out = { id: (typeof g?.id === 'string' && g.id) ? g.id : `${id}${i + 1}` };
    for (const f of fields) {
      out[f.key] = typeof f.normalize === 'function'
        ? f.normalize(g?.[f.key])
        : coerceOption(f.options, g?.[f.key], fd[f.key]);
    }
    for (const fl of flags) {
      out[fl.key] = typeof g?.[fl.key] === 'boolean' ? g[fl.key] : gd[fl.key];
    }
    // 3º arg = grupo CRU (pré-normalização) — deixa o descriptor migrar campos renomeados.
    return typeof descriptor.sanitize === 'function' ? descriptor.sanitize(out, i, g) : out;
  }

  /** 1º acesso sem nada salvo: um grupo só, tudo desligado (padrão defaultBbGroups). */
  function defaultGroups() {
    const off = {};
    for (const fl of flags) off[fl.key] = false;
    return [makeGroup(off)];
  }

  function save(groups) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify((groups ?? []).filter((g) => !autoGroupIds.includes(g.id))),
      );
    } catch { /* ignore */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) {
        const migrated = typeof descriptor.migrateFromLegacy === 'function'
          ? descriptor.migrateFromLegacy({ makeGroup, sanitize })
          : null;
        if (Array.isArray(migrated) && migrated.length) {
          const seeded = migrated.slice(0, max).map((g, i) => sanitize(g, i));
          save(seeded);
          return seeded;
        }
        return defaultGroups();
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return defaultGroups();
      return parsed.slice(0, max).map((g, i) => sanitize(g, i));
    } catch {
      return defaultGroups();
    }
  }

  return { descriptor, makeGroup, sanitize, defaultGroups, load, save };
}

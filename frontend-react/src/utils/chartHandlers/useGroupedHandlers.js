import { useState, useMemo } from 'react';

/**
 * Um hook só pra todos os manipuladores de indicador convertidos pro padrão "caixa de grupos"
 * (Bollinger/EMA). Colapsa dezenas de useState + useCallback num objeto:
 *
 *   const handlers = useGroupedHandlers(STORES);
 *   handlers.sr.groups            // array de grupos
 *   handlers.sr.add()             // adiciona um grupo (até descriptor.max)
 *   handlers.sr.remove(id)
 *   handlers.sr.update(id, patch) // patch passa pelo sanitize do store
 *   handlers.sr.toggleFlag(id, key)
 *   handlers.sr.setAutoGroup(g)   // grupo injetado (Estatísticas) — id fixo, nunca persiste
 *   handlers.sr.clearAutoGroup(id)
 *   handlers.sr.disableAll()      // troca de intervalo do gráfico
 *
 * Cada mutação faz setState + store.save(next) (mesmo padrão dos useCallback de bbGroups).
 *
 * @param {Record<string, ReturnType<import('./groupStore').makeGroupStore>>} stores
 */
export function useGroupedHandlers(stores) {
  const ids = useMemo(() => Object.keys(stores), [stores]);

  const [state, setState] = useState(() => {
    const o = {};
    for (const id of Object.keys(stores)) o[id] = stores[id].load();
    return o;
  });

  const handlers = useMemo(() => {
    const out = {};
    for (const id of ids) {
      const store = stores[id];
      const max = store.descriptor.max ?? 4;
      const mutate = (fn) => setState((prev) => {
        const cur = prev[id] ?? [];
        const nextGroups = fn(cur);
        if (nextGroups === cur) return prev;
        store.save(nextGroups);
        return { ...prev, [id]: nextGroups };
      });
      out[id] = {
        groups: state[id] ?? [],
        add: () => mutate((groups) => (groups.length >= max ? groups : [...groups, store.makeGroup()])),
        remove: (gid) => mutate((groups) => groups.filter((g) => g.id !== gid)),
        update: (gid, patch) => mutate((groups) => groups.map((g) => (g.id === gid ? store.sanitize({ ...g, ...patch }, 0) : g))),
        toggleFlag: (gid, key) => mutate((groups) => groups.map((g) => (g.id === gid ? { ...g, [key]: !g[key] } : g))),
        setAutoGroup: (group) => mutate((groups) => {
          const rest = groups.filter((g) => g.id !== group.id);
          return [store.sanitize(group, 0), ...rest].slice(0, max);
        }),
        clearAutoGroup: (gid) => mutate((groups) => groups.filter((g) => g.id !== gid)),
        disableAll: () => mutate((groups) => (groups.some((g) => g.enabled)
          ? groups.map((g) => (g.enabled ? { ...g, enabled: false } : g))
          : groups)),
      };
    }
    return out;
  }, [state, ids, stores]);

  return handlers;
}

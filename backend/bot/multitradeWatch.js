'use strict';

const registry = require('./multitradeRegistry');

const WATCH_MS = 5 * 60_000;

function watchTs() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map(x => [x.type, x.value]),
  );
  return `[${p.day}-${p.month}/${p.year} ${p.hour}:${p.minute}]`;
}

function orFilter(strategyIds, field) {
  return `(${strategyIds.map(id => `${field}.eq.${id}`).join(',')})`;
}

function configFingerprint(row) {
  if (!row) return '';
  const tc = typeof row.trade_config === 'string'
    ? row.trade_config
    : JSON.stringify(row.trade_config ?? {});
  return `${row.updated_at ?? ''}|${row.capital ?? ''}|${tc}`;
}

/**
 * Sincroniza bots com multitrade_favorites + rsi_multi_bot_state a cada 5 min.
 * - Moeda removida/desativada → para o loop (sem comprar nem vender).
 * - Moeda nova → inicia monitoramento.
 * - trade_config alterado no painel → atualiza estratégia em memória.
 */
async function runWatchCycle({
  sbReq,
  strategyIds,
  symbolFilter = null,
  resolveStrategy,
  onStartSymbol,
  log = console.log,
}) {
  if (!strategyIds?.length) return;

  const favQuery = `?or=${orFilter(strategyIds, 'strategy_id')}&enabled=eq.true&select=symbol,strategy_id,updated_at`;
  const stateQuery = `?or=${orFilter(strategyIds, 'strategy_id')}&select=*&order=id.asc`;

  let favorites = [];
  let states = [];
  try {
    favorites = await sbReq('GET', 'multitrade_favorites', null, favQuery) ?? [];
    states = await sbReq('GET', 'rsi_multi_bot_state', null, stateQuery) ?? [];
  } catch (err) {
    log(`⚠️  [multitrade-watch] erro ao ler Supabase: ${err.message}`);
    return;
  }

  const favKeys = new Set(
    favorites.map(f => registry.sessionKey(f.symbol, f.strategy_id)),
  );
  const stateByKey = new Map(
    states.map(s => [registry.sessionKey(s.symbol, s.strategy_id), s]),
  );

  const evaluated = favorites
    .filter(f => {
      const sym = f.symbol.toUpperCase();
      if (symbolFilter && sym !== symbolFilter) return false;
      return stateByKey.has(registry.sessionKey(f.symbol, f.strategy_id));
    })
    .map(f => f.symbol.toUpperCase())
    .sort();
  const ts = watchTs();
  if (!evaluated.length) {
    log(`${ts} 📋 Moedas avaliadas: (nenhuma)`);
  } else {
    log(`${ts} 📋 Moedas avaliadas (${evaluated.length}): ${evaluated.join(', ')}`);
  }

  // Remover / desativar
  for (const sess of registry.list()) {
    if (!strategyIds.includes(sess.strategyId)) continue;
    if (symbolFilter && sess.symbol.toUpperCase() !== symbolFilter) continue;
    if (favKeys.has(sess.key)) continue;

    log(`🛑 ${sess.symbol} [${sess.strategyId}] removido ou desativado no painel — encerrando`);
    try {
      await sess.stop({ reason: 'removed_from_panel' });
    } catch (err) {
      log(`❌ ${sess.symbol} [${sess.strategyId}] erro ao encerrar: ${err.message}`);
    }
    registry.unregister(sess.rowId);
  }

  // Atualizar config das sessões ativas
  for (const fav of favorites) {
    const key = registry.sessionKey(fav.symbol, fav.strategy_id);
    const state = stateByKey.get(key);
    if (!state) continue;

    const sess = registry.get(state.id);
    if (!sess?.updateFromRow) continue;

    const fp = configFingerprint(state);
    if (fp !== sess.configFingerprint) {
      try {
        sess.updateFromRow(state);
        sess.configFingerprint = fp;
      } catch (err) {
        log(`⚠️  ${state.symbol} [${state.strategy_id}] config: ${err.message}`);
      }
    }
  }

  // Novas moedas
  for (const fav of favorites) {
    const sym = fav.symbol.toUpperCase();
    if (symbolFilter && sym !== symbolFilter) continue;

    const key = registry.sessionKey(fav.symbol, fav.strategy_id);
    const state = stateByKey.get(key);
    if (!state) {
      log(`ℹ️  ${sym} [${fav.strategy_id}] no painel — aguardando sync em rsi_multi_bot_state`);
      continue;
    }
    if (registry.has(state.id)) continue;

    if (!resolveStrategy(state)) {
      log(`⚠️  ${sym} [${fav.strategy_id}] trade_config inválido — ignorado`);
      continue;
    }

    log(`➕ ${sym} [${fav.strategy_id}] adicionado no painel — iniciando`);
    onStartSymbol(state).catch(err => {
      log(`❌ ${sym} [${fav.strategy_id}] falha ao iniciar: ${err.message}`);
      registry.unregister(state.id);
    });
  }
}

function startMultitradeWatch(opts) {
  const run = () => runWatchCycle(opts).catch(err => {
    (opts.log ?? console.log)(`⚠️  [multitrade-watch] ${err.message}`);
  });

  logBanner(opts.log ?? console.log);
  run();
  setInterval(run, WATCH_MS);
}

function logBanner(log) {
  log(`🔄 Painel Multi-Trade: sync a cada ${WATCH_MS / 60_000} min (add/remove/config)`);
}

module.exports = {
  WATCH_MS,
  configFingerprint,
  runWatchCycle,
  startMultitradeWatch,
};

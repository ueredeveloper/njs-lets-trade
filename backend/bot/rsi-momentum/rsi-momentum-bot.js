'use strict';

/**
 * RSI Momentum Bot — DIFERENTE dos outros bots (bollinger-bands, ma-cross): o usuário não
 * favorita moeda nenhuma de antemão. Um scanner varre o mercado inteiro (ver marketScanner.js)
 * e, quando uma moeda dispara o sinal, o PRÓPRIO bot cria o favorito automaticamente e passa a
 * gerenciar aquela moeda. Quando o ciclo termina (comprou e vendeu, ou o pullback nunca
 * preencheu), o favorito é removido — a lista de favoritos rsi-momentum é sempre "moedas com
 * sinal ativo agora" (pending/comprada/falha), nunca uma lista curada manualmente.
 *
 *   1. RSI(14) do entry.interval (ex.: 15m) cruza para CIMA de entry.rsiThreshold (padrão 69,
 *      sobrecompra — aposta de CONTINUAÇÃO, não reversão) → sinal. Pullback opcional (ordem
 *      limite `belowPct`% abaixo do preço do sinal, padrão -0.5%) é avaliado minuto a minuto,
 *      não no candle do entry.interval — ver PULLBACK_INTERVAL em strategyEngine.js.
 *   2. Coloca bracket TP/SL resting na corretora logo após a compra confirmar (Binance: OCO
 *      real; Gate.io: emulado) a partir do preço de entrada. Alvo e stop podem ser FIXOS ou
 *      CONTÍNUOS (sobem em degraus com o pico de preço — exit.trailingStop / exit.trailingTarget);
 *      quando sobem de degrau, a perna correspondente da bracket é recriada (maybeReplaceTrailingStop).
 *      Não persegue banda/EMA como o bollinger-bands — os degraus são % sobre o preço de entrada.
 *
 * Fases persistidas em rsi_multi_bot_state.phase: WATCHING (transitório, só entre a criação da
 * linha e a primeira tentativa de entrada) → PENDING (ordem limite de pullback armada na
 * corretora, aguardando reteste) → BOUGHT (posição aberta) → some da lista quando fecha.
 * FAILED = tentativa de compra/ordem rejeitada pela corretora (ex.: saldo insuficiente) — fica
 * visível na lista com o motivo até ser removida manualmente (não tenta de novo sozinho, pra
 * não martelar a corretora repetindo o mesmo erro a cada ciclo).
 *
 * Mesmo esqueleto/infra do bollinger-bands-bot.js (compra/venda/OCO/persistência/reconciliação
 * de órfã — ver backend/bot/shared/*), sem os filtros específicos de banda
 * (medianTrendFilter/emaFilter/permFilter) nem a recriação de bracket por deriva.
 *
 * strategy_id: rsi-momentum
 *
 * Uso:
 *   node backend/bot/rsi-momentum/rsi-momentum-bot.js
 *   node backend/bot/rsi-momentum/rsi-momentum-bot.js --symbol BTCUSDT   (só gerencia essa
 *     moeda se ela já tiver uma linha pending/comprada — não restringe o scanner)
 *   node backend/bot/rsi-momentum/rsi-momentum-bot.js --verbose   (imprime uma linha por moeda
 *     analisada em cada ciclo do scanner — símbolo, motivo do bloqueio, RSI/limiar; sem a flag
 *     cada ciclo só imprime o resumo — ver marketScanner.js#scanMarketOnce)
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const registry = require('../multitradeRegistry');
const { startMultitradeWatch, configFingerprint } = require('../multitradeWatch');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, loadGlobalConfigBody } = require('./strategyPresets');
const { startMarketScanner } = require('./marketScanner');
const {
  getRequiredSpecs, evaluateEntrySignal, evaluateExit, computeBracketPrices,
  checkEntryLimitExpired, checkReentryCooldown, resolveTargetMode, computeAtrPct,
  evaluateReinforceLadder,
} = require('./strategyEngine');

// "Reforço no stop" (martingale) — trava de segurança do nº de reforços (o usuário pediu "sem
// limite"; isto só evita loop patológico numa queda livre). Quando falta saldo pra um novo
// aporte o bot NÃO liquida nada: segura a pilha e deixa o trade sair no alvo normalmente.
const REINFORCE_HARD_CAP = 40;

// Alvo "desligado" (exit.targetMode === 'off'): a OCO da corretora precisa das duas pernas, então
// coloca o TP num teto absurdo (+500%) — a Binance PRENDE (clamp) em ~+100% do preço médio e, na
// prática, a posição só sai pelo stop. Gate.io não tem esse filtro; o trigger fica parado inofensivo.
const OFF_TARGET_MULT = 6;
function bracketOrderTarget(buyPrice, liveTarget) {
  return liveTarget != null ? liveTarget : buyPrice * OFF_TARGET_MULT;
}
const { detectOrphanPosition } = require('../shared/orphanPosition');

// Componentes genéricos (compra/venda/execução/OCO), compartilhados com os outros bots de
// trade (bollinger-bands, ma-cross, vwap-bands) — ver backend/bot/shared/*.
const { buildAdapter, syncExchangeClocks } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const {
  createTradeExecution, entrySignalFields, resolveLastExitTime, resolveLastExitReason,
} = require('../shared/tradeExecution');
const { sendWhatsApp } = require('../whatsapp');

const BOT_LABEL = 'RSI-MOMENTUM';
const VOL_CACHE_MS = 5 * 60_000;
// Sinal (RSI cruzando no entry.interval, tipicamente 15m) só pode mudar uma vez por candle
// fechado — escanear a cada 60s martelava a Binance com ~800 klines calls/min (2 por símbolo:
// entry.interval + bandWidth 5m, pra ~400 pares USDT ativos) mesmo sem candle novo nenhum,
// estourando o peso de IP e causando ban 418. 5min alinha com o mesmo teto de polling adaptativo
// já usado pros outros bots em intervalos ≥15m (ver CLAUDE.md).
const SCAN_INTERVAL_MS = 5 * 60_000;
// Favorito é criado pelo próprio bot (sem form por moeda). O quanto investir por trade vem da
// config global (trade_config.capitalUsdt, editável em Configurações → RSI Momentum); este
// valor só é usado se a config não trouxer um capitalUsdt válido.
const DEFAULT_CAPITAL_USDT = 20;
const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';

const orphanWarnedKeys = new Set();

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', X = '\x1b[0m';
const COLORS = ['\x1b[94m','\x1b[93m','\x1b[95m','\x1b[96m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[34m','\x1b[97m','\x1b[90m'];

function nowFmt() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function makeLogger(symbol, strategyId, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-${strategyId}.txt`);
  const tag = `${symbol}/${strategyId}`;
  return function log(...args) {
    const msg    = `[${nowFmt()}] ${color}[${tag}]${X} ${args.join(' ')}`;
    const noAnsi = msg.replace(/\x1b\[[0-9;]*m/g, '');
    console.log(msg);
    try { fs.appendFileSync(logFile, noAnsi + '\n'); } catch {}
  };
}

/** Linhas resumíveis no boot: pending (ordem armada), comprada, ou watching (cooldown de
 *  reentrada em andamento — ver retireOrCooldown — ou o raro race condition entre o scanner
 *  criar a linha e a sessão rodar o 1º tick) — nunca FAILED (sem ordem ativa, não há nada a
 *  retomar). WATCHING entra aqui desde que retireOrCooldown passou a MANTER a linha (com
 *  rules_state.lastExitTime) durante o cooldown em vez de apagar — sem resumir essas linhas no
 *  boot, um restart no meio do cooldown deixava a moeda travada pra sempre: a linha sobrevive
 *  no banco (então o scanner nunca re-sinaliza aquele símbolo, ver loadTrackedSymbols), mas
 *  nenhuma sessão está rodando o tick() que eventualmente resolveria/apagaria ela. O bloco
 *  WATCHING do tick() já lida com os dois casos (cooldown ainda ativo ou sinal já sumiu),
 *  então resumir é seguro — self-resolve em 1 ciclo no caso raro, ou continua a espera de
 *  cooldown de onde parou no caso comum. */
async function loadResumableRows() {
  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?strategy_id=eq.rsi-momentum&phase=in.(WATCHING,PENDING,BOUGHT)&order=id.asc`);
  return rows ?? [];
}

/** Símbolos que já têm QUALQUER linha rsi-momentum (pending/comprada/falha) — usado pelo
 *  scanner de mercado pra não reavaliar/re-sinalizar quem já está sendo rastreado. */
async function loadTrackedSymbols() {
  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?strategy_id=eq.rsi-momentum&select=symbol`);
  return (rows ?? []).map(r => r.symbol);
}

/**
 * Cria o favorito + a linha de estado assim que o scanner de mercado encontra um sinal novo
 * (ver marketScanner.js). A partir daqui a moeda segue o ciclo normal do tick() — o próprio
 * bot decide, no primeiro tick, se compra a mercado, arma pullback ou falha.
 *
 * Self-heal: só chega aqui depois de loadTrackedSymbols() dizer que o símbolo NÃO tem linha em
 * rsi_multi_bot_state — então um 409 (duplicate key) no insert de multitrade_favorites só pode
 * ser um favorito órfão (sem estado correspondente), sobrado de um retireAutoFavorite anterior
 * que falhou no meio (ver comentário de ordem em retireAutoFavorite). Em vez de martelar esse
 * erro a cada ciclo do scanner pra sempre, apaga o órfão e tenta o insert de novo uma vez.
 */
async function createAutoFavorite(symbol) {
  const presetBody = await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID);
  const capitalUsdt = Number(presetBody?.capitalUsdt) > 0 ? Number(presetBody.capitalUsdt) : DEFAULT_CAPITAL_USDT;
  const favoritePayload = {
    user_id: DEFAULT_USER_ID, symbol, exchange: 'binance', strategy_id: 'rsi-momentum',
    enabled: true, capital: capitalUsdt, trade_config: presetBody,
  };
  try {
    await sbReq('POST', 'multitrade_favorites', favoritePayload);
  } catch (err) {
    if (!/\b409\b/.test(err.message) || !/duplicate key/i.test(err.message)) throw err;
    await sbReq('DELETE', 'multitrade_favorites', null, `?user_id=eq.${DEFAULT_USER_ID}&symbol=eq.${symbol}&strategy_id=eq.rsi-momentum`);
    await sbReq('POST', 'multitrade_favorites', favoritePayload);
  }
  const [row] = await sbReq('POST', 'rsi_multi_bot_state', {
    symbol, exchange: 'binance', strategy_id: 'rsi-momentum',
    initial_capital: capitalUsdt, capital: capitalUsdt,
    trade_config: presetBody, phase: 'WATCHING',
  });
  return row;
}

/** Remove o favorito automático (multitrade_favorites + rsi_multi_bot_state) e encerra a
 *  sessão — chamado quando o ciclo termina sem posição aberta: trade fechado (alvo/stop),
 *  pullback expirou sem preencher, ou o sinal não se confirmou mais no primeiro tick. A moeda
 *  volta pro "pool" — o scanner pode sinalizá-la de novo no futuro, do zero.
 *
 *  Exceção: moeda CURADA (rsi_multi_bot_state.curated = true — watchlist manual, ex.: SKYAI na
 *  Gate, que o scanner Binance nunca sinaliza; ver CLAUDE.md "Watchlist curada"). Nesse caso a
 *  linha NÃO é apagada nem a sessão encerrada: volta pra WATCHING e segue vigiando o próximo
 *  sinal indefinidamente (a linha WATCHING é retomada no boot — loadResumableRows).
 *
 *  Ordem importa: apaga multitrade_favorites PRIMEIRO. Não há transação entre os dois deletes
 *  (2 tabelas, 2 requests), então se um falhar depois de retentado (ver RETRYABLE_METHODS em
 *  supabaseRest.js) o órfão que sobra precisa ser o inofensivo — rsi_multi_bot_state sozinho
 *  ainda marca o símbolo como "tracked" pro loadTrackedSymbols, então o scanner não tenta
 *  recriar o sinal. Na ordem inversa (usada até a v1.111.0) o órfão era o favorito, e o
 *  scanner martelava POST duplicado (409) nesse símbolo a cada ciclo, pra sempre. */
async function retireAutoFavorite({ rowId, symbol, log, stopSelf, reason, session }) {
  if (session?.curated) {
    if (reason) log(`↩️  ${symbol} (curada) — ${reason}; volta a vigiar (linha mantida, sem remover do pool)`);
    // Preserva só o carimbo da última venda (cooldown de reentrada sobrevive a um restart no
    // meio do cooldown); descarta o resto do rules_state (entryLimit, exitBracket, reforce…).
    const keep = {};
    if (session.lastExitTime) keep.lastExitTime = session.lastExitTime;
    if (session.lastExitReason) keep.lastExitReason = session.lastExitReason;
    session.phase = 'WATCHING';
    session.rulesState = null;
    await saveState(rowId, { phase: 'WATCHING', rules_state: keep }, log);
    return { phase: 'WATCHING' };
  }
  if (reason) log(`🗑️  ${symbol} removido do favorito automático (${reason})`);
  try {
    await sbReq('DELETE', 'multitrade_favorites', null, `?symbol=eq.${symbol}&strategy_id=eq.rsi-momentum`);
  } catch (err) {
    log(`${Y}⚠️  Falha ao remover favorito automático: ${err.message}${X}`);
  }
  try {
    await sbReq('DELETE', 'rsi_multi_bot_state', null, `?id=eq.${rowId}`);
  } catch (err) {
    log(`${Y}⚠️  Falha ao remover estado do favorito automático: ${err.message}${X}`);
  }
  if (stopSelf) await stopSelf();
  return { phase: 'RETIRED' };
}

/**
 * Chamado nos 3 pontos em que um trade acabou de FECHAR (alvo/stop/venda externa) — diferente
 * de "pullback expirou"/"sinal sumiu" (que retiram direto, sem cooldown a proteger: nenhuma
 * venda aconteceu ali). Só retira (apaga a linha) se NÃO há cooldown de reentrada pendente
 * (entry.reentryCooldownCandles, após QUALQUER venda) — com cooldown ativo, mantém a linha em
 * WATCHING (rules_state.lastExitTime já foi gravado por finalizeSell, ver tradeExecution.js) e
 * deixa o bloco WATCHING do tick() (linha ~424) aplicar checkReentryCooldown normalmente nos
 * próximos ciclos, só liberando a moeda de volta pro pool quando o cooldown expirar de verdade.
 *
 * Bug real que motivou isso: STORJUSDT 24/08/2026 — retireAutoFavorite apagava a linha (e o
 * lastExitTime junto) no exato momento em que o stop fechava, então o scanner (que só pula
 * símbolos com linha em rsi_multi_bot_state) recriava um favorito do ZERO no ciclo seguinte
 * (~1min depois), sem nenhuma memória do cooldown configurado — comprou de novo no mesmo sinal
 * ~2min depois do 1º stop, também levando stop.
 */
async function retireOrCooldown({ rowId, symbol, log, stopSelf, reason, config, cMap, state, session }) {
  const lastExitTime = resolveLastExitTime(state, session);
  const lastExitReason = resolveLastExitReason(state, session);
  const cooldown = checkReentryCooldown(config, cMap, lastExitTime, lastExitReason);
  if (cooldown.waiting) {
    log(`⏸️  ${symbol} fechado (${reason}) — cooldown de reentrada: ${cooldown.have}/${cooldown.need} candles ${cooldown.interval}, aguardando antes de voltar pro pool`);
    return { phase: 'WATCHING', reentryCooldown: cooldown };
  }
  return retireAutoFavorite({ rowId, symbol, log, stopSelf, reason, session });
}

/** Marca a linha como FAILED (visível na lista, com o motivo) e encerra a sessão — não tenta
 *  de novo sozinho (ex.: saldo insuficiente continuaria falhando a cada tick, martelando a
 *  corretora). Fica registrada até o usuário remover manualmente. */
async function markFailed({ rowId, session, log, symbol, strategyId, message, stopSelf, signal }) {
  session.phase = 'FAILED';
  session.rulesState = { ...(session.rulesState ?? {}), entryFailure: { message, at: new Date().toISOString() } };
  // signal (quando a falha acontece depois do sinal já confirmado) grava entry_signal_time/price
  // JÁ aqui — sem isso o gráfico não tem o candle do sinal pra desenhar a seta em trades FAILED
  // que nunca chegaram a passar pela fase PENDING (ver entrySignalFields em tradeExecution.js).
  const signalFields = signal
    ? entrySignalFields({ signalOpenTime: signal.signalOpenTime, signalPrice: signal.close })
    : {};
  await saveState(rowId, { phase: 'FAILED', rules_state: session.rulesState, ...signalFields }, log);
  log(`${R}❌ Entrada falhou (${symbol}): ${message}${X}`);
  sendWhatsApp(`❌ ${BOT_LABEL} ${symbol}\nFalha ao entrar: ${message}\nA moeda fica marcada como "falha" na lista — não vou tentar de novo sozinho.`);
  if (stopSelf) await stopSelf();
  return { phase: 'FAILED' };
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  if (x < 0.01) return x.toFixed(6);
  if (x < 1) return x.toFixed(4);
  return x.toFixed(2);
}

/** Imprime no boot as regras vigentes (config global lida de rsi_momentum_global_config, ou o
 *  preset estático se o usuário nunca abriu o formulário — ver loadGlobalConfigBody) pra ficar
 *  claro no log qual pullback/cooldown/alvo/stop o scanner vai aplicar nos próximos sinais, sem
 *  precisar abrir o painel. Config lida só uma vez aqui (snapshot do boot) — o scanner relê a
 *  cada ciclo por conta própria (ver main()#loadConfig), então mudanças salvas depois valem sem
 *  reiniciar mesmo sem aparecer de novo neste log. */
function logStartupConfig(body, source = null) {
  const e = body.entry, x = body.exit, sl = body.stopLoss;
  const bw = e.bandWidth, pb = e.pullback, r5 = e.rsi5mFilter, ec = e.earlyConfirm;
  const pr = e.priorRsiFilter, macd = e.macdFilter, hr = e.higherRsiFilter, sr = e.supportResistance;
  const ts = x.trailingStop, tt = x.trailingTarget, htp = x.hardTakeProfit, rf = x.reinforceOnStop;
  const tsMode = ['continuous', 'twoPhase', 'peakTrail', 'atrTrail'].includes(ts?.mode) ? ts.mode : 'continuous';
  const ON = (v) => (v ? '✅ LIGADO ' : '⬜ desligado');

  console.log('📋 Config ativa (RSI Momentum):');
  if (source) console.log(`   Fonte: ${source}`);

  console.log('  ── ENTRADA ──────────────────────────────────');
  console.log(`   Investir por trade: ${Number(body.capitalUsdt ?? 20).toFixed(2)} USDT a mercado`);
  console.log(`   Sinal: RSI(14) ${e.interval} cruza para cima de ${e.rsiThreshold}  (${e.enabled ? 'ATIVO' : 'PAUSADO — só gerencia posições já abertas'})`);
  console.log(`   ${ON(pr?.enabled !== false)} Filtro anti-repique: os ${pr?.count ?? 3} valores de RSI anteriores ao cruzamento precisam estar <= ${e.rsiThreshold}`);
  console.log(`   ${ON(ec?.enabled)} Confirmação adiantada: checkpoint de ${ec?.interval ?? '5m'} dentro do candle de ${e.interval} em formação, RSI provisório ≥ ${Math.max(e.rsiThreshold, Number(ec?.rsiThreshold ?? e.rsiThreshold))} (não espera fechar)`);
  console.log(pb.enabled
    ? `   ${ON(true)} Pullback: -${pb.belowPct}% do preço do sinal, ordem limite espera até ${e.limitWaitCandles} candles de 1min por reteste`
    : `   ${ON(false)} Pullback — compra a mercado assim que o sinal confirma`);

  console.log('  ── FILTROS DE ENTRADA ───────────────────────');
  console.log(`   ${ON(bw.enabled)} Largura de banda: ${bw.interval} BB(${bw.period},${bw.stdDev}) — valorização média dos ciclos >= ${bw.minPct}% (lookback ${bw.lookback})`);
  console.log(`   ${ON(!!r5?.enabled)} RSI 5min: RSI(14) do candle de 5m fechado no sinal > ${r5?.threshold ?? 70}`);
  console.log(`   ${ON(!!macd?.enabled)} MACD: histograma (12,26,9) em ${macd?.interval ?? '1h'} precisa estar POSITIVO`);
  console.log(`   ${ON(!!hr?.enabled)} RSI 1h (multi-timeframe): RSI(14) do candle de 1h fechado >= ${hr?.minRsi ?? 50}`);
  console.log(`   ${ON(!!sr?.enabled)} Suporte/Resistência: ${sr?.interval ?? '4h'} janela ${sr?.candleCount ?? 50} candles`);
  if (sr?.enabled) {
    console.log(`             entrada: só até ${sr.entryMaxPct}% acima do ${sr.entrySupportRank}º suporte abaixo do preço (filtro de desconto)`);
    console.log(`             saída:   alvo = ${sr.exitResistanceRank}ª resistência acima do preço de entrada (sobrepõe o modo de alvo)`);
  }

  console.log('  ── SAÍDA · ALVO ─────────────────────────────');
  const targetDesc = x.targetMode === 'off'
    ? 'DESLIGADO — sem alvo %; a posição sai pelo teto de lucro, pela resistência do S/R ou pelo stop'
    : x.targetMode === 'continuous'
      ? `contínuo — começa em +${x.restingBracket.targetPct}% e sobe ${tt.stepPct}pp a cada ${tt.coinStepPct}% de novo pico (deixa o lucro correr)`
      : `fixo +${x.restingBracket.targetPct}% acima da entrada`;
  console.log(`   Modo do alvo: ${targetDesc}`);
  console.log(`   ${ON(!!htp?.enabled)} Teto de lucro: venda FORÇADA ao tocar +${htp?.pct ?? 15}% (garante a saída em altas que revertem)`);
  console.log(`   Ordem resting na corretora (OCO/bracket): ${x.restingBracket.enabled ? 'LIGADA' : 'DESLIGADA — saída só pelo fallback via candle fechado'}`);

  console.log('  ── SAÍDA · STOP ─────────────────────────────');
  let stopDesc;
  if (!ts?.enabled) {
    stopDesc = `FIXO -${sl.maxLossPct}% abaixo da entrada${sl.enabled ? '' : '  (stopLoss DESLIGADO — sem stop!)'}`;
  } else if (tsMode === 'twoPhase') {
    const lucro = ts.pivotPct === 0 ? 'empate (breakeven)' : `${ts.pivotPct > 0 ? '+' : ''}${ts.pivotPct}% de lucro`;
    stopDesc = `Escada Dupla (twoPhase) — inicial -${ts.startPct}%; fase A +${ts.aStopStepPct}pp a cada +${ts.aCoinStepPct}% até travar ${lucro}; fase B +${ts.bStopStepPct}pp a cada +${ts.bCoinStepPct}%. Nunca desce.`;
  } else if (tsMode === 'peakTrail') {
    stopDesc = `Trilha do Topo (peakTrail) — ${ts.wNearPct}% abaixo do pico até o pico ganhar +${ts.pivotGainPct}%, depois ${ts.wFarPct}% abaixo. Nunca desce.`;
  } else if (tsMode === 'atrTrail') {
    stopDesc = `Trilha ATR (atrTrail) — ${ts.wNearPct}% abaixo do pico até +${ts.pivotGainPct}%, depois ${ts.atrMult}× o ATR% travado na compra (teto ${ts.atrMaxPct}%). Nunca desce.`;
  } else {
    stopDesc = `contínuo linear — inicial -${ts.startPct}%, +${ts.stopStepPct}pp a cada +${ts.coinStepPct}% de novo pico. Nunca desce.`;
  }
  console.log(`   Modo do stop: ${stopDesc}`);
  console.log(`   ${ON(!!rf?.enabled)} Reforço no stop (MARTINGALE): ao bater o stop NÃO encerra — recompra a mercado e vira escada`);
  if (rf?.enabled) {
    console.log(`             +1 compra de ${Number(rf.buyUsd ?? 40).toFixed(2)} USDT a cada -${rf.addDropPct}% abaixo do último aporte`);
    console.log(`             vende TODA a pilha a mercado no 1º +${rf.exitRisePct}% acima do último aporte`);
    console.log(`             ⚠️  posição fica SEM stop de proteção depois de disparado · sem saldo p/ novo aporte: avisa e segura a pilha (não vende), trade sai no alvo normal · trava de segurança ${REINFORCE_HARD_CAP} degraus`);
    console.log(`             estado em rsi_multi_bot_state.rules_state.reinforce — retoma a escada no meio depois de um restart`);
  }

  console.log('  ── SCANNER / EXECUÇÃO ───────────────────────');
  console.log(`   Volume mín 24h: ${Number(body.volume.minVolumeUsdt).toLocaleString('pt-BR')} USDT (filtra o scan de mercado)`);
  console.log(`   Cooldown de reentrada: ${e.reentryCooldownCandles} candles ${e.interval} após QUALQUER venda`);
  console.log(`   Cooldown global entre entradas: ${body.entryCooldownHours}h`);
  console.log(`   Polling: ${body.polling.pollMs / 1000}s aguardando sinal · ${body.polling.fastPollMs / 1000}s com posição aberta · scan de mercado a cada ${SCAN_INTERVAL_MS / 60_000}min`);
}

function buildEntryReasonLines(config, entryMeta) {
  const lines = [`${entryMeta.entryDesc} @ ${fmtPrice(entryMeta.close)}`];
  if (config.entry?.bandWidth?.enabled && entryMeta.bandWidth?.avgWidthPct != null) {
    lines.push(`Largura de banda média: ${entryMeta.bandWidth.avgWidthPct}% (mín ${entryMeta.bandWidth.minPct}%)`);
  }
  if (config.entry?.rsi5mFilter?.enabled && entryMeta.rsi5m?.rsi5m != null) {
    lines.push(`RSI 5min: ${entryMeta.rsi5m.rsi5m.toFixed(2)} (mín ${entryMeta.rsi5m.threshold})`);
  }
  return lines;
}

// saveState/hasOpenPosition/resetOrphanPosition/parseRulesState/executeSell/recordBracketFill/
// recordBuyFill são genéricos — ver backend/bot/shared/tradeExecution.js.
const {
  saveState, hasOpenPosition, resetOrphanPosition,
  parseRulesState, executeSell, recordBracketFill, recordBuyFill,
} = createTradeExecution({
  botLabel: BOT_LABEL,
  buildReasonLines: buildEntryReasonLines,
});

/** Mensagem explicando que a Binance rejeitaria o alvo/stop calculado (longe demais do preço
 *  atual, filtro PERCENT_PRICE_BY_SIDE) e por isso o bot prendeu (clamp) o valor na borda
 *  permitida pra OCO ainda assim ser aceita — ver binancePlaceOcoSell. */
function describeClamp(bracket) {
  const parts = [];
  if (bracket.clamped?.stop) {
    parts.push(`stop ${fmtPrice(bracket.requestedStopPrice)} → ${fmtPrice(bracket.stopPrice)} (fora da distância máxima permitida pela Binance)`);
  }
  if (bracket.clamped?.target) {
    parts.push(`alvo ${fmtPrice(bracket.requestedTargetPrice)} → ${fmtPrice(bracket.targetPrice)} (fora da distância máxima permitida pela Binance)`);
  }
  return `Bracket colocada com ajuste: ${parts.join('; ')}`;
}

/** Alvo por linha de resistência do S/R (entry.supportResistance) travado no momento da compra —
 *  guardado em rules_state.srTargetPrice, atrelado ao buyPrice desta posição (srTargetForBuy) pra
 *  não reaproveitar um alvo de trade anterior. Devolve o preço ou null. */
function resolveSrTargetForBuy(rulesState, buyPrice) {
  const t = Number(rulesState?.srTargetPrice);
  const forBuy = Number(rulesState?.srTargetForBuy);
  if (!(t > 0) || !(buyPrice > 0)) return null;
  if (!Number.isFinite(forBuy) || Math.abs(forBuy - buyPrice) > buyPrice * 1e-6) return null;
  return t;
}

/** Persiste o alvo por resistência do S/R (de evaluateEntrySignal / entryMeta) atrelado ao preço
 *  de entrada — chamado logo após a compra confirmar, antes de placeInitialBracket. No-op se o
 *  filtro S/R está desligado ou não achou resistência acima. */
async function persistSrTarget({ rowId, session, log, entryMeta, buyPrice }) {
  const t = Number(entryMeta?.srTargetPrice ?? entryMeta?.sr?.srTargetPrice);
  if (!(t > 0) || !(buyPrice > 0)) return;
  session.rulesState = { ...(session.rulesState ?? {}), srTargetPrice: t, srTargetForBuy: buyPrice };
  await saveState(rowId, { rules_state: session.rulesState }, log);
  log(`${G}🎯 Alvo por resistência S/R travado em ${fmtPrice(t)} (+${(((t / buyPrice) - 1) * 100).toFixed(2)}%)${X}`);
}

const BRACKET_RETRY_ALERT_EVERY = 10;

/** Grava a falha em rules_state.exitBracketError (attempts/firstAt/lastAt) — o bloco BOUGHT do
 *  tick chama de novo com retry:true a cada ciclo enquanto exitBracket continuar null. */
async function recordBracketError({ rowId, session, log, symbol, strategyId, message, retry }) {
  const prev = session.rulesState?.exitBracketError ?? null;
  const attempt = (prev?.attempts ?? 0) + 1;
  const exitBracketError = {
    message, attempts: attempt,
    firstAt: prev?.firstAt ?? new Date().toISOString(),
    lastAt: new Date().toISOString(),
  };
  session.rulesState = { ...(session.rulesState ?? {}), exitBracket: null, exitBracketError };
  await saveState(rowId, { rules_state: session.rulesState }, log);
  log(`${Y}⚠️  Falha ao colocar bracket TP/SL (${message}) — tentativa ${attempt}${retry ? ', retry automático segue tentando' : ''}${X}`);
  if (attempt === 1 || attempt % BRACKET_RETRY_ALERT_EVERY === 0) {
    sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nFalha ao colocar bracket TP/SL na corretora (tentativa ${attempt}): ${message}\nPosição sem proteção na corretora — bot segue tentando automaticamente a cada tick; saída também depende do candle fechado (evaluateExit) enquanto isso.`);
  }
}

/**
 * Coloca a bracket TP/SL resting na corretora logo após a compra confirmar. Alvo e stop saem de
 * computeBracketPrices (fixos, contínuos ou alvo 'off') — recriada por maybeReplaceTrailingStop
 * quando um lado sobe de degrau.
 */
async function placeInitialBracket({ rowId, adapter, config, session, log, filledQty, buyPrice, peakPrice, symbol, strategyId, retry = false }) {
  if (!config.exit.restingBracket?.enabled) return;
  // Pico registrado junto da bracket — maybeReplaceTrailingStop recalcula o nível vigente a
  // partir dele pra decidir se subiu de degrau (ver lá). Logo após a compra o pico é o próprio
  // preço de entrada; no retry vindo do tick BOUGHT já vem o pico corrente.
  const peak = Number.isFinite(peakPrice) ? peakPrice : buyPrice;
  const srTargetPrice = resolveSrTargetForBuy(session.rulesState, buyPrice);
  const { targetPrice, stopPrice } = computeBracketPrices(config, buyPrice, peak, srTargetPrice);
  // Com alvo por resistência do S/R a bracket TEM alvo real (não é o teto absurdo do modo 'off').
  const targetOff = resolveTargetMode(config) === 'off' && srTargetPrice == null;
  if ((targetPrice == null && !targetOff) || stopPrice == null) {
    await recordBracketError({ rowId, session, log, symbol, strategyId, retry, message: 'alvo/stop indisponível' });
    return;
  }
  const prevError = session.rulesState?.exitBracketError ?? null;
  try {
    const bracket = await adapter.placeExitBracket(filledQty, bracketOrderTarget(buyPrice, targetPrice), stopPrice);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, peakPrice: peak, placedAt: new Date().toISOString() }, exitBracketError: null };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    const alvoDesc = targetOff ? 'alvo OFF (só stop)' : `alvo ${fmtPrice(bracket.targetPrice)}`;
    log(`${G}🎯 Bracket TP/SL colocada na corretora${retry ? ' (retry)' : ''} — ${alvoDesc} / stop ${fmtPrice(bracket.stopPrice)}${X}`);
    if (bracket.clamped && (bracket.clamped.stop || !targetOff)) {
      const clampMsg = describeClamp(bracket);
      log(`${Y}⚠️  ${clampMsg}${X}`);
      sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\n${clampMsg}`);
    }
    if (retry && prevError) {
      sendWhatsApp(`✅ ${BOT_LABEL} [${strategyId}] ${symbol}\nBracket TP/SL colocada na corretora após ${prevError.attempts} tentativa(s) falha(s) (primeira falha ${prevError.firstAt}).`);
    }
  } catch (err) {
    await recordBracketError({ rowId, session, log, symbol, strategyId, retry, message: err.message });
  }
}

/** Recria a bracket na corretora quando o STOP contínuo (exit.trailingStop) ou o ALVO contínuo
 *  (exit.targetMode === 'continuous') sobe de degrau — cada um com contador próprio, ver
 *  computeBracketPrices em strategyEngine.js. Nenhum dos dois contínuo → nada a recriar (níveis
 *  fixos).
 *
 *  Pra decidir "subiu de degrau" o nível VIGENTE é RECALCULADO com computeBracketPrices a partir
 *  do pico que ficou registrado quando a bracket foi colocada (exitBracket.peakPrice) e comparado
 *  com o nível recalculado no pico de agora — mesma função pura, sem arredondar. Assim, pico
 *  parado ⇒ os dois lados batem exatamente e nada é recriado. Comparar contra o preço que ficou
 *  resting (ou contra requestedStopPrice/requestedTargetPrice) era furado: esses passaram por
 *  roundToStep(tickSize) no ocoClient, e a diferença de até ~½ tick contra o `liveStop` cru
 *  sozinha já disparava cancel+recria a CADA tick, com a moeda imóvel. Bracket antiga sem
 *  peakPrice cai em buyPrice (uma recriação de catch-up e estabiliza). */
async function maybeReplaceTrailingStop({ rowId, adapter, config, session, log, exitBracket, buyPrice, buyQty, peakPrice, symbol, strategyId }) {
  const stopTrailingOn = !!config.exit.trailingStop?.enabled;
  const targetMode = resolveTargetMode(config);
  if (!stopTrailingOn && targetMode !== 'continuous') return;

  const srTargetPrice = resolveSrTargetForBuy(session.rulesState, buyPrice);
  const { targetPrice: liveTarget, stopPrice: liveStop } = computeBracketPrices(config, buyPrice, peakPrice, srTargetPrice);
  if (liveStop == null) return;

  const placedPeak = Number.isFinite(Number(exitBracket.peakPrice)) ? Number(exitBracket.peakPrice) : buyPrice;
  const { targetPrice: placedTarget, stopPrice: placedStop } = computeBracketPrices(config, buyPrice, placedPeak, srTargetPrice);

  // Só recria pra CIMA — todos os modos de computeTrailingStopPrice/computeTrailingTargetPrice são
  // monotônicos com o pico, então stop e alvo nunca devem descer; o `>` (em vez de Math.abs)
  // blinda contra ruído de ponto flutuante afrouxar a proteção na corretora. `* (1 + 1e-9)`
  // absorve o ruído da própria multiplicação de computeBracketPrices.
  const stopChanged = stopTrailingOn && Number.isFinite(placedStop)
    && liveStop > placedStop * (1 + 1e-9);
  const targetChanged = targetMode === 'continuous' && liveTarget != null
    && Number.isFinite(placedTarget) && liveTarget > placedTarget * (1 + 1e-9);
  if (!stopChanged && !targetChanged) return;

  const moved = stopChanged && targetChanged ? 'Stop e alvo contínuos subiram'
    : targetChanged ? 'Alvo contínuo subiu' : 'Stop contínuo subiu';

  let cancelled = false;
  try {
    await adapter.cancelExitBracket(exitBracket);
    cancelled = true;
    const bracket = await adapter.placeExitBracket(buyQty, bracketOrderTarget(buyPrice, liveTarget), liveStop);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, peakPrice, placedAt: new Date().toISOString() } };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    const alvoDesc = targetMode === 'off' ? 'alvo OFF' : fmtPrice(bracket.targetPrice);
    log(`${G}🔁 ${moved} de degrau — bracket recriada: alvo ${alvoDesc} / stop ${fmtPrice(bracket.stopPrice)}${X}`);
    if (bracket.clamped && (bracket.clamped.stop || targetMode !== 'off')) {
      const clampMsg = describeClamp(bracket);
      log(`${Y}⚠️  ${clampMsg}${X}`);
      sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\n${clampMsg}`);
    }
  } catch (err) {
    if (cancelled) {
      // A bracket antiga já foi cancelada na corretora antes da nova falhar — limpa exitBracket
      // pra o próximo tick cair no fallback de saída via candle (evaluateExit).
      session.rulesState = { ...(session.rulesState ?? {}), exitBracket: null };
      await saveState(rowId, { rules_state: session.rulesState }, log);
      log(`${Y}⚠️  Falha ao recriar bracket contínua (${err.message}) — bracket antiga já cancelada, voltando pra saída via candle${X}`);
      sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nStop/alvo contínuo subiu, mas falhou ao recriar a bracket na corretora (${err.message}). A bracket antiga já foi cancelada — posição sem proteção resting até o próximo tick conseguir recriar; saída também depende do candle fechado (evaluateExit) enquanto isso.`);
    } else {
      log(`${Y}⚠️  Falha ao recriar bracket contínua (${err.message}) — mantendo a atual${X}`);
    }
  }
}

/** true/false se há ordem de venda aberta na corretora pro símbolo — usado pra observar sem
 *  mexer quando a posição foi reconciliada com uma ordem externa já aberta (fora do painel). */
async function hasOpenSellOrder(adapter, log) {
  if (typeof adapter.getOpenOrders !== 'function') return true;
  try {
    const orders = await adapter.getOpenOrders();
    return Array.isArray(orders) && orders.some(o => String(o.side ?? '').toLowerCase() === 'sell');
  } catch (err) {
    log(`${Y}⚠️  Erro ao consultar ordens abertas (externalOrders): ${err.message}${X}`);
    return true;
  }
}

async function reconstructExternalExit(adapter, state) {
  if (typeof adapter.getOwnTrades !== 'function') return null;
  const trades = await adapter.getOwnTrades(50);
  const buyTimeMs = new Date(state.buy_time).getTime();
  const sells = trades.filter(t => t.side === 'sell' && t.time >= buyTimeMs);
  const qty = sells.reduce((s, t) => s + t.qty, 0);
  if (!(qty > 0)) return null;
  const usdtOut = sells.reduce((s, t) => s + t.qty * t.price, 0);
  return { soldQty: qty, usdtOut, exitPrice: usdtOut / qty };
}

async function fetchCandleMap(adapter, specs) {
  const maxLimits = {};
  for (const { interval, limit } of specs) {
    maxLimits[interval] = Math.max(maxLimits[interval] || 0, limit);
  }
  const fetchAll = () => Promise.all(
    Object.entries(maxLimits).map(async ([iv, lim]) => [iv, await adapter.fetchCandles(lim, iv)]),
  );
  let entries;
  try {
    entries = await fetchAll();
  } catch (err) {
    if (err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || /fetch failed/i.test(err.message)) {
      await new Promise(r => setTimeout(r, 2000));
      entries = await fetchAll();
    } else {
      throw err;
    }
  }
  return Object.fromEntries(entries);
}

// ── Tick ──────────────────────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, log, session, stopSelf) {
  const { config } = strategy;
  const specs = getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);

  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) return { phase: 'WATCHING' };

  const { symbol, strategy_id: strategyId, capital } = state;
  let phase = session.phase ?? state.phase;
  if (phase === 'BOUGHT' && !hasOpenPosition(state)) {
    return resetOrphanPosition(rowId, log, session, state, 'sem buy_qty/buy_price no Supabase');
  }
  if (session.phase === 'BOUGHT' && state.phase !== 'BOUGHT') {
    session.phase = state.phase;
    phase = state.phase;
  }

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase !== 'BOUGHT') {
    const orphanKey = `${symbol}|${strategyId}`;
    const liveCandles = cMap[config.entry.interval] ?? [];
    const lastPrice = liveCandles.length ? parseFloat(liveCandles[liveCandles.length - 1].close) : null;
    const orphan = await detectOrphanPosition({ adapter, lastPrice }).catch(() => null);
    if (orphan?.confident) {
      log(`${Y}⚠️  Posição órfã na corretora (${orphan.qty} ${symbol}, sem registro no Supabase) — reconciliando pela compra que os trades recentes confirmam...${X}`);
      const entryMeta = {
        entryDesc: 'posição órfã reconciliada (saldo na corretora sem registro no Supabase)',
        close: orphan.avgPrice, signalPrice: orphan.avgPrice, signalOpenTime: null, limitPrice: null,
      };
      const bought = await recordBuyFill({
        rowId, strategy, log, session, entryMeta, capital, strategyId, symbol,
        result: { filledQty: orphan.qty, quoteQty: orphan.qty * orphan.avgPrice, avgPrice: orphan.avgPrice },
      });
      if (bought && orphan.hasOpenOrders) {
        session.rulesState = { ...(session.rulesState ?? {}), externalOrders: true };
        await saveState(rowId, { rules_state: session.rulesState }, log);
        log(`${Y}⚠️  Ordem de venda já aberta na corretora pra ${symbol} — bot NÃO vai colocar bracket nem vender, só observando o saldo${X}`);
        sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nPosição órfã reconciliada, mas já existe ordem de venda aberta na corretora (fora do painel). Bot NÃO vai colocar bracket nem vender por conta própria — só observa o saldo até você fechar manualmente.`);
      } else if (bought) {
        await placeInitialBracket({
          rowId, adapter, config, session, log,
          filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
        });
        sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nPosição órfã detectada e reconciliada automaticamente (processo provavelmente caiu entre a compra e o registro). Preço médio ${fmtPrice(orphan.avgPrice)}, qty ${orphan.qty}.`);
      }
      return { phase: bought ? 'BOUGHT' : 'WATCHING' };
    }
    if (orphan && !orphan.confident && !orphanWarnedKeys.has(orphanKey)) {
      orphanWarnedKeys.add(orphanKey);
      log(`${Y}⚠️  Saldo inesperado na corretora (${orphan.qty} ${symbol}) sem trade recente confirmando a origem — NÃO reconciliado automaticamente, confira manualmente${X}`);
      sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nSaldo inesperado na corretora (${orphan.qty}) sem trade recente (24h) confirmando a origem — não reconciliei sozinho pra não adotar uma posição que pode não ser do bot. Confira manualmente.`);
    }

    const lastExitTime = resolveLastExitTime(state, session);
    const lastExitReason = resolveLastExitReason(state, session);
    const cooldown = checkReentryCooldown(config, cMap, lastExitTime, lastExitReason);
    if (cooldown.waiting) {
      // Standby de reentryCooldownCandles candles do entry.interval após QUALQUER venda (alvo,
      // stop ou manual) — sem isso um take-profit rápido reentra minutos depois com o RSI
      // ainda perto do threshold, sem esfriar o momentum.
      return { phase: 'WATCHING', reentryCooldown: cooldown };
    }

    const rulesWatch = { ...parseRulesState(state), ...(session.rulesState ?? {}) };

    // Ordem limite GTC já armada no sinal: espera fill (reteste, checado minuto a minuto) ou
    // expira após limitWaitCandles candles de 1m — ver checkEntryLimitExpired.
    if (rulesWatch.entryLimit && typeof adapter.pollRestingLimitBuy === 'function') {
      let poll;
      try {
        poll = await adapter.pollRestingLimitBuy(rulesWatch.entryLimit);
      } catch (err) {
        log(`${Y}⚠️  Erro ao consultar ordem limite de entrada: ${err.message}${X}`);
        return { phase: 'WATCHING' };
      }

      if (poll.filled) {
        log(`${G}✅ Limite @ ${fmtPrice(rulesWatch.entryLimit.price)} preenchida (pullback)${X}`);
        const bought = await recordBuyFill({
          rowId, strategy, log, session,
          entryMeta: rulesWatch.entryLimit.entryMeta ?? {
            entryDesc: rulesWatch.entryLimit.entryDesc,
            close: poll.avgPrice,
            limitPrice: rulesWatch.entryLimit.price,
            signalOpenTime: rulesWatch.entryLimit.signalOpenTime,
            signalPrice: rulesWatch.entryLimit.signalPrice,
          },
          capital, strategyId, symbol,
          result: { filledQty: poll.filledQty, quoteQty: poll.quoteQty, avgPrice: poll.avgPrice },
        });
        if (bought) {
          await persistSrTarget({
            rowId, session, log, buyPrice: bought.avgPrice,
            entryMeta: rulesWatch.entryLimit.entryMeta,
          });
          await placeInitialBracket({
            rowId, adapter, config, session, log,
            filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
          });
        }
        return { phase: bought ? 'BOUGHT' : 'WATCHING' };
      }

      const expiry = checkEntryLimitExpired(config, cMap, rulesWatch.entryLimit);
      if (expiry.expired || poll.open === false) {
        try {
          if (poll.open !== false) await adapter.cancelRestingLimitBuy(rulesWatch.entryLimit);
        } catch (err) {
          log(`${Y}⚠️  Falha ao cancelar limite expirada: ${err.message}${X}`);
        }
        const cancelReason = expiry.expired
          ? `${expiry.need} candles ${expiry.interval} sem fill` : `status ${poll.status}`;
        return retireAutoFavorite({ rowId, symbol, log, stopSelf, session, reason: `pullback não preencheu — ${cancelReason}` });
      }

      return { phase: 'WATCHING', entryLimit: { waiting: true, ...expiry } };
    }

    const signal = evaluateEntrySignal(config, cMap);
    if (!signal.allowed) {
      // Raríssimo (janela entre o scanner detectar e esta sessão rodar o 1º tick) — o sinal
      // não se confirma mais nesta checagem fresca. Sem posição/ordem nenhuma envolvida, só
      // devolve a moeda pro pool em vez de deixar uma linha WATCHING zumbi.
      return retireAutoFavorite({ rowId, symbol, log, stopSelf, session, reason: `sinal não se confirmou mais (${signal.reason})` });
    }

    // Sem pullback: compra a mercado assim que o sinal confirma (limitPrice null). Chama
    // adapter.marketBuy direto (em vez do executeBuy compartilhado) pra poder capturar a
    // mensagem de erro real (ex.: saldo insuficiente) e gravar em FAILED — executeBuy só
    // loga e devolve false, sem expor o motivo pro chamador.
    if (signal.limitPrice == null) {
      log(`${G}📍 Sinal (${signal.entryDesc}) — comprando ${parseFloat(capital).toFixed(2)} USDT a mercado${X}`);
      let buyResult;
      try {
        buyResult = await adapter.marketBuy(parseFloat(capital));
      } catch (err) {
        return markFailed({ rowId, session, log, symbol, strategyId, message: err.message, stopSelf, signal });
      }
      if (buyResult?.filled === false) {
        return markFailed({ rowId, session, log, symbol, strategyId, message: 'ordem a mercado não preenchida', stopSelf, signal });
      }
      const bought = await recordBuyFill({
        rowId, strategy, log, session,
        entryMeta: { ...signal, signalPrice: signal.close, limitPrice: null },
        capital, strategyId, symbol, result: buyResult,
      });
      if (bought) {
        await persistSrTarget({ rowId, session, log, buyPrice: bought.avgPrice, entryMeta: signal });
        await placeInitialBracket({
          rowId, adapter, config, session, log,
          filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
        });
      }
      return { phase: bought ? 'BOUGHT' : 'FAILED' };
    }

    // Com pullback: arma ordem limite GTC no preço do sinal − belowPct%, esperando reteste
    // minuto a minuto (fill checado a cada tick de polling.pollMs, tipicamente 1min). Se a
    // corretora rejeitar a ordem (ex.: saldo insuficiente), marca FAILED — sem fallback pra
    // compra bloqueante (o mesmo motivo da rejeição provavelmente rejeitaria de novo).
    let handle;
    try {
      handle = await adapter.placeRestingLimitBuy(parseFloat(capital), signal.limitPrice);
    } catch (err) {
      return markFailed({ rowId, session, log, symbol, strategyId, message: err.message, stopSelf, signal });
    }
    const waitN = config.entry.limitWaitCandles ?? 20;
    const entryLimit = {
      ...handle,
      price: handle.price ?? signal.limitPrice,
      placedAt: new Date().toISOString(),
      signalOpenTime: signal.signalOpenTime,
      signalPrice: signal.close,
      entryDesc: signal.entryDesc,
      entryMeta: { ...signal, signalPrice: signal.close },
    };
    session.rulesState = { entryLimit };
    // entry_signal_time/price precisam ser gravados JÁ aqui (candle do cruzamento RSI, não o
    // candle da compra) — é o que o gráfico usa pra desenhar a seta do sinal (ver
    // multitradeChart.js) enquanto a moeda ainda está PENDING, antes do pullback preencher.
    await saveState(rowId, {
      phase: 'PENDING',
      rules_state: session.rulesState,
      ...entrySignalFields({ signalOpenTime: signal.signalOpenTime, signalPrice: signal.close }),
    }, log);
    log(`${G}📍 Sinal (${signal.entryDesc}) — limite GTC @ ${fmtPrice(entryLimit.price)} `
      + `armada (espera até ${waitN} candles de 1min p/ reteste)${X}`);

    const instant = await adapter.pollRestingLimitBuy(entryLimit);
    if (instant.filled) {
      log(`${G}✅ Limite preenchida na hora${X}`);
      const bought = await recordBuyFill({
        rowId, strategy, log, session,
        entryMeta: entryLimit.entryMeta,
        capital, strategyId, symbol,
        result: { filledQty: instant.filledQty, quoteQty: instant.quoteQty, avgPrice: instant.avgPrice },
      });
      if (bought) {
        await persistSrTarget({ rowId, session, log, buyPrice: bought.avgPrice, entryMeta: entryLimit.entryMeta });
        await placeInitialBracket({
          rowId, adapter, config, session, log,
          filledQty: bought.filledQty, buyPrice: bought.avgPrice, symbol, strategyId,
        });
      }
      return { phase: bought ? 'BOUGHT' : 'FAILED' };
    }
    return { phase: 'PENDING', entryLimit: { armed: true } };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  const rulesState = { ...parseRulesState(state), ...(session.rulesState ?? {}) };
  const buyPrice = state.buy_price ? parseFloat(state.buy_price) : null;

  // Escada de reforço ativa (ver handleReinforceLadder): a posição virou martingale — NÃO tem
  // bracket resting, tudo é gerido a partir de rules_state.reinforce, candle a candle. Retomada
  // depois de um restart cai aqui direto (o estado inteiro está no rules_state).
  if (rulesState.reinforce?.active) {
    return handleReinforceLadder({
      rowId, adapter, strategy, log, state, session, config, cMap, stopSelf, symbol, strategyId, rulesState,
    });
  }

  const srTargetPrice = resolveSrTargetForBuy(rulesState, buyPrice);

  // Posição com ordem de venda colocada fora do painel — bot só observa, nunca coloca bracket
  // nem vende a mercado por conta própria.
  if (rulesState.externalOrders) {
    const stillOpen = await hasOpenSellOrder(adapter, log);
    if (stillOpen) return { phase: 'BOUGHT' };

    const lastPriceExt = parseFloat((cMap[config.entry.interval] ?? []).at(-1)?.close ?? buyPrice);
    const balance = typeof adapter.getBaseBalance === 'function' ? await adapter.getBaseBalance().catch(() => null) : null;
    if (balance != null && lastPriceExt > 0 && balance * lastPriceExt >= 3) {
      return { phase: 'BOUGHT' };
    }

    const exitEst = (await reconstructExternalExit(adapter, state).catch(() => null))
      ?? { soldQty: parseFloat(state.buy_qty), usdtOut: parseFloat(state.buy_qty) * lastPriceExt, exitPrice: lastPriceExt };
    log(`${Y}⚠️  Ordem externa em ${symbol} sumiu do book e o saldo zerou — encerrando registro (venda feita fora do bot)${X}`);
    await recordBracketFill({
      rowId, strategy, log, state, session,
      exitResult: { reason: 'EXTERNAL_ORDER', exitDesc: 'Ordem de venda aberta direto na corretora (fora do painel)' },
      result: exitEst,
    });
    return retireOrCooldown({ rowId, symbol, log, stopSelf, config, cMap, state, session, reason: 'venda executada fora do bot' });
  }

  // Pico de preço desde a compra — alimenta o stop contínuo E o alvo contínuo (cada um com seu
  // contador de degraus), tanto pra recriar a bracket (maybeReplaceTrailingStop) quanto pro
  // fallback via candle (evaluateExit). Com stop e alvo fixos, computeBracketPrices ignora o
  // peakPrice — inofensivo rastrear sempre, mesmo padrão do bollinger-bands-bot.js.
  const storedPeak = rulesState.stopPeakPrice != null ? parseFloat(rulesState.stopPeakPrice) : buyPrice;
  const lastCandleNow = (cMap[config.entry.interval] ?? []).at(-1);
  const lastHighNow = lastCandleNow?.high != null ? parseFloat(lastCandleNow.high) : buyPrice;
  const peakPrice = Math.max(storedPeak ?? buyPrice, lastHighNow);
  if (peakPrice > (storedPeak ?? buyPrice) + 1e-12) {
    session.rulesState = { ...rulesState, stopPeakPrice: peakPrice };
    await saveState(rowId, { rules_state: session.rulesState }, log);
  }

  // Primeiro tick BOUGHT depois de um restart — mostra que a evolução do stop/alvo foi retomada
  // do rules_state (pico salvo + a OCO que ficou na corretora), não recomeçada do zero.
  if (session.resumedBought && !session.resumeLogged) {
    session.resumeLogged = true;
    const { targetPrice: resumeTarget, stopPrice: resumeStop } = computeBracketPrices(config, buyPrice, peakPrice, srTargetPrice);
    const peakGainPct = buyPrice > 0 ? ((peakPrice / buyPrice) - 1) * 100 : 0;
    const ocoNote = rulesState.exitBracket
      ? `OCO ${rulesState.exitBracket.orderListId ?? '(gate)'} ainda na corretora`
      : 'sem OCO resting (será recolocada)';
    log(`${G}🔁 Retomando trade — entrada ${fmtPrice(buyPrice)}, pico salvo ${fmtPrice(peakPrice)} (+${peakGainPct.toFixed(2)}%), `
      + `alvo ${resumeTarget == null ? 'OFF' : fmtPrice(resumeTarget)} / stop ${fmtPrice(resumeStop)} · ${ocoNote}${X}`);
  }

  // Stop contínuo modo 'atrTrail' — precisa do ATR% "do momento da compra". Calcula uma vez por
  // posição (no 1º tick BOUGHT em que dá), guarda em rules_state atrelado ao buyPrice desta
  // posição (stopAtrForBuy) pra não reaproveitar um ATR de trade anterior, e injeta em
  // config.exit.trailingStop.atrPct (ver computeTrailingStopPrice). Fora do modo atrTrail é ignorado.
  if (config.exit?.trailingStop?.enabled && config.exit.trailingStop.mode === 'atrTrail') {
    const sameBuy = rulesState.stopAtrForBuy != null && buyPrice != null
      && Math.abs(Number(rulesState.stopAtrForBuy) - buyPrice) < 1e-9;
    let atrPct = sameBuy && rulesState.stopAtrPct != null ? Number(rulesState.stopAtrPct) : null;
    if (!Number.isFinite(atrPct)) {
      atrPct = computeAtrPct(cMap[config.entry.interval] ?? []);
      if (Number.isFinite(atrPct)) {
        session.rulesState = { ...(session.rulesState ?? rulesState), stopAtrPct: atrPct, stopAtrForBuy: buyPrice };
        await saveState(rowId, { rules_state: session.rulesState }, log);
        log(`${G}📐 ATR% da compra travado em ${atrPct.toFixed(2)}% (stop Trilha ATR)${X}`);
      }
    }
    if (Number.isFinite(atrPct)) {
      config.exit = { ...config.exit, trailingStop: { ...config.exit.trailingStop, atrPct } };
    }
  }

  if (rulesState.exitBracket) {
    let bracketResult;
    try {
      bracketResult = await adapter.pollExitBracket(rulesState.exitBracket);
    } catch (err) {
      log(`${Y}⚠️  Erro ao consultar bracket TP/SL: ${err.message}${X}`);
      bracketResult = { filled: null };
    }

    if (bracketResult.filled) {
      const kind = bracketResult.filled;

      // Bateu o STOP e o "Reforço no stop" está ligado — em vez de encerrar, recompra a mercado
      // e vira escada de averaging-down (ver startReinforceLadder / handleReinforceLadder).
      if (kind === 'stop' && config.exit?.reinforceOnStop?.enabled) {
        return startReinforceLadder({
          rowId, adapter, strategy, log, state, session, config, cMap, stopSelf,
          symbol, strategyId, rulesState, bracketResult, buyPrice,
        });
      }

      const exitResult = {
        reason: kind === 'target' ? 'RSI_TARGET' : 'STOP_LOSS',
        targetLevelValue: kind === 'target' ? rulesState.exitBracket.targetPrice : rulesState.exitBracket.stopPrice,
        exitDesc: kind === 'target'
          ? (resolveTargetMode(config) === 'continuous'
            ? 'Bracket TP no alvo contínuo (ordem resting)'
            : 'Bracket TP no alvo fixo (ordem resting)')
          : (config.exit.trailingStop?.enabled ? 'Bracket SL no stop contínuo (ordem resting)' : 'Bracket SL no stop fixo (ordem resting)'),
      };
      await recordBracketFill({ rowId, strategy, log, state, session, exitResult, result: bracketResult });
      return retireOrCooldown({ rowId, symbol, log, stopSelf, config, cMap, state, session, reason: `trade fechado (${exitResult.reason})` });
    }

    // Recria a bracket se o stop contínuo e/ou o alvo contínuo subiu de degrau (cada um com
    // contador próprio). Níveis fixos → no-op.
    await maybeReplaceTrailingStop({
      rowId, adapter, config, session, log, symbol, strategyId,
      exitBracket: rulesState.exitBracket, buyPrice, buyQty: parseFloat(state.buy_qty), peakPrice,
    });
    return { phase: 'BOUGHT' };
  }

  // Sem bracket resting (desligada ou falhou ao colocar) — tenta de novo aqui a cada tick até
  // conseguir; enquanto isso, a saída cai no fallback via evaluateExit no candle em formação.
  if (config.exit.restingBracket?.enabled) {
    await placeInitialBracket({
      rowId, adapter, config, session, log, symbol, strategyId, buyPrice, peakPrice,
      filledQty: parseFloat(state.buy_qty), retry: true,
    });
  }

  const exitResult = evaluateExit(config, cMap, buyPrice, { peakPrice, srTargetPrice });
  if (!exitResult.exit) return { phase: 'BOUGHT' };

  // Fallback via candle bateu o STOP e o reforço está ligado — mesma bifurcação da bracket resting.
  if (exitResult.reason === 'STOP_LOSS' && config.exit?.reinforceOnStop?.enabled) {
    const lastPx = parseFloat((cMap[config.entry.interval] ?? []).at(-1)?.close ?? buyPrice);
    return startReinforceLadder({
      rowId, adapter, strategy, log, state, session, config, cMap, stopSelf,
      symbol, strategyId, rulesState, buyPrice,
      bracketResult: {
        filled: 'stop',
        soldQty: parseFloat(state.buy_qty),
        exitPrice: exitResult.stopFloor ?? lastPx,
        usdtOut: parseFloat(state.buy_qty) * (exitResult.stopFloor ?? lastPx),
      },
      viaCandle: true,
    });
  }

  try {
    await executeSell({
      rowId, adapter, strategy, log, state, exitResult, session,
      defaultReasonDesc: 'Alvo/stop fixo RSI Momentum',
    });
  } catch {
    return { phase: 'BOUGHT' };
  }
  return retireOrCooldown({ rowId, symbol, log, stopSelf, config, cMap, state, session, reason: `trade fechado (${exitResult.reason})` });
}

// ── Reforço no stop (escada de averaging-down / martingale) ────────────────────
//
// Quando a compra INICIAL bate o stop e exit.reinforceOnStop.enabled: em vez de encerrar, o bot
// recompra a mercado e passa a operar SEM bracket resting — só vigiando o candle. A cada nova
// queda de addDropPct% abaixo do último aporte adiciona mais uma compra do mesmo tamanho; a 1ª
// alta de exitRisePct% acima do último aporte vende TODA a pilha a mercado. Estado 100% em
// rules_state.reinforce → o bot retoma a escada no meio depois de um restart.
//
// Contabilidade (pra reusar finalizeSell sem tocar em tradeExecution.js): a linha
// rsi_multi_bot_state passa a refletir só as moedas AINDA EM CARTEIRA —
//   buy_qty  = soma das qty das pernas não vendidas
//   buy_price= heldCostUsd / buy_qty
//   buy_usdt = heldCostUsd + leg1RealizedLossUsd   (custo líquido: soma do custo das pernas em
//              carteira + a perda já realizada da perna 1 vendida no stop). finalizeSell faz
//              pnl = usdtOut(final) − buy_usdt → P&L agregado correto da operação inteira.

/** Dispara a escada: recompra a mercado a perna 2 e grava rules_state.reinforce. `bracketResult`
 *  traz o fill do stop (soldQty/usdtOut/exitPrice). `viaCandle` = saída detectada pelo candle
 *  (sem ordem resting) → a perna 1 NÃO foi vendida, continua na pilha. */
async function startReinforceLadder({ rowId, adapter, strategy, log, state, session, config, cMap, stopSelf, symbol, strategyId, rulesState, bracketResult, buyPrice, viaCandle = false }) {
  const rf = config.exit.reinforceOnStop;
  const leg1Sold = !viaCandle;
  // Valor de cada compra de reforço — config (exit.reinforceOnStop.buyUsd), com o aporte da
  // entrada como fallback. Congelado no rules_state.reinforce pra não mudar no meio da escada.
  const rungUsd = Number(rf.buyUsd) > 0 ? Number(rf.buyUsd) : parseFloat(state.capital);
  const leg1Qty = parseFloat(state.buy_qty);
  const leg1Cost = parseFloat(state.buy_usdt);

  const leg1Proceeds = leg1Sold
    ? (Number.isFinite(Number(bracketResult?.usdtOut)) && Number(bracketResult.usdtOut) > 0
        ? Number(bracketResult.usdtOut)
        : leg1Qty * (Number(bracketResult?.exitPrice) || buyPrice))
    : 0;
  const leg1RealizedLoss = leg1Sold ? (leg1Cost - leg1Proceeds) : 0;

  log(`${Y}🛑→⇈ ${symbol} bateu o stop — "Reforço no stop" LIGADO: recomprando a mercado ${rungUsd.toFixed(2)} USDT em vez de encerrar${X}`);

  let buyResult;
  try {
    buyResult = await adapter.marketBuy(rungUsd);
  } catch (err) {
    log(`${Y}⚠️  Falha ao recomprar (reforço): ${err.message}${X}`);
    return closeReinforceFallback({ rowId, adapter, strategy, log, state, session, config, cMap, stopSelf, symbol, leg1Sold, bracketResult, reason: `reforço falhou ao recomprar (${err.message})` });
  }
  if (buyResult?.filled === false) {
    return closeReinforceFallback({ rowId, adapter, strategy, log, state, session, config, cMap, stopSelf, symbol, leg1Sold, bracketResult, reason: 'reforço: recompra a mercado não preencheu' });
  }

  const leg2Cost = parseFloat(buyResult.quoteQty ?? rungUsd);
  const leg2Qty = parseFloat(buyResult.filledQty);
  const leg2Price = parseFloat(buyResult.avgPrice);

  const heldCost = (leg1Sold ? 0 : leg1Cost) + leg2Cost;
  const heldQty = (leg1Sold ? 0 : leg1Qty) + leg2Qty;

  const reinforce = {
    active: true,
    addDropPct: rf.addDropPct,
    exitRisePct: rf.exitRisePct,
    rungUsd,
    legs: [
      { price: buyPrice, qtyBought: leg1Qty, costUsd: leg1Cost, soldAtStop: leg1Sold, proceedsUsd: leg1Proceeds },
      { price: leg2Price, qtyBought: leg2Qty, costUsd: leg2Cost },
    ],
    rungs: 1,
    lastEntryPrice: leg2Price,
    heldCostUsd: heldCost,
    leg1RealizedLossUsd: leg1RealizedLoss,
    fundsShortSince: null,
    startedAt: new Date().toISOString(),
  };
  session.rulesState = {
    ...(rulesState ?? {}),
    exitBracket: null, exitBracketError: null,
    srTargetPrice: null, srTargetForBuy: null, stopPeakPrice: null,
    reinforce,
  };
  await saveState(rowId, {
    buy_qty: heldQty,
    buy_price: heldCost / heldQty,
    buy_usdt: heldCost + leg1RealizedLoss,
    rules_state: session.rulesState,
  }, log);

  const d = evaluateReinforceLadder(reinforce, (cMap[config.entry.interval] ?? []).at(-1));
  const perda = leg1Sold ? `perna 1 vendida no stop (perda ${leg1RealizedLoss.toFixed(2)} USDT)` : 'perna 1 mantida (sem ordem resting)';
  log(`${Y}⇈ Escada de reforço iniciada — ${perda}, perna 2 comprada @ ${fmtPrice(leg2Price)}. Próximo reforço ${fmtPrice(d.addLevel)} · alvo ${fmtPrice(d.tpPrice)} (+${rf.exitRisePct}%)${X}`);
  sendWhatsApp(`⇈ ${BOT_LABEL} [${strategyId}] ${symbol}\n"Reforço no stop" disparado: stop virou escada de averaging-down.\n${perda}, perna 2 @ ${fmtPrice(leg2Price)}.\nPróximo reforço em ${fmtPrice(d.addLevel)} (−${rf.addDropPct}%), alvo em ${fmtPrice(d.tpPrice)} (+${rf.exitRisePct}%).\n⚠️ Posição SEM stop de proteção a partir de agora.`);
  return { phase: 'BOUGHT' };
}

/** Recompra do reforço falhou — encerra o trade do jeito normal (stop). Se a perna 1 já tinha
 *  sido vendida na corretora (bracket OCO), só registra; se não (saída via candle), vende agora. */
async function closeReinforceFallback({ rowId, adapter, strategy, log, state, session, config, cMap, stopSelf, symbol, leg1Sold, bracketResult, reason }) {
  const exitResult = { reason: 'STOP_LOSS', exitDesc: `Stop (${reason})` };
  if (leg1Sold) {
    await recordBracketFill({ rowId, strategy, log, state, session, exitResult, result: bracketResult });
  } else {
    try {
      await executeSell({ rowId, adapter, strategy, log, state, exitResult, session, defaultReasonDesc: 'Stop RSI Momentum (reforço abortado)' });
    } catch {
      return { phase: 'BOUGHT' };
    }
  }
  return retireOrCooldown({ rowId, symbol, log, stopSelf, config, cMap, state, session, reason: `trade fechado (${reason})` });
}

/** Tick da posição em modo reforço — decide por candle (evaluateReinforceLadder): vender a pilha
 *  no alvo, adicionar um degrau na queda, ou segurar. Retomada após restart entra aqui direto. */
async function handleReinforceLadder({ rowId, adapter, strategy, log, state, session, config, cMap, stopSelf, symbol, strategyId, rulesState }) {
  const rf = rulesState.reinforce;
  const forming = (cMap[config.entry.interval] ?? []).at(-1);
  // Valor do reforço congelado no início da escada; cai no aporte da entrada / config se faltar.
  const rungUsd = Number(rf.rungUsd) > 0
    ? Number(rf.rungUsd)
    : (Number(config.exit?.reinforceOnStop?.buyUsd) > 0 ? Number(config.exit.reinforceOnStop.buyUsd) : parseFloat(state.capital));
  const decision = evaluateReinforceLadder(rf, forming);

  if (session.resumedBought && !session.resumeLogged) {
    session.resumeLogged = true;
    log(`${G}🔁 Retomando trade — escada de reforço ativa: ${rf.legs.length} compra(s), última entrada ${fmtPrice(rf.lastEntryPrice)}, `
      + `próximo reforço ${fmtPrice(decision.addLevel)}, alvo ${fmtPrice(decision.tpPrice)} (+${rf.exitRisePct}%), `
      + `investido líquido ${parseFloat(state.buy_usdt).toFixed(2)} USDT${rf.fundsShortSince ? ` · SEM SALDO desde ${rf.fundsShortSince}` : ''}${X}`);
  }

  if (decision.action === 'exit') {
    const exitResult = {
      reason: 'RSI_TARGET',
      targetLevelValue: decision.tpPrice,
      exitDesc: `Reforço no stop — alvo +${rf.exitRisePct}% sobre o último aporte (pilha de ${rf.legs.length} compras)`,
    };
    try {
      await executeSell({ rowId, adapter, strategy, log, state, exitResult, session, defaultReasonDesc: 'Reforço no stop — alvo' });
    } catch {
      return { phase: 'BOUGHT' };
    }
    log(`${G}⇈✅ Escada de reforço fechada no alvo (+${rf.exitRisePct}% sobre o último aporte) — ${rf.legs.length} compras vendidas a mercado${X}`);
    return retireOrCooldown({ rowId, symbol, log, stopSelf, config, cMap, state, session, reason: 'escada de reforço fechada no alvo' });
  }

  if (decision.action === 'addRung') {
    // Sem saldo pra novo aporte: NÃO liquida a pilha. Segue com o trade — as compras já feitas
    // ficam na carteira e saem normalmente quando o preço bater o alvo (+exitRisePct% sobre o
    // último aporte). Só tenta o reforço de novo a cada candle caso o saldo volte.

    // Trava de segurança do nº de degraus — segura a posição (sem timer), só avisa uma vez.
    if ((rf.rungs ?? 1) >= REINFORCE_HARD_CAP) {
      if (!session.reinforceCapWarned) {
        session.reinforceCapWarned = true;
        log(`${Y}⚠️  Escada de reforço atingiu a trava de ${REINFORCE_HARD_CAP} degraus em ${symbol} — segurando a pilha, sem adicionar mais${X}`);
        sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nEscada de reforço parou na trava de ${REINFORCE_HARD_CAP} degraus. Segurando ${rf.legs.length} compras, sem novos aportes. Alvo segue em +${rf.exitRisePct}% do último aporte.`);
      }
      return { phase: 'BOUGHT' };
    }

    let buyResult;
    try {
      buyResult = await adapter.marketBuy(rungUsd);
    } catch (err) {
      return reinforceFundsShort({ rowId, log, state, session, rulesState, rf, symbol, strategyId, note: err.message });
    }
    if (buyResult?.filled === false) {
      return reinforceFundsShort({ rowId, log, state, session, rulesState, rf, symbol, strategyId, note: 'ordem a mercado não preencheu' });
    }

    const legCost = parseFloat(buyResult.quoteQty ?? rungUsd);
    const legQty = parseFloat(buyResult.filledQty);
    const legPrice = parseFloat(buyResult.avgPrice);
    const heldCost = (rf.heldCostUsd ?? parseFloat(state.buy_usdt)) + legCost;
    const newQty = parseFloat(state.buy_qty) + legQty;
    const legs = [...(rf.legs ?? []), { price: legPrice, qtyBought: legQty, costUsd: legCost }];
    const newReinforce = {
      ...rf, legs,
      rungs: (rf.rungs ?? 1) + 1,
      lastEntryPrice: legPrice,
      heldCostUsd: heldCost,
      fundsShortSince: null,
    };
    session.rulesState = { ...rulesState, reinforce: newReinforce };
    await saveState(rowId, {
      buy_qty: newQty,
      buy_price: heldCost / newQty,
      buy_usdt: heldCost + (rf.leg1RealizedLossUsd ?? 0),
      rules_state: session.rulesState,
    }, log);

    const next = evaluateReinforceLadder(newReinforce, forming);
    log(`${Y}⇈ Reforço #${newReinforce.rungs} a mercado @ ${fmtPrice(legPrice)} — pilha ${legs.length} compras, média ${fmtPrice(heldCost / newQty)}, `
      + `próximo reforço ${fmtPrice(next.addLevel)} · alvo ${fmtPrice(next.tpPrice)}${X}`);
    sendWhatsApp(`⇈ ${BOT_LABEL} [${strategyId}] ${symbol}\nReforço #${newReinforce.rungs} a mercado @ ${fmtPrice(legPrice)}.\nPilha: ${legs.length} compras, média ${fmtPrice(heldCost / newQty)}.\nPróximo reforço ${fmtPrice(next.addLevel)} (−${rf.addDropPct}%), alvo ${fmtPrice(next.tpPrice)} (+${rf.exitRisePct}%).`);
    return { phase: 'BOUGHT' };
  }

  return { phase: 'BOUGHT' };
}

/** Sem saldo pra o próximo aporte da escada — registra e AVISA uma vez, mas NÃO liquida nada.
 *  O trade segue: a pilha já comprada fica na carteira e sai normalmente no alvo
 *  (+exitRisePct% sobre o último aporte). Se o saldo voltar, o próximo candle retoma a escada. */
async function reinforceFundsShort({ rowId, log, state, session, rulesState, rf, symbol, strategyId, note }) {
  if (rf.fundsShortSince) return { phase: 'BOUGHT' }; // já avisado
  const since = new Date().toISOString();
  session.rulesState = { ...rulesState, reinforce: { ...rf, fundsShortSince: since } };
  await saveState(rowId, { rules_state: session.rulesState }, log);
  log(`${Y}⚠️  Sem saldo pra o reforço #${(rf.rungs ?? 1) + 1} de ${symbol} (${note}) — seguindo com o trade; a pilha de ${(rf.legs?.length ?? 0)} compras sai no alvo (+${rf.exitRisePct}%)${X}`);
  sendWhatsApp(`⚠️ ${BOT_LABEL} [${strategyId}] ${symbol}\nSem saldo pra o próximo reforço (${note}). Nada é vendido — o trade segue normalmente.\nSegurando ${(rf.legs?.length ?? 0)} compras; a pilha sai a mercado quando o preço bater o alvo (+${rf.exitRisePct}% sobre o último aporte). Se o saldo voltar, a escada é retomada.`);
  return { phase: 'BOUGHT' };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color, startupIndex = null) {
  if (registry.has(row.id)) return;

  let strategy = resolveStrategy(row);
  if (!strategy) return;

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, row.strategy_id, color);

  // Moeda CURADA (watchlist manual — rsi_multi_bot_state.curated): vigiada indefinidamente pelo
  // bot, mesmo que o scanner de mercado (Binance) nunca a sinalize (ex.: SKYAI, que só existe na
  // Gate). Após cada trade fechar (ou pullback/sinal não confirmar) volta pra WATCHING em vez de
  // ser removida do pool — ver retireAutoFavorite.
  const curated = row.curated === true;
  if (curated) {
    log(`📌 Moeda CURADA (${row.exchange ?? 'binance'}) — vigiada indefinidamente; volta pra WATCHING após cada trade, nunca sai do pool.`);
  }

  const ctx = {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: registry.sessionKey(row.symbol, row.strategy_id),
    adapter,
    log,
    strategy,
    stopped: false,
    timer: null,
    configFingerprint: configFingerprint(row),
  };

  let lastResult = { phase: row.phase };
  const rs = parseRulesState(row);
  const session = {
    volCache: null,
    phase: row.phase === 'BOUGHT' ? 'BOUGHT' : null,
    // true só quando a linha já estava comprada no restart — o 1º tick BOUGHT loga a retomada da
    // evolução do stop/alvo (ver tick()). Compra feita durante esta sessão não dispara o log.
    resumedBought: row.phase === 'BOUGHT',
    rulesState: null,
    lastExitTime: rs.lastExitTime ?? null,
    lastExitReason: rs.lastExitReason ?? null,
    curated,
  };
  let volIv;

  const stop = async () => {
    if (ctx.stopped) return;
    ctx.stopped = true;
    if (ctx.timer) clearTimeout(ctx.timer);
    if (volIv) clearInterval(volIv);
    registry.unregister(ctx.rowId);
  };

  const updateFromRow = (newRow) => {
    const next = resolveStrategy(newRow);
    if (!next) {
      log(`${Y}⚠️  trade_config inválido após sync — mantendo config anterior${X}`);
      return;
    }
    ctx.strategy = next;
    session.curated = newRow.curated === true;
    log(`🔄 ${row.symbol} — config atualizada do painel (RSI ${next.config.entry.interval} > ${next.config.entry.rsiThreshold})`);
  };

  registry.register(row.id, {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: ctx.key,
    stop,
    updateFromRow,
    configFingerprint: ctx.configFingerprint,
  });

  const refreshVol = async () => {
    if (ctx.stopped) return;
    try {
      const volumeUsdt = await adapter.fetch24hVol();
      session.volCache = { ts: Date.now(), volumeUsdt };
    } catch {}
  };
  await refreshVol();
  volIv = setInterval(refreshVol, VOL_CACHE_MS);

  const schedule = () => {
    if (ctx.stopped) return;
    const delay = lastResult.phase === 'BOUGHT' ? ctx.strategy.fastPollMs : ctx.strategy.pollMs;
    ctx.timer = setTimeout(run, delay);
  };

  const run = async () => {
    if (ctx.stopped) return;
    try {
      lastResult = await tick(ctx.rowId, adapter, ctx.strategy, log, session, stop);
    } catch (err) {
      log(`❌ Tick error: ${err.message}`);
    }
    schedule();
  };

  if (startupIndex !== null) {
    await new Promise(resolve => setTimeout(resolve, startupIndex * 400 + Math.floor(Math.random() * 300)));
    if (ctx.stopped) return;
  }
  await run();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  console.log('🚀 rsi-momentum-bot iniciado — scanner de mercado + pullback/OCO avaliados minuto a minuto');
  const cfgRow = await sbReq('GET', 'rsi_momentum_global_config', null, `?user_id=eq.${DEFAULT_USER_ID}&select=updated_at&limit=1`).catch(() => null);
  const cfgSource = cfgRow?.[0]?.updated_at
    ? `config global do painel (rsi_momentum_global_config, salva em ${cfgRow[0].updated_at})`
    : 'PRESET ESTÁTICO — nenhuma config salva no painel/SQL ainda (rode supabase/set-rsi-momentum-winning-config.sql)';
  logStartupConfig(await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID), cfgSource);

  await syncExchangeClocks();
  setInterval(syncExchangeClocks, 60 * 60_000);

  const symbolFilter = process.argv.includes('--symbol')
    ? process.argv[process.argv.indexOf('--symbol') + 1]?.toUpperCase()
    : null;
  // --verbose: imprime uma linha por moeda analisada em cada ciclo do scanner (símbolo, motivo
  // do bloqueio, RSI/limiar) — ver marketScanner.js#scanMarketOnce. Sem a flag, cada ciclo só
  // imprime o resumo (total analisado, sinais, contagem de motivos de bloqueio).
  const verbose = process.argv.includes('--verbose');

  // Retoma linhas pending/comprada/watching (cooldown de reentrada) de um restart — nunca perde
  // uma posição/ordem já aberta na corretora, nem esquece um cooldown em andamento, só porque o
  // processo caiu e voltou (ver loadResumableRows).
  let resumable = await loadResumableRows();
  if (symbolFilter) resumable = resumable.filter(r => r.symbol.toUpperCase() === symbolFilter);
  await Promise.all(resumable.map((row, i) => startSymbol(row, COLORS[i % COLORS.length], i)));
  if (resumable.length) {
    console.log(`🔁 ${resumable.length} moeda(s) retomada(s) do restart (pending/comprada/watching)`);
  }

  // Sync manual: se o usuário desativar/apagar o favorito automático de uma moeda pending/
  // comprada direto no painel ou via SQL, encerra a sessão (não cancela ordem/vende sozinho —
  // mesmo comportamento genérico dos outros bots, ver multitradeWatch.js).
  startMultitradeWatch({
    sbReq,
    strategyIds: STRATEGY_IDS,
    symbolFilter,
    resolveStrategy,
    onStartSymbol: () => Promise.resolve(), // criação de linha nova é só via createAutoFavorite/scanner
    log: console.log,
  });

  if (symbolFilter) {
    // --symbol só restringe a retomada acima — não faz sentido rodar o scanner de mercado
    // inteiro filtrado numa única moeda (o scanner já ignora quem tem linha existente).
    await new Promise(() => {});
    return;
  }

  let colorCursor = resumable.length;
  startMarketScanner({
    loadConfig: async () => {
      const body = await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID);
      return resolveStrategy({ strategy_id: 'rsi-momentum', trade_config: body }).config;
    },
    loadTrackedSymbols,
    onSignal: async (symbol) => {
      if (registry.getByKey(symbol, 'rsi-momentum')) return; // corrida: sessão já rodando
      const row = await createAutoFavorite(symbol);
      if (!row) return;
      await startSymbol(row, COLORS[colorCursor++ % COLORS.length]);
    },
    log: console.log,
    intervalMs: SCAN_INTERVAL_MS,
    verbose,
  });

  await new Promise(() => {});
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { runRsiMomentumBot: main };

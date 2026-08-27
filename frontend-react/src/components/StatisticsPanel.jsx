import { useState, useEffect, useRef } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import {
  fetchRsiOversoldRecovery, fetchRsiThresholdBacktest, fetchRsiThresholdBacktestMarket, fetchMaCrossStats, fetchBollingerBandRecovery, fetchCandlesticksAndCloud,
  fetchVwapBandsStats, saveRsiMomentumStatsSearch, getRsiMomentumStatsSearches, clearRsiMomentumStatsSearches,
} from '../services/api';
import Tooltip from './Tooltip';
import { useI18n } from '../i18n';
import { CHART_VIEW } from '../utils/chartView';
import { getEntriesForSymbol } from '../constants/strategyPresets';
import { isMaCrossEntry } from '../utils/macrossFavoritesSort';
import { isBollingerBandsEntry, resolveBollingerBandsPermFilter } from '../utils/multitradeChart';
import { VWAP_BANDS_ALL_INTERVALS, VWAP_BANDS_SESSIONS, EMA_FILTER_PERIODS } from '../constants/vwapBandsConfigSchema';


const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];

const INTERVAL_MS = {
  '1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,
  '2h':7200000,'4h':14400000,'6h':21600000,'8h':28800000,'12h':43200000,
  '1d':86400000,'3d':259200000,'1w':604800000,
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const minutes = Math.round(ms / 60000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Volume 24h em notação compacta: 3.2M, 1.1B, 850K. */
function formatVolume(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function SummaryCard({ label, value, highlight, tooltip }) {
  const card = (
    <div className="flex flex-col items-center justify-center bg-p2/50 border border-p3/20 rounded px-0.5 py-px sm:px-2 sm:py-1.5 min-w-[38px] sm:min-w-[80px]">
      <span className={`text-[10px] sm:text-xs font-bold ${highlight ?? 'text-p5'}`}>{value}</span>
      <span className="text-[8px] sm:text-[9px] text-p5/50 text-center leading-tight">{label}</span>
    </div>
  );
  return tooltip ? <Tooltip text={tooltip} maxW={220}>{card}</Tooltip> : card;
}

const TABS = [
  { id: 'rsi', labelKey: 'stats.tab.rsi' },
  { id: 'rsi_momentum', labelKey: 'stats.tab.rsi_momentum' },
  { id: 'ma_cross', labelKey: 'stats.tab.ma_cross' },
  { id: 'bollinger_bands', labelKey: 'stats.tab.bollinger_bands' },
  { id: 'vwap_bands', labelKey: 'stats.tab.vwap_bands' },
];

const MC_INTERVAL_STORAGE_KEYS = {
  rsi: 'lets_trade_stats_mc_interval_rsi',
  rsi_momentum: 'lets_trade_stats_mc_interval_rsi_momentum',
  ma_cross: 'lets_trade_stats_mc_interval_macross',
  bollinger_bands: 'lets_trade_stats_mc_interval_bb',
};

function loadUseMcInterval(tab, fallback) {
  try {
    const v = localStorage.getItem(MC_INTERVAL_STORAGE_KEYS[tab]);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return fallback;
}

function saveUseMcInterval(tab, value) {
  try { localStorage.setItem(MC_INTERVAL_STORAGE_KEYS[tab], value ? '1' : '0'); } catch {}
}

const CANDLE_COUNT_STORAGE_KEYS = {
  rsi: 'lets_trade_stats_candle_count_rsi',
  rsi_momentum: 'lets_trade_stats_candle_count_rsi_momentum',
  ma_cross: 'lets_trade_stats_candle_count_macross',
};
const STATS_CANDLE_COUNT_DEFAULT = 1000;
/** Valores selecionáveis do campo "Candles" — compartilhado por todas as abas da aba
 *  Estatísticas (RSI, MA Cross, Bollinger Bands, VWAP Bands). */
const STATS_CANDLE_COUNT_OPTIONS = [100, 200, 300, 600, 1000, 2000, 3000];

/** Preferência do campo "Candles" das abas RSI/MA Cross — mesmo padrão do campo já existente
 *  na aba Bollinger Bands (BB_CANDLE_COUNT_STORAGE_KEY/loadCandleCount), só que compartilhado
 *  entre as 2 abas via uma chave por aba em vez de um único par de funções. A aba VWAP Bands
 *  guarda o candleCount dentro do próprio blob de prefs (loadVwapStatsPrefs/patchPrefs), não
 *  aqui — segue o padrão que já existia nela. */
function loadCandleCountFor(tab) {
  try {
    const v = localStorage.getItem(CANDLE_COUNT_STORAGE_KEYS[tab]);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n) && STATS_CANDLE_COUNT_OPTIONS.includes(n)) return n;
    }
  } catch {}
  return STATS_CANDLE_COUNT_DEFAULT;
}

function saveCandleCountFor(tab, value) {
  try { localStorage.setItem(CANDLE_COUNT_STORAGE_KEYS[tab], String(value)); } catch {}
}

const BB_MEDIAN_TREND_STORAGE_KEY = 'lets_trade_stats_bb_median_trend_filter';

/** Preferência do toggle "Filtro Mediana" da aba Bollinger Bands — lembrada entre buscas. */
function loadMedianTrendFilterPref() {
  try {
    const v = localStorage.getItem(BB_MEDIAN_TREND_STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return false;
}

function saveMedianTrendFilterPref(value) {
  try { localStorage.setItem(BB_MEDIAN_TREND_STORAGE_KEY, value ? '1' : '0'); } catch {}
}

const BB_PERM_FILTER_STORAGE_KEY = 'lets_trade_stats_bb_perm_filter';

/** Preferência dos 3 switches "Filtro PERM" (1h/30m/15m) da aba Bollinger Bands — cada um
 *  independente, lembrados entre buscas. Todos false = comportamento igual a "não usar PERM". */
function loadPermFilterPref() {
  try {
    const raw = localStorage.getItem(BB_PERM_FILTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { h1: !!parsed.h1, m30: !!parsed.m30, m15: !!parsed.m15 };
    }
  } catch {}
  return { h1: false, m30: false, m15: false };
}

function savePermFilterPref(value) {
  try { localStorage.setItem(BB_PERM_FILTER_STORAGE_KEY, JSON.stringify(value)); } catch {}
}

const BB_PERM_BOT_STORAGE_KEY = 'lets_trade_stats_bb_perm_bot';

/** Preferência do switch "Perm Bot" — quando ligado, os 3 switches manuais de PERM são
 *  ignorados e a estatística usa o MESMO nível (1h/30m/15m) configurado no favorito
 *  Bollinger Bands (multitrade) dessa moeda, em vez de uma combinação escolhida à mão. */
function loadUsePermBotPref() {
  try {
    const v = localStorage.getItem(BB_PERM_BOT_STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return false;
}

function saveUsePermBotPref(value) {
  try { localStorage.setItem(BB_PERM_BOT_STORAGE_KEY, value ? '1' : '0'); } catch {}
}

/** Favorito Bollinger Bands (multitrade_favorites) desse símbolo, se existir — de onde vem o
 *  `entry.permFilter` real usado pelo bot ao vivo (backend/bot/bollinger-bands/tradeConfigSchema.js). */
function bbEntryFor(multitradeFavorites, symbol) {
  return getEntriesForSymbol(multitradeFavorites, symbol).find(isBollingerBandsEntry) ?? null;
}

/** Converte o `entry.permFilter` do manipulador (bot) — um único intervalo, ex. `{ enabled: true,
 *  interval: '30m' }` — pro formato dos 3 switches independentes da aba Estatísticas, via
 *  resolveBollingerBandsPermFilter (multitradeChart.js, mesma resolução usada pelo botão PERM
 *  do gráfico). PERM desligado no bot ou configurado num intervalo sem equivalente (4h, 2h,
 *  5m…) cai pra "sem PERM" (nenhum switch ligado). */
function permFilterFromBotEntry(entry) {
  const key = resolveBollingerBandsPermFilter(entry);
  return { h1: key === 'h1', m30: key === 'm30', m15: key === 'm15' };
}

const BB_PULLBACK_STORAGE_KEY = 'lets_trade_stats_bb_pullback_pct';
/** Valores selecionáveis do campo "Entrada" (pullback %, negativo = % abaixo da banda
 *  inferior) — mesma granularidade do `entry.pullback.belowPct` do favorito de bot. */
const BB_PULLBACK_OPTIONS = [0, -1, -2, -3, -5, -8, -10, -15, -20];
/** -2% por padrão pra bater com o default do favorito de bot (entry.pullback.belowPct, ver
 *  bollingerBandsConfigSchema.js) — usuário liga 0 manualmente se quiser ver sem pullback. */
const BB_PULLBACK_DEFAULT = -2;

/** Preferência do campo "Entrada" (pullback %) da aba Bollinger Bands — lembrada entre buscas.
 *  Guardado como número negativo (ex.: -5 = compra 5% abaixo da banda inferior), igual ao
 *  `entry.pullback.belowPct` do favorito de bot, só que exibido com o sinal pra ficar claro que
 *  é "abaixo" do sinal. 0 = desligado (entra assim que a banda é tocada, comportamento padrão —
 *  mesmo critério que a coluna "Larg" da tabela principal, que não conhece pullback). */
function loadPullbackPct() {
  try {
    const v = localStorage.getItem(BB_PULLBACK_STORAGE_KEY);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n) && BB_PULLBACK_OPTIONS.includes(n)) return n;
    }
  } catch {}
  return BB_PULLBACK_DEFAULT;
}

function savePullbackPct(value) {
  try { localStorage.setItem(BB_PULLBACK_STORAGE_KEY, String(value)); } catch {}
}

const BB_CANDLE_COUNT_STORAGE_KEY = 'lets_trade_stats_bb_candle_count';
// Mesmo padrão da coluna "Larg" (fetchBollingerBandWidthFilter.js — lookback: '300' no preset
// e no seletor do formulário), pra "Valor. média" bater com "Larg" com os campos padrão.
const BB_CANDLE_COUNT_DEFAULT = 300;

/** Preferência da quantidade de candles buscados pela aba Bollinger Bands — lembrada entre buscas. */
function loadCandleCount() {
  try {
    const v = localStorage.getItem(BB_CANDLE_COUNT_STORAGE_KEY);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n) && STATS_CANDLE_COUNT_OPTIONS.includes(n)) return n;
    }
  } catch {}
  return BB_CANDLE_COUNT_DEFAULT;
}

function saveCandleCount(value) {
  try { localStorage.setItem(BB_CANDLE_COUNT_STORAGE_KEY, String(value)); } catch {}
}

const BB_LOOKBACK_STORAGE_KEY = 'lets_trade_stats_bb_lookback';
/** Valores selecionáveis do campo "Lookback" — mesmos oferecidos pelo filtro dedicado
 *  "Largura BB" (ver ALLOWED_LOOKBACKS em fetchBollingerBandWidthFilter.js), mais o 0
 *  ("Desligado": usa todo o candleCount buscado pra procurar ciclos, comportamento padrão). */
const BB_LOOKBACK_OPTIONS = [0, 50, 100, 150, 200, 300, 700];
const BB_LOOKBACK_DEFAULT = 0;

/** Preferência do campo "Lookback" (restringe a busca de ciclos aos últimos N candles
 *  fechados, independente de quantos candles foram buscados via "Candles") — lembrada entre
 *  buscas. 0 = desligado. */
function loadLookback() {
  try {
    const v = localStorage.getItem(BB_LOOKBACK_STORAGE_KEY);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n) && BB_LOOKBACK_OPTIONS.includes(n)) return n;
    }
  } catch {}
  return BB_LOOKBACK_DEFAULT;
}

function saveLookback(value) {
  try { localStorage.setItem(BB_LOOKBACK_STORAGE_KEY, String(value)); } catch {}
}

/** Valores selecionáveis do campo "Pullback" da aba Momentum RSI — 0 = compra assim que o RSI
 *  cruza o limiar (sem esperar reteste). Negativo = compra só se o preço cair esse % abaixo do
 *  preço do sinal (ordem limite), mesma ideia do pullback da aba Bollinger Bands. */
const RSI_MOM_PULLBACK_OPTIONS = [0, -0.1, -0.2, -0.3, -0.4, -0.5, -1, -2, -3, -5, -8, -10];
/** Valores selecionáveis dos campos "Alvo %" e "Stop %" — 1% a 10%. */
const RSI_MOM_PCT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Valores selecionáveis do campo "Larg. mín %" do filtro de largura de banda. */
const RSI_MOM_BANDWIDTH_OPTIONS = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.5, 3, 4, 5, 8, 10];
/** Valores selecionáveis do campo "Lookback" do filtro de largura de banda — quantos candles
 *  fechados entram no cálculo da largura média dos ciclos Bollinger. */
const RSI_MOM_BANDWIDTH_LOOKBACK_OPTIONS = [300, 200, 100];
/** Valores selecionáveis do filtro "Nuvem D-1" — % da altura da nuvem (candle 1d anterior),
 *  contado do fundo (lower) pra cima, até onde o preço do sinal pode ocupar (limite superior).
 *  100% = até o topo da nuvem inteira (entre abertura e fechamento de ontem); valores menores
 *  restringem até a parte de baixo dela. Preço abaixo da nuvem inteira também libera (desconto
 *  maior ainda) — ver checkPrevDayCloudFilter em backend/utils/analyseRsiThresholdBacktest.js. */
const RSI_MOM_CLOUD_PCT_OPTIONS = [50, 60, 70, 80, 90, 100];
/** Valores selecionáveis do intervalo da nuvem D-1 — mesmo seletor do gráfico (ver
 *  prevDayCloudInterval em CandlestickChart.jsx), padrão 4h. Com source='gate' e um intervalo sem
 *  candle nativo lá, o backend cai pra '1d'. */
const RSI_MOM_CLOUD_INTERVAL_OPTIONS = INTERVALS;
/** Valores selecionáveis da quantidade de candles do envelope da nuvem D-1 — mesmo seletor do
 *  gráfico (ver prevDayCloudCandleCount em CandlestickChart.jsx), padrão 3. 1 = só o candle
 *  anterior; N>1 = envelope [menor open/close, maior open/close] dos últimos N candles. */
const RSI_MOM_CLOUD_CANDLE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Valores selecionáveis do filtro "Volume 24h" — mesmo campo do bot ao vivo
 *  (config.volume.minVolumeUsdt, ver backend/bot/rsi-momentum/marketScanner.js). 0 = desligado. */
const RSI_MOM_VOLUME_OPTIONS = [0, 1_000_000, 2_000_000, 5_000_000, 30_000_000];
/** Valores selecionáveis do filtro ADX — mínimo exigido pra considerar tendência confirmada
 *  (20/25 são os limiares mais citados na literatura pra distinguir tendência de range). */
const RSI_MOM_ADX_MIN_OPTIONS = [15, 20, 25, 30];
/** Valores selecionáveis do campo "Janela" — restringe os SINAIS às últimas N horas (ex.:
 *  "moedas que atingiram RSI 70 nas últimas 6/7/8 horas"). 0 = desligado, usa todo o histórico
 *  definido em Candles. */
const RSI_MOM_LOOKBACK_HOURS_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 24, 48, 72];
/** "A cada X% de alta do pico" — passo do contador do stop contínuo E do alvo contínuo (cada um
 *  com o seu, independentes). */
const RSI_MOM_TRAILING_STEP_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6];
/** Quantos p.p. o alvo/stop contínuo sobe a cada degrau. */
const RSI_MOM_TRAILING_TARGET_STEP_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
/** Modos do ALVO / do STOP — independentes um do outro. */
const RSI_MOM_TARGET_MODE_OPTIONS = ['fixed', 'continuous', 'off'];
const RSI_MOM_STOP_MODE_OPTIONS = ['fixed', 'continuous'];
/** Teto selecionável do card "Dias c/ 2+ entradas" — null (padrão) = sem teto, mesmo cálculo de
 *  sempre (>=2, qualquer quantidade). Um valor aqui troca o card por "% de dias com 2 a N
 *  entradas", medindo especificamente a frequência de dias DENTRO dessa faixa (2 pode virar 10
 *  sem aparecer nesse % se o teto for, por ex., 3) — ver computeDailyEntryStats em
 *  backend/utils/dailyEntryStats.js. */
const RSI_MOM_ENTRIES_RANGE_MAX_OPTIONS = [null, 3, 5, 7, 10];

const RSI_MOM_PREFS_KEY = 'lets_trade_stats_rsi_momentum_prefs';
const RSI_MOM_DEFAULT_PREFS = {
  rsiThreshold: 70,
  pullbackPct: 0,
  targetMode: 'fixed',
  targetPct: 5,
  stopMode: 'continuous',
  stopLossPct: 5,
  positionSizeUsd: 40,
  lookbackHours: 0,
  bandWidthEnabled: false,
  bandWidthInterval: '5m',
  bandWidthMinPct: 2,
  bandWidthLookback: 300,
  prevDayCloudEnabled: false,
  prevDayCloudMaxPct: 100,
  prevDayCloudInterval: '4h',
  prevDayCloudCandleCount: 3,
  prevDayCloudUseHighLow: true,
  minVolumeUsdt: 0,
  excludeOpenExits: false,
  adxFilterEnabled: false,
  adxFilterInterval: '1h',
  adxFilterMinAdx: 25,
  macdFilterEnabled: false,
  macdFilterInterval: '1h',
  trailingCoinStepPct: 3,
  trailingStopStepPct: 2,
  trailingTargetCoinStepPct: 3,
  trailingTargetStepPct: 3,
  allCoins: false,
  entriesDayRangeMax: null,
};

/** Quantidade de candles × duração do intervalo, formatado em horas/dias — mostrado ao lado do
 *  campo "Candles" pra dar noção imediata de quanto histórico aquele número representa (ex.:
 *  1000 candles em 15m = 250h ≈ 10,4 dias). */
function formatCandleSpan(candleCount, interval) {
  const ms = (INTERVAL_MS[interval] ?? 0) * candleCount;
  if (!ms) return null;
  const hours = ms / 3600000;
  if (hours < 48) return `≈ ${hours % 1 === 0 ? hours : hours.toFixed(1)}h`;
  return `≈ ${(hours / 24).toFixed(1)}d`;
}

/** Marcas redondas de tempo (horas) usadas para gerar as opções do campo "Candles" da aba
 *  Momentum RSI — em vez de uma contagem fixa de candles (que representa tempos diferentes
 *  em cada intervalo), cada opção é convertida pro número de candles equivalente ao intervalo
 *  escolhido (ex.: 15m → 1h=4 candles, 2h=8, 6h=24, 12h=48; 5m → 1h=30, 2h=60, 4h=120). */
const RSI_MOM_HOUR_MARKS = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 96, 168];

function buildCandleCountOptions(interval) {
  const ms = INTERVAL_MS[interval];
  if (!ms) return STATS_CANDLE_COUNT_OPTIONS.map((v) => ({ value: v, label: String(v) }));
  const seen = new Set();
  const opts = [];
  for (const h of RSI_MOM_HOUR_MARKS) {
    const count = Math.round((h * 3600000) / ms);
    if (count < 1 || count > 3000 || seen.has(count)) continue;
    seen.add(count);
    const label = h % 24 === 0 ? `${h / 24}d` : `${h}h`;
    opts.push({ value: count, label: `${label} · ${count}` });
  }
  return opts;
}

/** Preferências da aba Momentum RSI — lembradas entre buscas (mesmo padrão dos outros
 *  campos persistidos desta tela, ver loadPullbackPct/loadLookback acima). */
function loadRsiMomPrefs() {
  try {
    const raw = localStorage.getItem(RSI_MOM_PREFS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Migração: no formato antigo `targetPct === 0` no select Alvo significava "stop contínuo,
      // sem alvo". Agora alvo e stop são separados — mapeia pra targetMode 'off' + stop contínuo.
      if (saved.targetMode === undefined) {
        if (saved.targetPct === 0) { saved.targetMode = 'off'; saved.stopMode = 'continuous'; saved.targetPct = RSI_MOM_DEFAULT_PREFS.targetPct; }
        else { saved.targetMode = 'fixed'; if (saved.stopMode === undefined) saved.stopMode = 'fixed'; }
      }
      return { ...RSI_MOM_DEFAULT_PREFS, ...saved };
    }
  } catch {}
  return { ...RSI_MOM_DEFAULT_PREFS };
}

function saveRsiMomPrefs(prefs) {
  try { localStorage.setItem(RSI_MOM_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

const STATS_AUTO_CALC_STORAGE_KEY = 'lets_trade_stats_auto_calc';

/** Preferência do switch "Cálculo Automático" (barra de abas) — quando ligado, clicar numa
 *  moeda (fora do painel, ex.: tabela principal) sincroniza o símbolo E já dispara o cálculo
 *  na aba ativa, usando os critérios atuais do formulário dessa aba (sem mexer no gráfico). */
function loadAutoCalcPref() {
  try {
    const v = localStorage.getItem(STATS_AUTO_CALC_STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return false;
}

function saveAutoCalcPref(value) {
  try { localStorage.setItem(STATS_AUTO_CALC_STORAGE_KEY, value ? '1' : '0'); } catch {}
}

const VWAP_STATS_PREFS_KEY = 'lets_trade_stats_vwap_bands_prefs';

/** Preferências dos seletores da aba VWAP Bands (sessão, intervalo da VWAP, filtro EMA) —
 *  lembradas entre buscas/sessões, mesmo padrão do useMcInterval das outras abas. */
function loadVwapStatsPrefs() {
  try {
    const raw = localStorage.getItem(VWAP_STATS_PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveVwapStatsPrefs(prefs) {
  try { localStorage.setItem(VWAP_STATS_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

/**
 * fetchCandlesticksAndCloud calcula ma9/ma21 só com os últimos 300 candles — insuficiente
 * quando o gráfico é posicionado num cruzamento antigo (fora dessa janela). Recalcula a EMA
 * sobre TODOS os candles buscados, pra cobrir o período clicado.
 */
async function fetchEmaFull(candles, period) {
  const res = await fetch(`/services/sma?period=${period}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  });
  const data = await res.json();
  return Array.isArray(data) ? data : null;
}

/** Entrada do favorito MA-Cross (multitrade_favorites) desse símbolo, se existir. */
function mcEntryFor(multitradeFavorites, symbol) {
  return getEntriesForSymbol(multitradeFavorites, symbol).find(isMaCrossEntry) ?? null;
}

/** Switch "Moeda MC" — usa o intervalo configurado no favorito MA-Cross da moeda em vez do
 *  intervalo padrão fixo da aba. Estado memorizado por aba (localStorage). */
function McIntervalSwitch({ checked, onChange }) {
  return (
    <div className="flex items-center gap-1 shrink-0 pb-1">
      <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">Moeda MC</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        title="Usa o intervalo configurado no favorito MA-Cross desta moeda em vez do padrão fixo"
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-p4' : 'bg-p3/40'}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

/** Switch "Filtro Mediana" — restringe as entradas da estatística às que teriam passado pelo
 *  filtro de tendência da mediana da BB do bot (backend/bot/bollinger-bands/strategyEngine.js
 *  #checkMedianTrendFilter): só conta como entrada o toque na banda inferior cuja mediana,
 *  na janela de `lookback` candles anteriores, estava subindo/estável (não em queda). */
function MedianTrendFilterSwitch({ checked, onChange }) {
  return (
    <div className="flex items-center gap-1 shrink-0 pb-1">
      <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">Filtro Mediana</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        title="Considera só entradas com a mediana da BB em alta/estável nos candles anteriores (mesmo filtro do bot)"
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-p4' : 'bg-p3/40'}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

const PERM_FILTER_LEVELS = [
  { key: 'h1', label: '1h' },
  { key: 'm30', label: '30m' },
  { key: 'm15', label: '15m' },
];

/** 3 switches "Filtro PERM" (1h/30m/15m) — independentes entre si, ver
 *  backend/utils/analyseBollingerBandRecovery.js#isPermBullishAt: só conta a entrada se a nuvem
 *  PERM (EMA9×EMA21, backend/utils/emaPersistCloud.js) de TODOS os níveis habilitados já estiver
 *  verde/fechada nesse instante (sem look-ahead). Nenhum habilitado = não filtra ("sem PERM"),
 *  qualquer combinação (só 1h, 1h+30m, só 30m, os 3 juntos etc.) é válida. */
function PermFilterSwitches({ value, onToggle, disabled = false }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 pb-1">
      <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">PERM</span>
      <div className="flex items-center gap-1">
        {PERM_FILTER_LEVELS.map(({ key, label }) => {
          const on = !!value?.[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(key, !on)}
              title={disabled
                ? 'Controlado pelo switch "Perm Bot" — desligue-o para escolher manualmente'
                : `Exige a nuvem PERM (${label}) verde/fechada no momento do toque (mesmo indicador do gráfico e do bot) — pode combinar com os outros níveis`}
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors ${
                on ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' : 'border-p3/40 text-p5/50'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Switch "Perm Bot" — em vez de escolher manualmente os níveis do filtro PERM (1h/30m/15m),
 *  usa o MESMO nível configurado no favorito Bollinger Bands (multitrade) dessa moeda
 *  (entry.permFilter.interval do manipulador — ver backend/bot/bollinger-bands/tradeConfigSchema.js).
 *  Ex.: se o bot está com o PERM ativado em 30m pra essa moeda, ligar esse switch ativa o
 *  mesmo nível 30m aqui. Sem favorito BB pra essa moeda, ou PERM desligado/num intervalo sem
 *  equivalente (4h, 2h, 5m…), cai pra "sem PERM" (ver permFilterFromBotEntry). */
function PermBotSwitch({ checked, onChange }) {
  return (
    <div className="flex items-center gap-1 shrink-0 pb-1">
      <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">Perm Bot</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        title="Usa o mesmo nível de PERM (1h/30m/15m) configurado no favorito Bollinger Bands desta moeda, em vez de escolher manualmente"
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-p4' : 'bg-p3/40'}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

/** Switch "Cálculo Automático" — na barra de abas do painel de Estatísticas, não por aba.
 *  Ligado: ao clicar numa moeda (o que sincroniza selectedChart.symbol), a aba ativa já
 *  recalcula sozinha com os critérios atuais do formulário — sem precisar clicar em "Buscar". */
function AutoCalcSwitch({ checked, onChange }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 pl-2">
      <span className="hidden sm:inline text-[9px] text-p5/50 uppercase tracking-wider">Cálculo Automático</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        title="Ao clicar numa moeda, calcula automaticamente na aba ativa com os critérios atuais do formulário"
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-p4' : 'bg-p3/40'}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function RsiStats({ autoCalc }) {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, setChartTradeMarkers, multitradeFavorites, uiPrefs } = useCurrency();
  const { t, formatPrice } = useI18n();
  const [symbol, setSymbol]         = useState(selectedChart?.symbol || 'BTCUSDT');
  const [interval, setInterval]     = useState(uiPrefs.statsDefaults.rsi.interval);
  const [oversold, setOversold]     = useState(uiPrefs.statsDefaults.rsi.oversold);
  const [overbought, setOverbought] = useState(uiPrefs.statsDefaults.rsi.overbought);
  const [useMcInterval, setUseMcInterval] = useState(() => loadUseMcInterval('rsi', true));
  const [candleCount, setCandleCount] = useState(() => loadCandleCountFor('rsi'));
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState(null);
  const rsiSeriesRef = useRef(null); // série RSI com warmup correto das estatísticas
  const [error, setError]           = useState(null);
  const [showAll, setShowAll]       = useState(false);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';
  const inpNum = `${inp} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  async function handleSearch(overrideSymbol, updateChart = false, overrideInterval, overrideSource, overrideUseMc, overrideCandleCount) {
    const sym    = (overrideSymbol ?? symbol).trim().toUpperCase();
    const useMc  = overrideUseMc ?? useMcInterval;
    const mcIv   = useMc ? mcEntryFor(multitradeFavorites, sym)?.tradeConfig?.entry?.ma1?.interval : null;
    const iv     = overrideInterval ?? mcIv ?? interval;
    if (mcIv) setInterval(mcIv);
    // Usa source do gráfico apenas quando o símbolo buscado é o mesmo do gráfico
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src    = overrideSource !== undefined ? overrideSource : chartSource;
    const candles = overrideCandleCount ?? candleCount;
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchRsiOversoldRecovery(sym, iv, oversold, overbought, src, candles);
      setResult(data);
      // Guarda a série RSI calculada com warmup completo (1500 candles)
      rsiSeriesRef.current = data.rsiSeries ?? null;
      if (updateChart) {
        const chartData = await fetchCandlesticksAndCloud(sym, iv, src);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Sincroniza o campo símbolo com o gráfico. Com "Cálculo Automático" ligado (switch da
  // barra de abas), também dispara o cálculo nessa hora — senão só sincroniza o campo e o
  // cálculo espera o clique em "Buscar", como sempre foi.
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc) handleSearch(selectedChart.symbol);
  }, [selectedChart?.symbol, autoCalc]);

  function handleToggleMc(next) {
    setUseMcInterval(next);
    saveUseMcInterval('rsi', next);
    if (!next) setInterval('4h');
    handleSearch(undefined, false, undefined, undefined, next);
  }

  return (
    <div className="flex flex-col gap-2 w-full">

      {/* Formulário — sempre em linha única */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0">

        {/* Símbolo */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <div className="hidden md:flex items-center justify-between">
            <label className="text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
            {selectedChart?.symbol === symbol && (
              <span className="text-[8px] text-p4/70 italic">tabela</span>
            )}
          </div>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Par"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
          />
        </div>

        {/* Intervalo */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Intervalo</label>
          <select className={inp} value={interval} onChange={(e) => setInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>

        {/* Sobrv */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Sobrv.</label>
          <input className={inpNum} type="number" min={1} max={99}
            value={oversold} onChange={(e) => setOversold(Number(e.target.value))} />
        </div>

        {/* Sobrcp */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Sobrcp.</label>
          <input className={inpNum} type="number" min={1} max={99}
            value={overbought} onChange={(e) => setOverbought(Number(e.target.value))} />
        </div>

        {/* Candles */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0" title={t('stats.tip.bb_candle_count')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.card.candles')}</label>
          <select className={inp}
            value={candleCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCandleCount(v);
              saveCandleCountFor('rsi', v);
            }}>
            {STATS_CANDLE_COUNT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <McIntervalSwitch checked={useMcInterval} onChange={handleToggleMc} />

        {/* Botão */}
        <button
          onClick={() => handleSearch(undefined, true)}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>
      </div>

      {/* Resultados */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">

        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            {/* Cartões de resumo */}
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label={t('stats.card.candles')}   value={result.totalCandles}     tooltip={t('stats.tip.candles')} />
              <SummaryCard label={t('stats.card.rsi_p')}    value={result.totalRsiPeriods}  tooltip={t('stats.tip.rsi_p')} />
              <SummaryCard label={t('stats.card.occur')}    value={result.totalOccurrences} highlight="text-p4" tooltip={t('stats.tip.occur')} />
              <SummaryCard
                label={t('stats.card.avg')}
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.avg')}
              />
              <SummaryCard label={t('stats.card.entry_rsi')} value={`< ${result.oversoldThreshold}`}   tooltip={t('stats.tip.entry_rsi')} />
              <SummaryCard label={t('stats.card.exit_rsi')}  value={`> ${result.overboughtThreshold}`} tooltip={t('stats.tip.exit_rsi')} />
              <SummaryCard label={t('stats.card.avg_duration')} value={formatDuration(result.avgCycleDurationMs)} tooltip={t('stats.tip.avg_duration')} />
            </div>

            {/* Tabela */}
            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">Nenhum ciclo encontrado.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {/* Toggle todas as colunas */}
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.start')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.entry_p')}</th>}
                        <th className="text-right pb-1 pr-2">RSI</th>
                        <th className="text-right pb-1 pr-2">RSI 4h</th>
                        <th className="text-right pb-1 pr-2">RSI 8h</th>
                        <th className="text-left pb-1 pr-2">{t('stats.end')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.exit_p')}</th>}
                        <th className="text-right pb-1 pr-2">RSI</th>
                        <th className="text-right pb-1">Valor.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.occurrences.map((o, i) => {
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={async () => {
                              const startMs = new Date(o.startDate).getTime();
                              const endMs   = new Date(o.endDate).getTime();
                              const msPerCandle = INTERVAL_MS[interval] ?? 1800000;
                              // Candles necessários do momento atual até o início do ciclo + padding
                              const needed = Math.min(3000, Math.max(266,
                                Math.ceil((Date.now() - startMs) / msPerCandle) + 40));
                              try {
                                const sym = (symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
                                const data = await fetchCandlesticksAndCloud(sym, interval, null, needed);

                                // Substitui o RSI recalculado pelo RSI correto das estatísticas
                                // (que usou 1500 candles com warmup completo)
                                const statsRsi = rsiSeriesRef.current;
                                if (statsRsi?.length) {
                                  const rsiByTime = new Map(statsRsi.map(r => [r.openTime, r.rsi]));
                                  data.rsi = data.candlesticks.map(c => rsiByTime.get(Number(c.openTime)) ?? null);
                                }

                                setSelectedChart(data);
                                setChartViewSource(CHART_VIEW.STATISTICS);
                                // Marca compra/venda do ciclo clicado — mesmo visual das outras abas.
                                setChartTradeMarkers([
                                  { time: startMs, side: 'buy', price: o.entryPrice, label: '▲ Compra' },
                                  {
                                    time: endMs, side: 'sell', price: o.exitPrice, pnlPct: o.appreciationPercent,
                                    entryTime: startMs, entryPrice: o.entryPrice,
                                    label: `▼ ${o.appreciationPercent >= 0 ? '+' : ''}${o.appreciationPercent}%`,
                                  },
                                ]);
                                setChartZoom({
                                  source: CHART_VIEW.STATISTICS,
                                  startDate: o.startDate,
                                  endDate: o.endDate,
                                });

                                // Tabela de candles do período no console
                                const statsRsiMap = statsRsi
                                  ? new Map(statsRsi.map(r => [r.openTime, r.rsi]))
                                  : new Map();
                                const periodCandles = data.candlesticks.filter(c => {
                                  const ts = Number(c.openTime);
                                  return ts >= startMs && ts <= endMs;
                                });
                                console.group(`📊 ${sym} ${interval} — ${formatDate(o.startDate)} → ${formatDate(o.endDate)}`);
                                console.table(periodCandles.map(c => ({
                                  data:   formatDate(new Date(Number(c.openTime)).toISOString()),
                                  open:   Number(c.open),
                                  high:   Number(c.high),
                                  low:    Number(c.low),
                                  close:  Number(c.close),
                                  volume: Number(c.volume),
                                  RSI:    statsRsiMap.get(Number(c.openTime)) ?? '—',
                                })));
                                console.groupEnd();
                              } catch (err) {
                                console.warn('[cycle click]', err.message);
                              }
                            }}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-yellow-600">{o.entryRsi}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-orange-600">{o.entryRsi4h ?? '—'}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-amber-600">{o.entryRsi8h ?? '—'}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-yellow-600">{o.exitRsi}</td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })}

                      {result.openOccurrence && (() => {
                        const o   = result.openOccurrence;
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr className="border-t-2 border-amber-500/40 bg-amber-500/5">
                            {showAll && <td className="py-1 pr-2 text-[10px] text-amber-700">↓</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-700">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-700">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-yellow-600 font-bold">{o.entryRsi}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-orange-600">{o.entryRsi4h ?? '—'}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-amber-600">{o.entryRsi8h ?? '—'}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-700 italic">{t('stats.open')}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                            <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })()}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={showAll ? 10 : 7} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

const OUTCOME_STYLE = {
  target:     { key: 'stats.outcome.target',     className: 'text-green-600' },
  stop:       { key: 'stats.outcome.stop',       className: 'text-red-600' },
  open:       { key: 'stats.outcome.open',       className: 'text-amber-600' },
  not_filled: { key: 'stats.outcome.not_filled', className: 'text-p5/40 italic' },
};

/**
 * Momentum RSI: entra COMPRADO quando o RSI cruza para cima de um limiar (padrão 70 —
 * sobrecompra), com saída simulada por alvo de lucro % ou stop-loss %, o que vier primeiro.
 * Cada cruzamento é avaliado de forma independente (mostra o resultado hipotético de CADA
 * sinal, não uma carteira com 1 posição por vez) — ver backend/utils/analyseRsiThresholdBacktest.js.
 * Opcionalmente só simula entradas se a largura média de banda (Bollinger, ciclo fundo→topo)
 * desta moeda, num intervalo à parte, for ≥ um mínimo — mesmo motor da coluna "Larg%" do
 * mercado (fetchBollingerBandWidthFilter.js).
 */

/** Cabeçalho de coluna clicável — alterna asc/desc no mesmo campo, ou começa em asc num campo
 *  novo. Usado pela tabela de ocorrências da aba Momentum RSI (Par, Sinal, RSI, Saída, Fim, P&L). */
function SortTh({ label, sortKey, sort, onSort, align = 'left', className = '' }) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`${align === 'right' ? 'text-right' : 'text-left'} pb-1 pr-2 cursor-pointer select-none hover:text-p5 transition-colors whitespace-nowrap ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className={active ? 'text-p4' : 'text-transparent'}>{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>
    </th>
  );
}

function RsiMomentumStats({ autoCalc }) {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, setChartTradeMarkers, multitradeFavorites } = useCurrency();
  const { t } = useI18n();
  const [symbol, setSymbol]     = useState(selectedChart?.symbol || 'BTCUSDT');
  const [interval, setInterval] = useState('15m');
  const [useMcInterval, setUseMcInterval] = useState(() => loadUseMcInterval('rsi_momentum', false));
  const [candleCount, setCandleCount] = useState(() => loadCandleCountFor('rsi_momentum'));
  const [prefs, setPrefs] = useState(() => loadRsiMomPrefs());
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  // Opções do campo "Candles" nas marcas redondas de hora do intervalo escolhido (ver
  // buildCandleCountOptions) — inclui o valor atualmente salvo mesmo que não seja uma marca
  // redonda, pra nunca deixar o <select> num estado sem opção correspondente.
  const candleCountOptions = (() => {
    const base = buildCandleCountOptions(interval);
    if (base.some((o) => o.value === candleCount)) return base;
    const extra = { value: candleCount, label: formatCandleSpan(candleCount, interval) ? `${formatCandleSpan(candleCount, interval)} · ${candleCount}` : String(candleCount) };
    return [...base, extra].sort((a, b) => a.value - b.value);
  })();
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [closedOnly, setClosedOnly] = useState(false);
  const [savedSearchCount, setSavedSearchCount] = useState(null);

  useEffect(() => {
    getRsiMomentumStatsSearches().then((arr) => setSavedSearchCount(Array.isArray(arr) ? arr.length : 0)).catch(() => {});
  }, []);

  async function handleClearSavedSearches() {
    if (savedSearchCount === 0) return;
    if (!window.confirm(t('stats.searchlog_clear_confirm'))) return;
    try {
      await clearRsiMomentumStatsSearches();
      setSavedSearchCount(0);
    } catch { /* silencioso */ }
  }

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';
  const inpNum = `${inp} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  function patchPrefs(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveRsiMomPrefs(next);
    return next;
  }

  function toggleSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  /** Ordena as ocorrências pela coluna clicada (ver toggleSort/SortTh) — sort.key === null
   *  mantém a ordem original devolvida pelo backend (cronológica no modo 1 moeda, mais recente
   *  primeiro no modo Todas as moedas). */
  function sortOccurrences(occurrences) {
    if (!sort.key) return occurrences;
    const dirMul = sort.dir === 'asc' ? 1 : -1;
    const getValue = {
      symbol: (o) => o.symbol ?? '',
      signalDate: (o) => new Date(o.signalDate).getTime(),
      signalRsi: (o) => o.signalRsi,
      entryPrice: (o) => o.entryPrice ?? -Infinity,
      outcome: (o) => o.outcome ?? '',
      exitDate: (o) => (o.exitDate ? new Date(o.exitDate).getTime() : -Infinity),
      pnl: (o) => o.pnlUsd ?? -Infinity,
      volumeUsd: (o) => o.volumeUsd ?? -Infinity,
    }[sort.key];
    if (!getValue) return occurrences;
    return [...occurrences].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === 'string') return av.localeCompare(bv) * dirMul;
      return (av - bv) * dirMul;
    });
  }

  async function handleSearch(overrideSymbol, updateChart = false, overrideInterval, overrideSource, overrideUseMc, overrideCandleCount, overridePrefs) {
    const p = overridePrefs ?? prefs;
    const useMc = overrideUseMc ?? useMcInterval;
    const sym  = (overrideSymbol ?? symbol).trim().toUpperCase();
    const mcIv  = (!p.allCoins && useMc) ? mcEntryFor(multitradeFavorites, sym)?.tradeConfig?.entry?.ma1?.interval : null;
    const iv    = overrideInterval ?? mcIv ?? interval;
    if (mcIv) setInterval(mcIv);
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src   = overrideSource !== undefined ? overrideSource : chartSource;
    const candles = overrideCandleCount ?? candleCount;
    if (!p.allCoins && !sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Alvo e stop são INDEPENDENTES (ver options.targetMode / options.trailingStop em
      // analyseRsiThresholdBacktest.js). Alvo: 'fixed' | 'continuous' (base targetPct% + degraus
      // com contador próprio) | 'off' (sem alvo). Stop: 'fixed' (stopLossPct) | 'continuous'.
      const stopContinuous = p.stopMode === 'continuous';
      const commonOptions = {
        rsiThreshold: p.rsiThreshold,
        pullbackPct: p.pullbackPct,
        targetPct: p.targetPct,
        stopLossPct: p.stopLossPct,
        targetMode: p.targetMode,
        trailingStop: stopContinuous ? {
          enabled: true,
          startPct: p.stopLossPct,
          coinStepPct: p.trailingCoinStepPct,
          stopStepPct: p.trailingStopStepPct,
        } : null,
        trailingTarget: p.targetMode === 'continuous' ? {
          coinStepPct: p.trailingTargetCoinStepPct,
          stepPct: p.trailingTargetStepPct,
        } : null,
        positionSizeUsd: p.positionSizeUsd,
        candleCount: candles,
        lookbackHours: p.lookbackHours,
        bandWidth: p.bandWidthEnabled ? {
          enabled: true,
          interval: p.bandWidthInterval,
          minPct: p.bandWidthMinPct,
          lookback: p.bandWidthLookback,
        } : null,
        prevDayCloud: p.prevDayCloudEnabled ? {
          enabled: true,
          maxPct: p.prevDayCloudMaxPct,
          interval: p.prevDayCloudInterval,
          candleCount: p.prevDayCloudCandleCount,
          useHighLow: p.prevDayCloudUseHighLow,
        } : null,
        minVolumeUsdt: p.minVolumeUsdt,
        excludeOpenExits: p.excludeOpenExits,
        adxFilter: p.adxFilterEnabled ? {
          enabled: true,
          interval: p.adxFilterInterval,
          minAdx: p.adxFilterMinAdx,
        } : null,
        macdFilter: p.macdFilterEnabled ? {
          enabled: true,
          interval: p.macdFilterInterval,
        } : null,
        entriesDayRange: p.entriesDayRangeMax != null ? { min: 2, max: p.entriesDayRangeMax } : null,
      };
      const data = p.allCoins
        ? await fetchRsiThresholdBacktestMarket(iv, commonOptions)
        : await fetchRsiThresholdBacktest(sym, iv, { ...commonOptions, source: src });
      setResult(data);
      // Grava a pesquisa (config + resumo) no log do backend — só nas buscas deliberadas
      // (botão "Buscar" / Enter, updateChart=true), não nos recálculos automáticos por clique
      // no gráfico. Fire-and-forget: falha aqui não pode quebrar a tela.
      if (updateChart) {
        saveRsiMomentumStatsSearch({
          scope: p.allCoins ? 'market' : sym,
          interval: iv,
          config: { ...commonOptions, allCoins: !!p.allCoins, source: p.allCoins ? null : (src ?? null) },
          result: data,
        })
          .then((r) => { if (r?.total != null) setSavedSearchCount(r.total); })
          .catch(() => {});
      }
      if (updateChart && !p.allCoins) {
        const chartData = await fetchCandlesticksAndCloud(sym, iv, src);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc && !prefs.allCoins) handleSearch(selectedChart.symbol);
  }, [selectedChart?.symbol, autoCalc]);

  function handleToggleMc(next) {
    setUseMcInterval(next);
    saveUseMcInterval('rsi_momentum', next);
    if (!next) setInterval('15m');
    handleSearch(undefined, false, undefined, undefined, next);
  }

  async function openOnChart(o, iv) {
    const startMs = new Date(o.signalDate).getTime();
    const endMs   = o.exitDate ? new Date(o.exitDate).getTime() : Date.now();
    const msPerCandle = INTERVAL_MS[iv] ?? 900000;
    const needed = Math.min(3000, Math.max(266,
      Math.ceil((Date.now() - startMs) / msPerCandle) + 40));
    try {
      const sym = (o.symbol || symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
      const src = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
      const data = await fetchCandlesticksAndCloud(sym, iv, src, needed);
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      setChartTradeMarkers([
        { time: startMs, side: 'buy', price: o.entryPrice ?? o.signalPrice, label: '▲ Sinal' },
        o.filled && o.exitPrice != null && {
          time: endMs, side: 'sell', price: o.exitPrice, pnlPct: o.pnlPct,
          entryTime: startMs, entryPrice: o.entryPrice,
          label: `▼ ${o.pnlPct >= 0 ? '+' : ''}${o.pnlPct}%`,
        },
      ].filter(Boolean));
      setChartZoom({
        source: CHART_VIEW.STATISTICS,
        startDate: o.signalDate,
        endDate: o.exitDate ?? new Date(endMs).toISOString(),
      });
    } catch (err) {
      console.warn('[rsi momentum stats click]', err.message);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0 flex-wrap">
        {/* Todas as moedas — desliga o campo Símbolo e roda o cálculo em todos os pares USDT
            ativos de uma vez (ver backend/utils/analyseRsiThresholdBacktestMarket.js). */}
        <div className="flex items-center gap-1 shrink-0 pb-1" title={t('stats.tip.all_coins')}>
          <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.all_coins')}</span>
          <button
            type="button"
            onClick={() => patchPrefs({ allCoins: !prefs.allCoins })}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${prefs.allCoins ? 'bg-p4' : 'bg-p3/40'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${prefs.allCoins ? 'translate-x-3' : 'translate-x-0'}`} />
          </button>
        </div>

        {!prefs.allCoins && (
          <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[72px]">
            <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
            <input
              className={inp}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Par"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
            />
          </div>
        )}

        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Intervalo</label>
          <select className={inp} value={interval} onChange={(e) => setInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.rsi_threshold')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.rsi_threshold')}</label>
          <input className={inpNum} type="number" min={1} max={99}
            value={prefs.rsiThreshold} onChange={(e) => patchPrefs({ rsiThreshold: Number(e.target.value) })} />
        </div>

        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.pullback')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.pullback')}</label>
          <select className={inp}
            value={prefs.pullbackPct}
            onChange={(e) => patchPrefs({ pullbackPct: Number(e.target.value) })}>
            {RSI_MOM_PULLBACK_OPTIONS.map((v) => (
              <option key={v} value={v}>{v === 0 ? 'Desligado' : `${v}%`}</option>
            ))}
          </select>
        </div>

        {/* ALVO — modo (fixo/contínuo/desligado) + valores, INDEPENDENTE do stop */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[64px]" title={t('stats.tip.target_mode')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.target_mode')}</label>
          <select className={inp}
            value={prefs.targetMode}
            onChange={(e) => patchPrefs({ targetMode: e.target.value })}>
            {RSI_MOM_TARGET_MODE_OPTIONS.map((m) => <option key={m} value={m}>{t(`stats.target_mode_${m}`)}</option>)}
          </select>
        </div>
        {prefs.targetMode !== 'off' && (
          <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.target_pct')}>
            <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">
              {prefs.targetMode === 'continuous' ? t('stats.target_base_pct') : t('stats.target_pct')}
            </label>
            <select className={inp}
              value={prefs.targetPct}
              onChange={(e) => patchPrefs({ targetPct: Number(e.target.value) })}>
              {RSI_MOM_PCT_OPTIONS.map((v) => <option key={v} value={v}>+{v}%</option>)}
            </select>
          </div>
        )}
        {prefs.targetMode === 'continuous' && (
          <>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.target_step_pp')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.target_step_pp')}</label>
              <select className={inp}
                value={prefs.trailingTargetStepPct}
                onChange={(e) => patchPrefs({ trailingTargetStepPct: Number(e.target.value) })}>
                {RSI_MOM_TRAILING_TARGET_STEP_OPTIONS.map((v) => <option key={v} value={v}>{v}pp</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.target_coin_step')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.target_coin_step')}</label>
              <select className={inp}
                value={prefs.trailingTargetCoinStepPct}
                onChange={(e) => patchPrefs({ trailingTargetCoinStepPct: Number(e.target.value) })}>
                {RSI_MOM_TRAILING_STEP_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
            </div>
          </>
        )}

        {/* STOP — modo (fixo/contínuo) + valores, INDEPENDENTE do alvo */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.stop_mode')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.stop_mode')}</label>
          <select className={inp}
            value={prefs.stopMode}
            onChange={(e) => patchPrefs({ stopMode: e.target.value })}>
            {RSI_MOM_STOP_MODE_OPTIONS.map((m) => <option key={m} value={m}>{t(`stats.stop_mode_${m}`)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={prefs.stopMode === 'continuous' ? t('stats.tip.trailing_start_pct') : t('stats.tip.stop_pct')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">
            {prefs.stopMode === 'continuous' ? t('stats.trailing_start_pct') : t('stats.stop_pct')}
          </label>
          <select className={inp}
            value={prefs.stopLossPct}
            onChange={(e) => patchPrefs({ stopLossPct: Number(e.target.value) })}>
            {RSI_MOM_PCT_OPTIONS.map((v) => <option key={v} value={v}>-{v}%</option>)}
          </select>
        </div>
        {prefs.stopMode === 'continuous' && (
          <>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.trailing_stop_step')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.trailing_stop_step')}</label>
              <select className={inp}
                value={prefs.trailingStopStepPct}
                onChange={(e) => patchPrefs({ trailingStopStepPct: Number(e.target.value) })}>
                {RSI_MOM_TRAILING_TARGET_STEP_OPTIONS.map((v) => <option key={v} value={v}>{v}pp</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.trailing_coin_step')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.trailing_coin_step')}</label>
              <select className={inp}
                value={prefs.trailingCoinStepPct}
                onChange={(e) => patchPrefs({ trailingCoinStepPct: Number(e.target.value) })}>
                {RSI_MOM_TRAILING_STEP_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
            </div>
          </>
        )}

        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.position_size')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.position_size')}</label>
          <input className={inpNum} type="number" min={1} step={1}
            value={prefs.positionSizeUsd} onChange={(e) => patchPrefs({ positionSizeUsd: Number(e.target.value) })} />
        </div>

        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[72px]" title={t('stats.tip.bb_candle_count')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">
            {t('stats.card.candles')}
            {formatCandleSpan(candleCount, interval) && (
              <span className="normal-case tracking-normal text-p5/40"> ({formatCandleSpan(candleCount, interval)})</span>
            )}
          </label>
          <select className={inp}
            value={candleCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCandleCount(v);
              saveCandleCountFor('rsi_momentum', v);
            }}>
            {candleCountOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.lookback_hours')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.lookback_hours')}</label>
          <select className={inp}
            value={prefs.lookbackHours}
            onChange={(e) => patchPrefs({ lookbackHours: Number(e.target.value) })}>
            {RSI_MOM_LOOKBACK_HOURS_OPTIONS.map((v) => (
              <option key={v} value={v}>{v === 0 ? 'Desligado' : `${v}h`}</option>
            ))}
          </select>
        </div>

        {/* Filtro de largura de banda */}
        <div className="flex items-center gap-1 shrink-0 pb-1" title={t('stats.tip.bandwidth_filter')}>
          <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bandwidth_filter')}</span>
          <button
            type="button"
            onClick={() => patchPrefs({ bandWidthEnabled: !prefs.bandWidthEnabled })}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${prefs.bandWidthEnabled ? 'bg-p4' : 'bg-p3/40'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${prefs.bandWidthEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
          </button>
        </div>

        {prefs.bandWidthEnabled && (
          <>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bandwidth_interval')}</label>
              <select className={inp}
                value={prefs.bandWidthInterval}
                onChange={(e) => patchPrefs({ bandWidthInterval: e.target.value })}>
                {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.bandwidth_min')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bandwidth_min')}</label>
              <select className={inp}
                value={prefs.bandWidthMinPct}
                onChange={(e) => patchPrefs({ bandWidthMinPct: Number(e.target.value) })}>
                {RSI_MOM_BANDWIDTH_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.bandwidth_lookback')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bandwidth_lookback')}</label>
              <select className={inp}
                value={prefs.bandWidthLookback}
                onChange={(e) => patchPrefs({ bandWidthLookback: Number(e.target.value) })}>
                {RSI_MOM_BANDWIDTH_LOOKBACK_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Filtro pela nuvem D-1 (candle diário anterior — mesmo indicador do gráfico) */}
        <div className="flex items-center gap-1 shrink-0 pb-1" title={t('stats.tip.prevday_cloud_filter')}>
          <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.prevday_cloud_filter')}</span>
          <button
            type="button"
            onClick={() => patchPrefs({ prevDayCloudEnabled: !prefs.prevDayCloudEnabled })}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${prefs.prevDayCloudEnabled ? 'bg-p4' : 'bg-p3/40'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${prefs.prevDayCloudEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
          </button>
        </div>

        {prefs.prevDayCloudEnabled && (
          <>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.prevday_cloud_max')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.prevday_cloud_max')}</label>
              <select className={inp}
                value={prefs.prevDayCloudMaxPct}
                onChange={(e) => patchPrefs({ prevDayCloudMaxPct: Number(e.target.value) })}>
                {RSI_MOM_CLOUD_PCT_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.prevday_cloud_interval')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.prevday_cloud_interval')}</label>
              <select className={inp}
                value={prefs.prevDayCloudInterval}
                onChange={(e) => patchPrefs({ prevDayCloudInterval: e.target.value })}>
                {RSI_MOM_CLOUD_INTERVAL_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.prevday_cloud_candle_count')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.prevday_cloud_candle_count')}</label>
              <select className={inp}
                value={prefs.prevDayCloudCandleCount}
                onChange={(e) => patchPrefs({ prevDayCloudCandleCount: Number(e.target.value) })}>
                {RSI_MOM_CLOUD_CANDLE_COUNT_OPTIONS.map((v) => <option key={v} value={v}>{`x${v}`}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.prevday_cloud_source')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.prevday_cloud_source')}</label>
              <select className={inp}
                value={prefs.prevDayCloudUseHighLow ? 'hl' : 'oc'}
                onChange={(e) => patchPrefs({ prevDayCloudUseHighLow: e.target.value === 'hl' })}>
                <option value="oc">{t('stats.prevday_cloud_source_oc')}</option>
                <option value="hl">{t('stats.prevday_cloud_source_hl')}</option>
              </select>
            </div>
          </>
        )}

        {/* Filtro de volume 24h (mesmo campo do bot ao vivo, config.volume.minVolumeUsdt) */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.min_volume')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.min_volume')}</label>
          <select className={inp}
            value={prefs.minVolumeUsdt}
            onChange={(e) => patchPrefs({ minVolumeUsdt: Number(e.target.value) })}>
            {RSI_MOM_VOLUME_OPTIONS.map((v) => (
              <option key={v} value={v}>{v === 0 ? 'Desligado' : `>${v / 1_000_000}M`}</option>
            ))}
          </select>
        </div>

        {/* Teto opcional do card "Dias c/ 2+ entradas" — sem teto, 2 e 10 entradas no mesmo dia
            contam igual nesse %; escolher um teto troca o card por "% de dias com 2 a N" */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[64px]" title={t('stats.tip.entries_day_range')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.entries_day_range')}</label>
          <select className={inp}
            value={prefs.entriesDayRangeMax ?? ''}
            onChange={(e) => patchPrefs({ entriesDayRangeMax: e.target.value === '' ? null : Number(e.target.value) })}>
            {RSI_MOM_ENTRIES_RANGE_MAX_OPTIONS.map((v) => (
              <option key={v ?? 'none'} value={v ?? ''}>{v == null ? t('stats.entries_day_range_none') : `2–${v}`}</option>
            ))}
          </select>
        </div>

        {/* Remove da tabela e dos agregados (P&L, contagens) os sinais ainda "em aberto" (não bateram alvo nem stop até agora) */}
        <div className="flex items-center gap-1 shrink-0 pb-1" title={t('stats.tip.exclude_open_exits')}>
          <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.exclude_open_exits')}</span>
          <button
            type="button"
            onClick={() => patchPrefs({ excludeOpenExits: !prefs.excludeOpenExits })}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${prefs.excludeOpenExits ? 'bg-p4' : 'bg-p3/40'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${prefs.excludeOpenExits ? 'translate-x-3' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Filtro de força de tendência (ADX de Wilder, período fixo 14) — só o intervalo e o
            mínimo exigido são configuráveis */}
        <div className="flex items-center gap-1 shrink-0 pb-1" title={t('stats.tip.adx_filter')}>
          <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.adx_filter')}</span>
          <button
            type="button"
            onClick={() => patchPrefs({ adxFilterEnabled: !prefs.adxFilterEnabled })}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${prefs.adxFilterEnabled ? 'bg-p4' : 'bg-p3/40'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${prefs.adxFilterEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
          </button>
        </div>

        {prefs.adxFilterEnabled && (
          <>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.adx_interval')}</label>
              <select className={inp}
                value={prefs.adxFilterInterval}
                onChange={(e) => patchPrefs({ adxFilterInterval: e.target.value })}>
                {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]" title={t('stats.tip.adx_min')}>
              <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.adx_min')}</label>
              <select className={inp}
                value={prefs.adxFilterMinAdx}
                onChange={(e) => patchPrefs({ adxFilterMinAdx: Number(e.target.value) })}>
                {RSI_MOM_ADX_MIN_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Confirmação de momentum por MACD (12/26/9 padrão) — só o intervalo é configurável */}
        <div className="flex items-center gap-1 shrink-0 pb-1" title={t('stats.tip.macd_filter')}>
          <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.macd_filter')}</span>
          <button
            type="button"
            onClick={() => patchPrefs({ macdFilterEnabled: !prefs.macdFilterEnabled })}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${prefs.macdFilterEnabled ? 'bg-p4' : 'bg-p3/40'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${prefs.macdFilterEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
          </button>
        </div>

        {prefs.macdFilterEnabled && (
          <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
            <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.macd_interval')}</label>
            <select className={inp}
              value={prefs.macdFilterInterval}
              onChange={(e) => patchPrefs({ macdFilterInterval: e.target.value })}>
              {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
            </select>
          </div>
        )}

        {!prefs.allCoins && <McIntervalSwitch checked={useMcInterval} onChange={handleToggleMc} />}

        <button
          onClick={() => handleSearch(undefined, true)}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>

        <div className="shrink-0 flex items-center gap-1.5 text-[10px] text-p5/50" title={t('stats.tip.searchlog')}>
          <span className="hidden md:inline">{t('stats.searchlog')}: {savedSearchCount ?? '…'}</span>
          <span className="md:hidden">📁 {savedSearchCount ?? '…'}</span>
          <button
            type="button"
            onClick={handleClearSavedSearches}
            disabled={!savedSearchCount}
            className="rounded border border-p3/40 px-1.5 py-0.5 text-[10px] text-p5/60 hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            {t('stats.searchlog_clear')}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              {prefs.allCoins ? (
                <SummaryCard
                  label={t('stats.card.symbols_scanned')}
                  value={`${result.symbolsScanned}/${result.symbolsTotal}`}
                  tooltip={t('stats.tip.symbols_scanned')}
                />
              ) : (
                <SummaryCard
                  label={t('stats.card.candles')}
                  value={formatCandleSpan(result.totalCandles, result.interval)
                    ? `${result.totalCandles} (${formatCandleSpan(result.totalCandles, result.interval)})`
                    : result.totalCandles}
                  tooltip={t('stats.tip.candles')}
                />
              )}
              <SummaryCard label={t('stats.card.signals')} value={result.totalSignals} highlight="text-p4" tooltip={t('stats.tip.signals')} />
              <SummaryCard label={t('stats.card.filled')} value={result.totalFilled} tooltip={t('stats.tip.filled')} />
              <SummaryCard label={t('stats.card.hit_target')} value={result.totalTarget} highlight="text-green-600" />
              {result.totalTarget > 0 && result.targetBaseCount != null && (
                <SummaryCard
                  label={t('stats.card.target_base')}
                  value={`${result.targetBaseCount}/${result.totalTarget}`}
                  highlight="text-emerald-500"
                  tooltip={t('stats.tip.target_base_count')}
                />
              )}
              <SummaryCard label={t('stats.card.hit_stop')} value={result.totalStop} highlight="text-red-600" />
              {result.totalStop > 0 && result.stopBaseCount != null && (
                <SummaryCard
                  label={t('stats.card.stop_base')}
                  value={`${result.stopBaseCount}/${result.totalStop}`}
                  highlight="text-red-500"
                  tooltip={t('stats.tip.stop_base_count')}
                />
              )}
              <SummaryCard label={t('stats.card.still_open')} value={result.totalOpen} highlight="text-amber-600" />
              <SummaryCard label={t('stats.card.win_rate')} value={`${result.winRatePct}%`} highlight="text-p4" tooltip={t('stats.tip.win_rate')} />
              <SummaryCard label={t('stats.card.invested')} value={`$${result.totalInvestedUsd}`} />
              <SummaryCard
                label={t('stats.card.total_pnl')}
                value={`${result.totalPnlUsd >= 0 ? '+' : ''}$${result.totalPnlUsd}`}
                highlight={result.totalPnlUsd >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.total_pnl')}
              />
              <SummaryCard
                label={t('stats.card.avg_pnl')}
                value={`${result.avgPnlPct > 0 ? '+' : ''}${result.avgPnlPct}%`}
                highlight={result.avgPnlPct >= 0 ? 'text-green-600' : 'text-red-600'}
              />
              {result.dailyEntryStats?.daysWithEntries > 0 && (
                <>
                  <SummaryCard
                    label={t('stats.card.max_entries_day')}
                    value={result.dailyEntryStats.maxEntriesPerDay}
                    highlight="text-p4"
                    tooltip={t('stats.tip.max_entries_day')}
                  />
                  <SummaryCard
                    label={t('stats.card.avg_entries_day')}
                    value={result.dailyEntryStats.avgEntriesPerDay}
                    tooltip={t('stats.tip.avg_entries_day')}
                  />
                  <SummaryCard
                    label={t('stats.card.multi_entry_days_pct')}
                    value={`${result.dailyEntryStats.multiEntryDaysPct}%`}
                    highlight="text-amber-600"
                    tooltip={t('stats.tip.multi_entry_days_pct')}
                  />
                  {result.dailyEntryStats.entriesRange?.max != null && (
                    <SummaryCard
                      label={`${t('stats.card.entries_range_days_pct')} (2–${result.dailyEntryStats.entriesRange.max})`}
                      value={`${result.dailyEntryStats.entriesRangeDaysPct}%`}
                      highlight="text-amber-600"
                      tooltip={t('stats.tip.entries_range_days_pct')}
                    />
                  )}
                  <SummaryCard
                    label={t('stats.card.daily_capital')}
                    value={`$${result.dailyEntryStats.suggestedDailyCapitalUsd}`}
                    highlight="text-p4"
                    tooltip={t('stats.tip.daily_capital')}
                  />
                </>
              )}
              {result.tradeDuration?.count > 0 && (
                <SummaryCard
                  label={t('stats.card.avg_duration')}
                  value={formatDuration(result.tradeDuration.avgDurationMs)}
                  highlight="text-p4"
                  tooltip={`${t('stats.tip.avg_duration')} (mín ${formatDuration(result.tradeDuration.minDurationMs)} · máx ${formatDuration(result.tradeDuration.maxDurationMs)})`}
                />
              )}
              {!prefs.allCoins && result.bandWidth && (
                <SummaryCard
                  label={t('stats.card.avg_width')}
                  value={result.bandWidth.avgWidthPct != null ? `${result.bandWidth.avgWidthPct}%` : '—'}
                  highlight={result.bandWidth.passed ? 'text-emerald-500' : 'text-red-600'}
                  tooltip={`${result.bandWidth.interval} · BB${result.bandWidth.period} · mín ${result.bandWidth.minPct}%`}
                />
              )}
              {prefs.allCoins && result.bandWidthEnabled && (
                <SummaryCard
                  label={t('stats.card.blocked_by_width')}
                  value={`${result.symbolsBlockedByBandWidth}/${result.symbolsScanned}`}
                  highlight="text-amber-500"
                  tooltip={t('stats.tip.blocked_by_width')}
                />
              )}
              {!prefs.allCoins && result.volume && (
                <SummaryCard
                  label={t('stats.card.volume_24h')}
                  value={result.volume.quoteVolume != null ? `$${(result.volume.quoteVolume / 1_000_000).toFixed(1)}M` : '—'}
                  highlight={result.volume.passed ? 'text-emerald-500' : 'text-red-600'}
                  tooltip={`mín $${(result.volume.minVolumeUsdt / 1_000_000)}M`}
                />
              )}
              {prefs.allCoins && result.minVolumeUsdt > 0 && (
                <SummaryCard
                  label={t('stats.card.blocked_by_volume')}
                  value={`${result.symbolsBlockedByVolume}/${result.symbolsTotal}`}
                  highlight="text-amber-500"
                  tooltip={t('stats.tip.blocked_by_volume')}
                />
              )}
              {result.lookbackHours > 0 && (
                <SummaryCard label={t('stats.lookback_hours')} value={`${result.lookbackHours}h`} highlight="text-amber-500" tooltip={t('stats.tip.lookback_hours')} />
              )}
            </div>

            {result.bandWidth && !result.bandWidth.passed && (
              <p className="text-[11px] text-amber-600 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-1.5">
                Largura de banda média ({result.bandWidth.avgWidthPct ?? '—'}%) abaixo do mínimo exigido ({result.bandWidth.minPct}%) — nenhuma entrada simulada.
              </p>
            )}

            {prefs.allCoins && Array.isArray(result.volumeBreakdown) && result.volumeBreakdown.some((b) => b.trades > 0) && (
              <div className="rounded-md p-2" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1" title={t('stats.tip.volume_breakdown')}>
                  {t('stats.volume_breakdown')}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] sm:text-[11px]">
                    <thead>
                      <tr className="text-p5/50 text-left">
                        <th className="pb-1 pr-2">{t('stats.vb_bucket')}</th>
                        <th className="pb-1 pr-2 text-right">{t('stats.vb_trades')}</th>
                        <th className="pb-1 pr-2 text-right">{t('stats.vb_winrate')}</th>
                        <th className="pb-1 pr-2 text-right">{t('stats.vb_avg_pnl')}</th>
                        <th className="pb-1 text-right">{t('stats.vb_total_pnl')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.volumeBreakdown.map((b) => (
                        <tr key={b.label} className={b.trades === 0 ? 'text-p5/25' : 'text-p5/80'}>
                          <td className="py-0.5 pr-2 font-mono whitespace-nowrap">{b.label}</td>
                          <td className="py-0.5 pr-2 text-right">{b.trades}{b.trades > 0 ? ` (${b.wins}✓/${b.stops}✗)` : ''}</td>
                          <td className="py-0.5 pr-2 text-right">{b.winRatePct != null ? `${b.winRatePct}%` : '—'}</td>
                          <td className={`py-0.5 pr-2 text-right font-mono ${b.avgPnlPct == null ? '' : b.avgPnlPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {b.avgPnlPct != null ? `${b.avgPnlPct >= 0 ? '+' : ''}${b.avgPnlPct}%` : '—'}
                          </td>
                          <td className={`py-0.5 text-right font-mono ${b.trades === 0 ? '' : b.totalPnlUsd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {b.trades > 0 ? `${b.totalPnlUsd >= 0 ? '+' : ''}$${b.totalPnlUsd}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.occurrencesTruncated && (
              <p className="text-[11px] text-p5/50 italic">
                Mostrando os {result.occurrences.length} sinais mais recentes de {result.totalSignals} encontrados.
              </p>
            )}

            {(() => {
              const visibleOccurrences = closedOnly
                ? result.occurrences.filter((o) => o.outcome === 'target' || o.outcome === 'stop')
                : result.occurrences;

              return visibleOccurrences.length === 0 ? (
                <p className="text-[11px] text-p5/50">
                  {closedOnly ? t('stats.no_closed_trades') : t('stats.no_cycles_rsi_momentum')}
                </p>
              ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3 justify-end">
                  <div className="flex items-center gap-2" title={t('stats.tip.closed_only')}>
                    <span className="text-[10px] text-p5/50">{t('stats.closed_only')}</span>
                    <button
                      onClick={() => setClosedOnly((v) => !v)}
                      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${closedOnly ? 'bg-p4' : 'bg-p3/40'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${closedOnly ? 'translate-x-3' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                    <button
                      onClick={() => setShowAll((v) => !v)}
                      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        {prefs.allCoins && <SortTh label={t('stats.card.par')} sortKey="symbol" sort={sort} onSort={toggleSort} />}
                        {prefs.allCoins && <SortTh label={t('stats.vb_vol')} sortKey="volumeUsd" sort={sort} onSort={toggleSort} align="right" />}
                        <SortTh label={t('stats.signal')} sortKey="signalDate" sort={sort} onSort={toggleSort} />
                        <SortTh label="RSI" sortKey="signalRsi" sort={sort} onSort={toggleSort} align="right" />
                        {showAll && <SortTh label={t('stats.entry_p')} sortKey="entryPrice" sort={sort} onSort={toggleSort} align="right" />}
                        <SortTh label={t('stats.exit_reason')} sortKey="outcome" sort={sort} onSort={toggleSort} />
                        <SortTh label={t('stats.end')} sortKey="exitDate" sort={sort} onSort={toggleSort} />
                        <SortTh label="P&L" sortKey="pnl" sort={sort} onSort={toggleSort} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortOccurrences(visibleOccurrences).map((o, i) => {
                        const outcome = OUTCOME_STYLE[o.outcome] ?? OUTCOME_STYLE.not_filled;
                        const pos = o.pnlPct != null && o.pnlPct >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={() => openOnChart(o, result.interval)}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            {prefs.allCoins && <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-bold whitespace-nowrap">{o.symbol}</td>}
                            {prefs.allCoins && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono text-p5/60 whitespace-nowrap">{formatVolume(o.volumeUsd)}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.signalDate)}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-yellow-600">{o.signalRsi}</td>
                            {showAll && (
                              <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">
                                {o.entryPrice != null ? `$${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}` : '—'}
                              </td>
                            )}
                            <td className={`py-0.5 pr-2 text-[10px] sm:text-xs whitespace-nowrap ${outcome.className}`}>{t(outcome.key)}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{o.exitDate ? formatDate(o.exitDate) : '—'}</td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${o.pnlUsd == null ? 'text-p5/30' : pos ? 'text-green-600' : 'text-red-600'}`}>
                              {o.pnlUsd != null ? `${pos ? '+' : ''}$${o.pnlUsd} (${pos ? '+' : ''}${o.pnlPct}%)` : '—'}
                            </td>
                          </tr>
                        );
                      })}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={(showAll ? 7 : 5) + (prefs.allCoins ? 2 : 0)} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              );
            })()}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

function MaCrossStats({ autoCalc }) {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, setChartTradeMarkers, multitradeFavorites,
    uiPrefs, setActiveIndicatorsPreference } = useCurrency();
  const { t } = useI18n();
  const [symbol, setSymbol]               = useState(selectedChart?.symbol || 'BTCUSDT');
  const [entryInterval, setEntryInterval] = useState(uiPrefs.statsDefaults.maCross.entryInterval);
  const [exitInterval, setExitInterval]   = useState(uiPrefs.statsDefaults.maCross.exitInterval);
  const [useMcInterval, setUseMcInterval] = useState(() => loadUseMcInterval('ma_cross', false));
  const [candleCount, setCandleCount]     = useState(() => loadCandleCountFor('ma_cross'));
  const [loading, setLoading]             = useState(false);
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState(null);
  const [showAll, setShowAll]             = useState(false);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';
  const inpNum = `${inp} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  async function handleSearch(overrideSymbol, updateChart = false, overrideEntryIv, overrideExitIv, overrideSource, overrideUseMc, overrideCandleCount) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const useMc = overrideUseMc ?? useMcInterval;
    const mcEntry = useMc ? mcEntryFor(multitradeFavorites, sym) : null;
    const mcEntryIv = mcEntry?.tradeConfig?.entry?.ma1?.interval ?? null;
    const mcExitIv = mcEntry?.tradeConfig?.exit?.maCross?.ma1?.interval ?? null;
    const entryIv = overrideEntryIv ?? mcEntryIv ?? entryInterval;
    const exitIv = overrideExitIv ?? mcExitIv ?? exitInterval;
    if (mcEntryIv) setEntryInterval(mcEntryIv);
    if (mcExitIv) setExitInterval(mcExitIv);
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src = overrideSource !== undefined ? overrideSource : chartSource;
    const candles = overrideCandleCount ?? candleCount;
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchMaCrossStats(sym, {
        entryInterval: entryIv,
        exitInterval: exitIv,
        source: src,
        candleCount: candles,
      });
      setResult(data);
      if (updateChart) {
        const chartData = await fetchCandlesticksAndCloud(sym, entryIv, src);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Sincroniza o campo símbolo com o gráfico. Com "Cálculo Automático" ligado (switch da
  // barra de abas), também dispara o cálculo nessa hora — senão só sincroniza o campo e o
  // cálculo espera o clique em "Buscar", como sempre foi.
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc) handleSearch(selectedChart.symbol);
  }, [selectedChart?.symbol, autoCalc]);

  function handleToggleMc(next) {
    setUseMcInterval(next);
    saveUseMcInterval('ma_cross', next);
    if (!next) { setEntryInterval('4h'); setExitInterval('4h'); }
    handleSearch(undefined, false, undefined, undefined, undefined, next);
  }

  async function openOnChart(o, entryIv) {
    const startMs = new Date(o.startDate).getTime();
    const endMs = o.endDate ? new Date(o.endDate).getTime() : Date.now();
    const msPerCandle = INTERVAL_MS[entryIv] ?? 900_000;
    const needed = Math.min(3000, Math.max(266,
      Math.ceil((Date.now() - startMs) / msPerCandle) + 40));
    try {
      const sym = (symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
      const src = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
      const data = await fetchCandlesticksAndCloud(sym, entryIv, src, needed);
      // ma9/ma21 vieram calculados só sobre os últimos 300 candles — recalcula sobre a janela
      // inteira buscada pra cobrir o período do cruzamento clicado (pode ser bem mais antigo).
      const [ma9Full, ma21Full] = await Promise.all([
        fetchEmaFull(data.candlesticks, 9),
        fetchEmaFull(data.candlesticks, 21),
      ]);
      if (ma9Full) data.ma9 = ma9Full;
      if (ma21Full) data.ma21 = ma21Full;
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      // Marca compra/venda do cruzamento clicado — mesmo visual das outras abas.
      setChartTradeMarkers([
        { time: startMs, side: 'buy', price: o.entryPrice, label: '▲ Compra' },
        o.exitPrice != null && {
          time: endMs, side: 'sell', price: o.exitPrice, pnlPct: o.appreciationPercent,
          entryTime: startMs, entryPrice: o.entryPrice,
          label: `▼ ${o.appreciationPercent >= 0 ? '+' : ''}${o.appreciationPercent}%`,
        },
      ].filter(Boolean));
      setChartZoom({
        source: CHART_VIEW.STATISTICS,
        startDate: o.startDate,
        endDate: o.endDate ?? new Date(endMs).toISOString(),
      });
      // Garante EMA9/EMA21 visíveis no gráfico — mesmas médias do cruzamento clicado, no intervalo em estudo.
      const current = uiPrefs.activeIndicators ?? [];
      const withEmas = Array.from(new Set([...current, 'ma9', 'ma21']));
      if (withEmas.length !== current.length) setActiveIndicatorsPreference(withEmas);
    } catch (err) {
      console.warn('[ma-cross stats click]', err.message);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0 flex-wrap">
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[72px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Par"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
          />
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.entry_iv')}</label>
          <select className={inp} value={entryInterval} onChange={(e) => setEntryInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.exit_iv')}</label>
          <select className={inp} value={exitInterval} onChange={(e) => setExitInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.bb_candle_count')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.card.candles')}</label>
          <select className={inp}
            value={candleCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCandleCount(v);
              saveCandleCountFor('ma_cross', v);
            }}>
            {STATS_CANDLE_COUNT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <McIntervalSwitch checked={useMcInterval} onChange={handleToggleMc} />
        <button
          onClick={() => handleSearch(undefined, true)}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label={t('stats.card.candles')} value={result.totalCandles} tooltip={t('stats.tip.candles')} />
              <SummaryCard label={t('stats.card.occur')} value={result.totalOccurrences} highlight="text-p4" tooltip={t('stats.tip.ma_occur')} />
              <SummaryCard
                label={t('stats.card.avg')}
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.avg')}
              />
              <SummaryCard label={t('stats.card.entry_rule')} value={result.entryLabel} tooltip={t('stats.tip.ma_entry')} />
              <SummaryCard label={t('stats.card.exit_rule')} value={result.exitLabel} tooltip={t('stats.tip.ma_exit')} />
              <SummaryCard label={t('stats.card.avg_duration')} value={formatDuration(result.avgCycleDurationMs)} tooltip={t('stats.tip.avg_duration')} />
            </div>

            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">{t('stats.no_cycles_ma')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.start')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.entry_p')}</th>}
                        <th className="text-right pb-1 pr-2">{t('stats.ma_entry_col')}</th>
                        <th className="text-left pb-1 pr-2">{t('stats.end')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.exit_p')}</th>}
                        <th className="text-right pb-1 pr-2">{t('stats.ma_exit_col')}</th>
                        <th className="text-right pb-1">{t('stats.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.occurrences.map((o, i) => {
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={() => openOnChart(o, result.entryInterval)}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-green-600 font-mono">
                              {o.entryMa1 != null && o.entryMa2 != null ? `${o.entryMa1.toFixed(2)} / ${o.entryMa2.toFixed(2)}` : '—'}
                            </td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-red-600 font-mono">
                              {o.exitMa1 != null && o.exitMa2 != null ? `${o.exitMa1.toFixed(2)} / ${o.exitMa2.toFixed(2)}` : '—'}
                            </td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })}

                      {result.openOccurrence && (() => {
                        const o = result.openOccurrence;
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr className="border-t-2 border-amber-500/40 bg-amber-500/5">
                            {showAll && <td className="py-1 pr-2 text-[10px] text-amber-700">↓</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-700">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-700">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-green-600 font-mono">
                              {o.entryMa1 != null && o.entryMa2 != null ? `${o.entryMa1.toFixed(2)} / ${o.entryMa2.toFixed(2)}` : '—'}
                            </td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-700 italic">{t('stats.open')}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                            <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })()}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={showAll ? 8 : 5} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

function BollingerBandsStats({ autoCalc }) {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, setChartTradeMarkers, multitradeFavorites, uiPrefs } = useCurrency();
  const { t } = useI18n();
  const [symbol, setSymbol]     = useState(selectedChart?.symbol || 'BTCUSDT');
  const [interval, setInterval] = useState(uiPrefs.statsDefaults.bollingerBands.interval);
  const [period, setPeriod]     = useState(uiPrefs.statsDefaults.bollingerBands.period);
  const [stdDev, setStdDev]     = useState(uiPrefs.statsDefaults.bollingerBands.stdDev);
  const [useMcInterval, setUseMcInterval] = useState(() => loadUseMcInterval('bollinger_bands', false));
  const [medianTrendFilter, setMedianTrendFilter] = useState(() => loadMedianTrendFilterPref());
  const [permFilter, setPermFilter] = useState(() => loadPermFilterPref());
  const [usePermBot, setUsePermBot] = useState(() => loadUsePermBotPref());
  const [pullbackPct, setPullbackPct] = useState(() => loadPullbackPct());
  const [candleCount, setCandleCount] = useState(() => loadCandleCount());
  const [lookback, setLookback] = useState(() => loadLookback());
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [showAll, setShowAll]   = useState(false);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';
  const inpNum = `${inp} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  async function handleSearch(overrideSymbol, updateChart = false, overrideInterval, overrideSource, overrideUseMc, overrideMedianTrendFilter, overridePullbackPct, overrideCandleCount, overridePermFilter, overrideUsePermBot, overrideLookback) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const useMc = overrideUseMc ?? useMcInterval;
    const mcIv  = useMc ? mcEntryFor(multitradeFavorites, sym)?.tradeConfig?.entry?.ma1?.interval : null;
    const iv  = overrideInterval ?? mcIv ?? interval;
    if (mcIv) setInterval(mcIv);
    const useMedianTrend = overrideMedianTrendFilter ?? medianTrendFilter;
    const pullback = Math.abs(overridePullbackPct ?? pullbackPct);
    const candles = overrideCandleCount ?? candleCount;
    const lb = overrideLookback ?? lookback;
    // "Perm Bot" ligado: ignora os switches manuais e usa o mesmo nível PERM do favorito
    // Bollinger Bands do manipulador pra essa moeda (ver permFilterFromBotEntry acima).
    const usePermBotFlag = overrideUsePermBot ?? usePermBot;
    const usePermFilter = usePermBotFlag
      ? permFilterFromBotEntry(bbEntryFor(multitradeFavorites, sym))
      : (overridePermFilter ?? permFilter);
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src = overrideSource !== undefined ? overrideSource : chartSource;
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchBollingerBandRecovery(sym, iv, period, stdDev, src, useMedianTrend, 10, pullback, candles, usePermFilter, lb);
      setResult(data);
      if (updateChart) {
        const chartData = await fetchCandlesticksAndCloud(sym, iv, src);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Sincroniza o campo símbolo com o gráfico. Com "Cálculo Automático" ligado (switch da
  // barra de abas), também dispara o cálculo nessa hora — senão só sincroniza o campo e o
  // cálculo espera o clique em "Buscar", como sempre foi.
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc) handleSearch(selectedChart.symbol);
  }, [selectedChart?.symbol, autoCalc]);

  function handleToggleMc(next) {
    setUseMcInterval(next);
    saveUseMcInterval('bollinger_bands', next);
    if (!next) setInterval('4h');
    handleSearch(undefined, false, undefined, undefined, next);
  }

  function handleToggleMedianTrendFilter(next) {
    setMedianTrendFilter(next);
    saveMedianTrendFilterPref(next);
    handleSearch(undefined, false, undefined, undefined, undefined, next);
  }

  function handleTogglePermFilter(key, next) {
    const merged = { ...permFilter, [key]: next };
    setPermFilter(merged);
    savePermFilterPref(merged);
    handleSearch(undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, merged);
  }

  function handleTogglePermBot(next) {
    setUsePermBot(next);
    saveUsePermBotPref(next);
    if (next) {
      // Reflete visualmente os switches manuais com o nível vindo do manipulador, mesmo
      // desabilitados — assim o usuário vê qual nível está de fato em uso na busca.
      const botPerm = permFilterFromBotEntry(bbEntryFor(multitradeFavorites, symbol.trim().toUpperCase()));
      setPermFilter(botPerm);
      savePermFilterPref(botPerm);
    }
    handleSearch(undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, next);
  }

  async function openOnChart(o, iv) {
    const startMs = new Date(o.startDate).getTime();
    const endMs   = o.endDate ? new Date(o.endDate).getTime() : Date.now();
    const msPerCandle = INTERVAL_MS[iv] ?? 14400000;
    const needed = Math.min(3000, Math.max(266,
      Math.ceil((Date.now() - startMs) / msPerCandle) + 40));
    try {
      const sym = (symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
      const src = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
      const data = await fetchCandlesticksAndCloud(sym, iv, src, needed);
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      // Marca compra/venda do ciclo clicado — mesmo visual das outras abas.
      setChartTradeMarkers([
        { time: startMs, side: 'buy', price: o.entryPrice, label: '▲ Compra' },
        o.exitPrice != null && {
          time: endMs, side: 'sell', price: o.exitPrice, pnlPct: o.appreciationPercent,
          entryTime: startMs, entryPrice: o.entryPrice,
          label: `▼ ${o.appreciationPercent >= 0 ? '+' : ''}${o.appreciationPercent}%`,
        },
      ].filter(Boolean));
      setChartZoom({
        source: CHART_VIEW.STATISTICS,
        startDate: o.startDate,
        endDate: o.endDate ?? new Date(endMs).toISOString(),
        // Overlay de Bollinger do período clicado — mesmo período/desvio/intervalo da estatística.
        bollinger: { period: result.period, stdDev: result.stdDev, interval: iv },
      });
    } catch (err) {
      console.warn('[bollinger stats click]', err.message);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0 flex-wrap">
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[72px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Par"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
          />
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Intervalo</label>
          <select className={inp} value={interval} onChange={(e) => setInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.bb_candle_count')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.card.candles')}</label>
          <select className={inp}
            value={candleCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCandleCount(v);
              saveCandleCount(v);
            }}>
            {STATS_CANDLE_COUNT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title="Restringe a busca de ciclos aos últimos N candles fechados, independente de quantos candles foram buscados em Candles (mesmo parâmetro da coluna Larg da tabela principal). Desligado = usa todos os candles buscados.">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Lookback</label>
          <select className={inp}
            value={lookback}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLookback(v);
              saveLookback(v);
            }}>
            {BB_LOOKBACK_OPTIONS.map((v) => (
              <option key={v} value={v}>{v === 0 ? 'Desligado' : v}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bb_period')}</label>
          <input className={inpNum} type="number" min={2} max={200}
            value={period} onChange={(e) => setPeriod(Number(e.target.value))} />
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bb_stddev')}</label>
          <input className={inpNum} type="number" min={0.5} max={5} step={0.1}
            value={stdDev} onChange={(e) => setStdDev(Number(e.target.value))} />
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.bb_pullback')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bb_pullback')}</label>
          <select className={inp}
            value={pullbackPct}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPullbackPct(v);
              savePullbackPct(v);
            }}>
            {BB_PULLBACK_OPTIONS.map((v) => (
              <option key={v} value={v}>{v === 0 ? 'Desligado' : `${v}%`}</option>
            ))}
          </select>
        </div>
        <McIntervalSwitch checked={useMcInterval} onChange={handleToggleMc} />
        <MedianTrendFilterSwitch checked={medianTrendFilter} onChange={handleToggleMedianTrendFilter} />
        <PermFilterSwitches value={permFilter} onToggle={handleTogglePermFilter} disabled={usePermBot} />
        <PermBotSwitch checked={usePermBot} onChange={handleTogglePermBot} />
        <button
          onClick={() => handleSearch(undefined, true)}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label={t('stats.card.candles')} value={result.totalCandles} tooltip={t('stats.tip.candles')} />
              <SummaryCard label={t('stats.card.occur')} value={result.totalOccurrences} highlight="text-p4" tooltip={t('stats.tip.bb_occur')} />
              <SummaryCard
                label={t('stats.card.avg')}
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.avg')}
              />
              <SummaryCard label={t('stats.bb_period')} value={result.period} tooltip={t('stats.tip.bb_period')} />
              <SummaryCard label={t('stats.bb_stddev')} value={result.stdDev} tooltip={t('stats.tip.bb_stddev')} />
              <SummaryCard label={t('stats.card.avg_duration')} value={formatDuration(result.avgCycleDurationMs)} tooltip={t('stats.tip.avg_duration')} />
              {result.medianTrendFilter && (
                <SummaryCard label="Filtro Mediana" value={`${result.medianTrendLookback}c`} highlight="text-emerald-500" tooltip="Só entram ciclos com a mediana da BB em alta/estável nos candles anteriores ao toque (mesmo filtro do bot)" />
              )}
              {result.permFilter && (
                <SummaryCard
                  label="Filtro PERM"
                  value={PERM_FILTER_LEVELS.filter(l => result.permFilter[l.key]).map(l => l.label).join('+')}
                  highlight="text-emerald-500"
                  tooltip="Só entram ciclos com a nuvem PERM (EMA9×EMA21) verde/fechada em TODOS os níveis marcados nesse instante (mesmo indicador do gráfico e do bot)"
                />
              )}
              {result.pullbackPct > 0 && (
                <SummaryCard label={t('stats.bb_pullback')} value={`-${result.pullbackPct}%`} highlight="text-amber-500" tooltip={t('stats.tip.bb_pullback')} />
              )}
              {result.lookback > 0 && (
                <SummaryCard label="Lookback" value={`${result.lookback}c`} highlight="text-amber-500" tooltip="Ciclos restritos aos últimos N candles fechados (mesmo parâmetro da coluna Larg)" />
              )}
            </div>

            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">{t('stats.no_cycles_bb')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.start')}</th>
                        <th className="text-right pb-1 pr-2">{t('stats.entry_p')}</th>
                        <th className="text-left pb-1 pr-2">{t('stats.end')}</th>
                        <th className="text-right pb-1 pr-2">{t('stats.exit_p')}</th>
                        <th className="text-right pb-1">{t('stats.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.occurrences.map((o, i) => {
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={() => openOnChart(o, result.interval)}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })}

                      {result.openOccurrence && (() => {
                        const o = result.openOccurrence;
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr className="border-t-2 border-amber-500/40 bg-amber-500/5">
                            {showAll && <td className="py-1 pr-2 text-[10px] text-amber-700">↓</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-700">{formatDate(o.startDate)}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-700">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-700 italic">{t('stats.open')}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                            <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })()}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={showAll ? 6 : 5} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Ganho por moeda do vwap-bands — mesmo padrão das outras abas desta tela (RSI/MA-Cross/
 * Bollinger): SIMULA a regra (escada VWAP de 3 degraus + filtro EMA200 15m -2%, mesmo motor
 * do bot real — ver backend/bot/vwap-bands/strategyEngine.js) sobre o histórico de candles
 * da moeda, mesmo que ela não seja favorita e o bot real nunca tenha executado esses trades.
 * Não lê rsi_multi_bot_trades — é backend/services/fetchVwapBandsStats.js quem simula.
 */
function VwapBandsStats({ autoCalc }) {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, setChartTradeMarkers } = useCurrency();
  const { t } = useI18n();
  const [symbol, setSymbol]       = useState(selectedChart?.symbol || 'BTCUSDT');
  // Candle principal da escada VWAP (entry.interval — reconquista/pullback/saída rodam nessa
  // unidade, ex.: waitCandles=5 vira 5 candles DESSE intervalo) — e também o intervalo usado
  // pro gráfico ao clicar numa linha da tabela. É UM SÓ campo de propósito: manter um seletor
  // separado só pra exibição (como era antes) confundia — o usuário via "1m" no gráfico e
  // esperava que o pullback também contasse em minutos, mas o cálculo seguia noutro intervalo
  // por trás. Agora os dois sempre batem.
  const [entryInterval, setEntryInterval]   = useState(() => loadVwapStatsPrefs().entryInterval ?? '1h');
  const [session, setSession]               = useState(() => loadVwapStatsPrefs().session ?? 'weekly');
  const [vwapInterval, setVwapInterval]     = useState(() => loadVwapStatsPrefs().vwapInterval ?? '4h');
  const [emaFilterEnabled, setEmaFilterEnabled] = useState(() => loadVwapStatsPrefs().emaFilterEnabled ?? true);
  const [emaFilterPeriod, setEmaFilterPeriod]   = useState(() => loadVwapStatsPrefs().emaFilterPeriod ?? 200);
  const [emaFilterInterval, setEmaFilterInterval] = useState(() => loadVwapStatsPrefs().emaFilterInterval ?? '15m');
  // Intervalo do pullback/checagem rápida (ex.: 15m) — mesmo campo entry.pullback.pollInterval
  // do formulário do favorito (VwapBandsStrategyForm), aqui só como override da simulação.
  const [pollInterval, setPollInterval]     = useState(() => loadVwapStatsPrefs().pollInterval ?? '5m');
  const [candleCount, setCandleCount]       = useState(() => loadVwapStatsPrefs().candleCount ?? STATS_CANDLE_COUNT_DEFAULT);
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);
  const [showAll, setShowAll]     = useState(false);
  // Busca automática (sync com o gráfico) e busca manual (botão Buscar) podem disparar
  // fetches concorrentes pra símbolos diferentes — só aplica a resposta se ainda for a
  // busca mais recente, senão uma resposta antiga (ex.: BTCUSDT do sync) pode sobrescrever
  // o resultado do símbolo que o usuário realmente pediu por último.
  const latestSymbolRef = useRef(null);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';
  const inpNum = `${inp} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  function patchPrefs(next) {
    saveVwapStatsPrefs({
      entryInterval, session, vwapInterval, pollInterval, emaFilterEnabled, emaFilterPeriod, emaFilterInterval, candleCount,
      ...next,
    });
  }

  async function handleSearch(overrideSymbol, overrideSource) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    if (!sym) return;
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src = overrideSource !== undefined ? overrideSource : chartSource;
    latestSymbolRef.current = sym;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchVwapBandsStats(sym, {
        source: src, entryInterval, session, vwapInterval, pollInterval, emaFilterEnabled, emaFilterPeriod, emaFilterInterval,
        candleCount,
      });
      if (latestSymbolRef.current !== sym) return;
      setResult(data);
    } catch (err) {
      if (latestSymbolRef.current !== sym) return;
      setError(err.message);
    } finally {
      if (latestSymbolRef.current === sym) setLoading(false);
    }
  }

  // Sincroniza o campo símbolo com o gráfico. Com "Cálculo Automático" ligado (switch da
  // barra de abas), também dispara o cálculo nessa hora — senão só sincroniza o campo e o
  // cálculo espera o clique em "Buscar", como sempre foi.
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc) handleSearch(selectedChart.symbol);
  }, [selectedChart?.symbol, autoCalc]);

  async function openOnChart(o) {
    const signalMs = o.signalDate ? new Date(o.signalDate).getTime() : null;
    const startMs = new Date(o.startDate).getTime();
    const endMs = o.endDate ? new Date(o.endDate).getTime() : Date.now();
    // Zoom começa no sinal (reconquista da linha) quando ele existir e for anterior à compra
    // (retorno/pullback) — senão o candle que armou o ciclo fica de fora da janela visível.
    const zoomStartMs = signalMs != null && signalMs < startMs ? signalMs : startMs;
    const iv = entryInterval;
    const msPerCandle = INTERVAL_MS[iv] ?? 3_600_000;
    // Teto de 10500 (não 3000) — mesmo limite do cache em disco pra 1m (RETENTION_LIMIT_BY_INTERVAL
    // em getCandles.js): sem isso, a VWAP desenhada no gráfico ficava presa a um histórico bem menor
    // do que o motor de verdade usou pra decidir o sinal, mostrando bandas fora do lugar.
    const needed = Math.min(10500, Math.max(266,
      Math.ceil((Date.now() - zoomStartMs) / msPerCandle) + 40));
    try {
      const sym = (symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
      const src = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
      const data = await fetchCandlesticksAndCloud(sym, iv, src, needed);
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      // Marca sinal/compra/venda simulados (mesmo visual das outras telas de trade — ver
      // buildMarkersFromLiveTrades) e força a VWAP+bandas do intervalo/sessão usados na
      // simulação, pra ver exatamente a banda que gerou o sinal/entrada/saída daquele ciclo.
      setChartTradeMarkers([
        signalMs != null && {
          time: signalMs, side: 'signal', price: o.signalPrice ?? null,
          label: o.signalLevel ? `◌ ${o.signalLevel}` : undefined,
        },
        { time: startMs, side: 'buy', price: o.entryPrice, label: '▲ Compra' },
        o.exitPrice != null && {
          time: endMs, side: 'sell', price: o.exitPrice, pnlPct: o.appreciationPercent,
          entryTime: startMs, entryPrice: o.entryPrice,
          label: `▼ ${o.appreciationPercent >= 0 ? '+' : ''}${o.appreciationPercent}%`,
        },
      ].filter(Boolean));
      setChartZoom({
        source: CHART_VIEW.STATISTICS,
        startDate: zoomStartMs === signalMs ? o.signalDate : o.startDate,
        endDate: o.endDate ?? new Date(endMs).toISOString(),
        vwap: result?.vwapInterval ? { interval: result.vwapInterval, session: result.session } : undefined,
      });
    } catch (err) {
      console.warn('[vwap-bands stats click]', err.message);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0 flex-wrap">
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[72px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Par"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>

        {/* Candle principal (entry.interval) — reconquista/pullback/saída rodam nessa unidade,
            e é também o intervalo usado no gráfico ao clicar numa linha (um só campo, ver
            comentário no useState acima). */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Candle</label>
          <select className={inp} value={entryInterval}
            onChange={(e) => { setEntryInterval(e.target.value); patchPrefs({ entryInterval: e.target.value }); }}>
            {VWAP_BANDS_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>

        {/* VWAP intervalo */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">VWAP</label>
          <select className={inp} value={vwapInterval}
            onChange={(e) => { setVwapInterval(e.target.value); patchPrefs({ vwapInterval: e.target.value }); }}>
            {VWAP_BANDS_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>

        {/* Sessão (semanal/diária) */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[64px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Sessão</label>
          <select className={inp} value={session}
            onChange={(e) => { setSession(e.target.value); patchPrefs({ session: e.target.value }); }}>
            {VWAP_BANDS_SESSIONS.map((s) => (
              <option key={s} value={s}>{s === 'weekly' ? 'Semanal' : 'Diária'}</option>
            ))}
          </select>
        </div>

        {/* Pullback/checagem rápida (entry.pullback.pollInterval) */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Pullback</label>
          <select className={inp} value={pollInterval}
            onChange={(e) => { setPollInterval(e.target.value); patchPrefs({ pollInterval: e.target.value }); }}>
            {VWAP_BANDS_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>

        {/* Filtro EMA200 */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[80px]">
          <label className="flex items-center gap-1 text-[9px] text-p5/50 uppercase tracking-wider cursor-pointer">
            <input type="checkbox" checked={emaFilterEnabled}
              onChange={(e) => { setEmaFilterEnabled(e.target.checked); patchPrefs({ emaFilterEnabled: e.target.checked }); }}
              className="accent-p4" />
            EMA
          </label>
          <select className={inp} value={emaFilterPeriod} disabled={!emaFilterEnabled}
            onChange={(e) => { setEmaFilterPeriod(Number(e.target.value)); patchPrefs({ emaFilterPeriod: Number(e.target.value) }); }}>
            {EMA_FILTER_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Intervalo da EMA (timeframe em que ela é calculada) */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Intv. EMA</label>
          <select className={inp} value={emaFilterInterval} disabled={!emaFilterEnabled}
            onChange={(e) => { setEmaFilterInterval(e.target.value); patchPrefs({ emaFilterInterval: e.target.value }); }}>
            {VWAP_BANDS_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>

        {/* Candles */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]" title={t('stats.tip.bb_candle_count')}>
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.card.candles')}</label>
          <select className={inp}
            value={candleCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCandleCount(v);
              patchPrefs({ candleCount: v });
            }}>
            {STATS_CANDLE_COUNT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <button
          onClick={() => handleSearch()}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label={t('stats.card.candles')} value={result.totalCandles} tooltip={t('stats.tip.candles')} />
              <SummaryCard label={t('stats.card.occur')} value={result.totalOccurrences} highlight="text-p4" tooltip={t('stats.tip.vwap_occur')} />
              <SummaryCard
                label={t('stats.card.avg')}
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.avg')}
              />
              <SummaryCard label={t('stats.card.entry_rule')} value={result.entryLabel} tooltip={t('stats.tip.vwap_entry')} />
              <SummaryCard label={t('stats.card.avg_duration')} value={formatDuration(result.avgCycleDurationMs)} tooltip={t('stats.tip.avg_duration')} />
            </div>

            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">{t('stats.no_cycles_vwap')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.signal')}</th>
                        <th className="text-left pb-1 pr-2">{t('stats.start')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.entry_p')}</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.end')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.exit_p')}</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.exit_reason')}</th>
                        <th className="text-right pb-1">{t('stats.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.occurrences.map((o, i) => {
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={() => openOnChart(o)}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-600/80">
                              {o.signalDate ? formatDate(o.signalDate) : '—'}
                              {o.signalLevel && <span className="text-p5/40"> ({o.signalLevel})</span>}
                            </td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-p5/60 whitespace-nowrap">{o.exitReason ?? '—'}</td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })}

                      {result.openOccurrence && (() => {
                        const o = result.openOccurrence;
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            title={t('stats.click_row')}
                            className="border-t-2 border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 transition-colors cursor-pointer"
                            onClick={() => openOnChart(o)}
                          >
                            {showAll && <td className="py-1 pr-2 text-[10px] text-amber-700">↓</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-600/80">
                              {o.signalDate ? formatDate(o.signalDate) : '—'}
                              {o.signalLevel && <span className="text-p5/40"> ({o.signalLevel})</span>}
                            </td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-700">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-700">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-700 italic">{t('stats.open')}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-p5/30">—</td>
                            <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })()}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={showAll ? 8 : 5} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

export default function StatisticsPanel() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('rsi');
  const [autoCalc, setAutoCalc] = useState(() => loadAutoCalcPref());

  function handleToggleAutoCalc(next) {
    setAutoCalc(next);
    saveAutoCalcPref(next);
  }

  return (
    <div className="flex flex-col h-full">

      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-p3/20 px-4 pt-3 shrink-0">
        <div className="flex gap-1 flex-1 min-w-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-xs rounded-t transition-colors shrink-0 ${
                activeTab === tab.id ? 'bg-p4 text-white' : 'text-p5/60 hover:text-p5'
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <AutoCalcSwitch checked={autoCalc} onChange={handleToggleAutoCalc} />
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 pb-3 pt-2">
        {activeTab === 'rsi' && <RsiStats autoCalc={autoCalc} />}
        {activeTab === 'rsi_momentum' && <RsiMomentumStats autoCalc={autoCalc} />}
        {activeTab === 'ma_cross' && <MaCrossStats autoCalc={autoCalc} />}
        {activeTab === 'bollinger_bands' && <BollingerBandsStats autoCalc={autoCalc} />}
        {activeTab === 'vwap_bands' && <VwapBandsStats autoCalc={autoCalc} />}
      </div>
    </div>
  );
}

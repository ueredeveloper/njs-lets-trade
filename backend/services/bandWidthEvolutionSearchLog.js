'use strict';

/**
 * Log das pesquisas feitas na tela Estatísticas → Banda BB (frontend-react/src/components/
 * BandWidthEvolutionStats.jsx). Cada vez que o usuário clica "Buscar" (ou Enter), o front manda a
 * config usada + o RESUMO do resultado pra cá, e a gente acrescenta num JSON em
 * backend/data/band-width-evolution-searches.json — pra comparar depois quais moedas/parâmetros
 * mostraram expansão rápida da banda (ver conversa sobre afrouxar entry.supportResistance no RSI
 * Momentum). Mesmo padrão do log de rsiMomentumStatsSearchLog.js, log isolado de propósito.
 *
 * Escopo símbolo: guarda o resumo (largura atual/N candles atrás/delta/thrust), nunca a série
 * candle-a-candle inteira. Escopo mercado: guarda só as top 30 linhas (já vêm ordenadas por
 * deltaPct desc do endpoint), não as ~493 moedas inteiras. Últimos MAX_RECORDS mantidos (FIFO),
 * mais recente primeiro.
 */

const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../data/band-width-evolution-searches.json');
const MAX_RECORDS = 500;
const MAX_MARKET_ROWS = 30;

function readLog() {
  try {
    const arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeLog(arr) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(arr, null, 2));
}

function summarizeResult(r = {}, scope) {
  if (scope === 'market') {
    const rows = Array.isArray(r.rows) ? r.rows : [];
    return { rowsCount: rows.length, topRows: rows.slice(0, MAX_MARKET_ROWS) };
  }
  return {
    symbol: r.symbol ?? null,
    currentWidthPct: r.currentWidthPct ?? null,
    widthNCandlesAgo: r.widthNCandlesAgo ?? null,
    deltaPct: r.deltaPct ?? null,
    expansion: r.expansion ?? null,
  };
}

// GET /services/band-width-evolution-searches — lista as pesquisas salvas (mais recente primeiro)
router.get('/band-width-evolution-searches', (req, res) => {
  res.json(readLog());
});

// POST /services/band-width-evolution-searches — { scope, config, result }
router.post('/band-width-evolution-searches', (req, res) => {
  const { scope, config, result } = req.body ?? {};
  if (!config || !result) {
    return res.status(400).json({ error: 'Campos obrigatórios: config, result' });
  }

  const record = {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    scope: scope === 'market' ? 'market' : 'symbol',
    config, // parâmetros do painel (interval/period/stdDev/lookback/fromPct/toPct/deltaCandles/symbol)
    result: summarizeResult(result, scope),
  };

  const log = readLog();
  log.unshift(record);
  writeLog(log.slice(0, MAX_RECORDS));
  res.json({ saved: true, id: record.id, total: Math.min(log.length, MAX_RECORDS) });
});

// DELETE /services/band-width-evolution-searches       — limpa tudo
// DELETE /services/band-width-evolution-searches/:id   — remove uma pesquisa
router.delete('/band-width-evolution-searches/:id?', (req, res) => {
  const { id } = req.params;
  if (!id) {
    writeLog([]);
    return res.json({ cleared: true, total: 0 });
  }
  const log = readLog().filter((r) => String(r.id) !== String(id));
  writeLog(log);
  res.json({ removed: true, total: log.length });
});

module.exports = router;

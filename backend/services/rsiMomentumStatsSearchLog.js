'use strict';

/**
 * Log das pesquisas feitas na tela Estatísticas → Momentum RSI (frontend-react/src/components/
 * StatisticsPanel.jsx#RsiMomentumStats). Cada vez que o usuário clica "Buscar" (ou Enter), o
 * front manda a config usada + o RESUMO do resultado pra cá, e a gente acrescenta num JSON em
 * backend/data/rsi-momentum-stats-searches.json — pra comparar depois qual combinação de
 * alvo/stop/filtros deu o melhor P&L.
 *
 * Só o resumo é gravado (nunca a lista de trades/occurrences — pode ter centenas de linhas).
 * Últimos MAX_RECORDS mantidos (FIFO), mais recente primeiro.
 */

const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../data/rsi-momentum-stats-searches.json');
const MAX_RECORDS = 500;

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

/** Extrai só os campos de RESUMO do resultado do backtest (single ou market) — descarta
 *  `occurrences` e qualquer coisa grande. */
function summarizeResult(r = {}) {
  return {
    totalSignals: r.totalSignals ?? null,
    totalFilled: r.totalFilled ?? null,
    totalTarget: r.totalTarget ?? null,
    totalStop: r.totalStop ?? null,
    totalOpen: r.totalOpen ?? null,
    totalNotFilled: r.totalNotFilled ?? null,
    stopBaseCount: r.stopBaseCount ?? null,
    stopEvolvedCount: r.stopEvolvedCount ?? null,
    targetBaseCount: r.targetBaseCount ?? null,
    targetEvolvedCount: r.targetEvolvedCount ?? null,
    volumeBreakdown: r.volumeBreakdown ?? null,
    winRatePct: r.winRatePct ?? null,
    totalInvestedUsd: r.totalInvestedUsd ?? null,
    totalPnlUsd: r.totalPnlUsd ?? null,
    avgPnlPct: r.avgPnlPct ?? null,
    dailyEntryStats: r.dailyEntryStats ?? null,
    tradeDuration: r.tradeDuration ?? null,
    cloudZoneStats: r.cloudZoneStats ?? null,
    // só no modo mercado (allCoins)
    symbolsTotal: r.symbolsTotal ?? null,
    symbolsScanned: r.symbolsScanned ?? null,
    symbolsBlockedByVolume: r.symbolsBlockedByVolume ?? null,
    symbolsBlockedByBandWidth: r.symbolsBlockedByBandWidth ?? null,
    candleSpanMs: r.candleSpanMs ?? null,
    totalCandles: r.totalCandles ?? null,
  };
}

// GET /services/rsi-momentum-stats-searches — lista as pesquisas salvas (mais recente primeiro)
router.get('/rsi-momentum-stats-searches', (req, res) => {
  res.json(readLog());
});

// POST /services/rsi-momentum-stats-searches — { scope, interval, config, result }
router.post('/rsi-momentum-stats-searches', (req, res) => {
  const { scope, interval, config, result } = req.body ?? {};
  if (!config || !result) {
    return res.status(400).json({ error: 'Campos obrigatórios: config, result' });
  }

  const record = {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    scope: scope || 'unknown', // 'market' (todas as moedas) ou o símbolo, ex. 'BTCUSDT'
    interval: interval || config.interval || null,
    config, // a config completa mandada pro backtest (commonOptions + allCoins)
    result: summarizeResult(result),
  };

  const log = readLog();
  log.unshift(record);
  writeLog(log.slice(0, MAX_RECORDS));
  res.json({ saved: true, id: record.id, total: Math.min(log.length, MAX_RECORDS) });
});

// DELETE /services/rsi-momentum-stats-searches       — limpa tudo
// DELETE /services/rsi-momentum-stats-searches/:id   — remove uma pesquisa
router.delete('/rsi-momentum-stats-searches/:id?', (req, res) => {
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

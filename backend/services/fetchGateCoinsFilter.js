const router = require('express').Router();
const { getAllGateCurrencies } = require('../gate/getAllGateCurrencies');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');

/** 1_000_000 → "1M", 500_000 → "500k", 2_500_000 → "2.5M" */
function fmtVol(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
    return String(Math.round(n));
}

// GET /services/gate-coins-filter
//   ?minVolumeUsdt=1000000        volume 24h (quote_volume USDT) mínimo na Gate.io
//   &maxVolumeUsdt=               (opcional) volume 24h máximo
//   &binancePresence=only_gate    only_gate = NÃO listadas na Binance (default)
//                                 only_overlap = listadas nas DUAS
//                                 any = tanto faz
//
// Lista de descoberta de moedas pra operar na Gate.io: cruza os tickers spot da Gate
// (getAllGateCurrencies) com os pares USDT ativos da Binance (getActiveUsdtPairs) e filtra por
// presença + volume. Devolve o mesmo formato { name, list, details } dos outros filtros do painel
// "Analisar indicadores".
router.get('/gate-coins-filter', async (req, res) => {
    try {
        const minVol = req.query.minVolumeUsdt ? parseFloat(req.query.minVolumeUsdt) : 0;
        const maxVol = req.query.maxVolumeUsdt ? parseFloat(req.query.maxVolumeUsdt) : Infinity;
        const presence = ['only_gate', 'only_overlap', 'any'].includes(req.query.binancePresence)
            ? req.query.binancePresence
            : 'only_gate';

        const [gate, usdtPairs] = await Promise.all([getAllGateCurrencies(), getActiveUsdtPairs()]);
        const binanceSet = new Set(usdtPairs.list ?? []);

        const list = [];
        const details = {};
        for (const c of gate) {
            // Só pares "de verdade" (A–Z/0–9 + USDT) — a Gate lista alguns com nome em outros
            // alfabetos (ex.: 龙虾USDT) que não interessam pra trade automatizado.
            if (!/^[A-Z0-9]{1,20}USDT$/.test(c.symbol)) continue;
            const onBinance = binanceSet.has(c.symbol);
            if (presence === 'only_gate' && onBinance) continue;
            if (presence === 'only_overlap' && !onBinance) continue;
            const vol = Number(c.volume) || 0;
            if (vol < minVol || vol > maxVol) continue;
            list.push(c.symbol);
            details[c.symbol] = { volume: vol, onBinance, price: c.price };
        }
        list.sort((a, b) => details[b].volume - details[a].volume);

        const presenceSlug = presence === 'only_gate' ? 'só Gate'
            : presence === 'only_overlap' ? 'Gate+Bnb'
                : 'Gate';
        const range = [];
        if (minVol > 0) range.push(`≥$${fmtVol(minVol)}`);
        if (Number.isFinite(maxVol)) range.push(`≤$${fmtVol(maxVol)}`);
        const name = `Gate|${presenceSlug}${range.length ? `|${range.join(' ')}` : ''}`;

        res.json({ name, list, details, scannedAt: Date.now() });
    } catch (err) {
        console.error('[gate-coins-filter]', err.message);
        res.status(502).json({ error: err.message });
    }
});

module.exports = router;

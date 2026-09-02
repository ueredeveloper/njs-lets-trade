'use strict';

const supabase = require('../supabase/client');

const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';
const TTL_MS = 60 * 1000; // 1 min — mesma ordem de grandeza dos outros caches de lista

let _cache = null;
let _cachedAt = 0;

/**
 * Símbolos que o usuário marcou como favoritos da Gate.io (tabela `favorites_gate`,
 * `gate_added = true` — mesma fonte da lista "Favoritos|Gate" do frontend e do
 * getAllCurrencies.js). Sempre em UPPERCASE, sem `_` (ex.: 'SKYAIUSDT').
 *
 * Fail-open: qualquer erro (Supabase fora, env ausente) devolve `[]` — quem chama trata a
 * ausência de favoritos como "só Binance", nunca quebra o cálculo.
 *
 * @param {string} [userId]
 * @returns {Promise<string[]>}
 */
async function getGateFavoriteSymbols(userId = DEFAULT_USER_ID) {
    if (_cache && Date.now() - _cachedAt < TTL_MS) return _cache;
    try {
        const { data, error } = await supabase
            .from('favorites_gate')
            .select('symbol')
            .eq('user_id', userId)
            .eq('gate_added', true);
        if (error) throw error;
        const symbols = [...new Set((data ?? [])
            .map((r) => String(r.symbol ?? '').toUpperCase().replace(/_/g, ''))
            .filter(Boolean))];
        _cache = symbols;
        _cachedAt = Date.now();
        return symbols;
    } catch (err) {
        console.warn('[getGateFavoriteSymbols] falha — sem favoritos Gate:', err.message);
        return _cache ?? [];
    }
}

module.exports = { getGateFavoriteSymbols };

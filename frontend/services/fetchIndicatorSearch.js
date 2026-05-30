
/**
 * Converts "8h|rsi|above|70|bellow|99" → "8h|r|a|70|b|99" (nome normalizado).
 */
function buildNome(query) {
    const parts = query.trim().split('|');
    const interval = parts[0];
    const indRaw = parts[1].toLowerCase();
    const indicator = (indRaw === 'rsi' || indRaw === 'r') ? 'r' : indRaw[0];
    const condParts = [];
    for (let i = 2; i + 1 < parts.length; i += 2) {
        const cond = (parts[i][0].toLowerCase() === 'a') ? 'a' : 'b';
        condParts.push(`${cond}|${parts[i + 1]}`);
    }
    return `${interval}|${indicator}|${condParts.join('|')}`;
}

/**
 * Envia a query string para o backend e retorna um objeto de filtro pronto
 * para ser adicionado ao CurrencyModel: { name, list }.
 *
 * @param {string} query  Ex: "8h|rsi|above|70|bellow|99"
 * @returns {Promise<{name: string, list: string[]}>}
 */
async function fetchIndicatorSearch(query) {
    console.log('[frontend] fetchIndicatorSearch → enviando query:', query);

    const response = await fetch(`/services/indicator-search?query=${encodeURIComponent(query)}`);
    if (!response.ok) {
        throw new Error(`indicator-search falhou: HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('[frontend] fetchIndicatorSearch ← recebido:', data.length, 'moedas', data);

    const nome = data.length > 0 ? data[0].nome : buildNome(query);
    // Backend retorna "BTC/USDT"; CurrencyModel usa "BTCUSDT"
    const list = data.map(r => r.coin.symbol.replace('/USDT', 'USDT'));

    console.log('[frontend] filtro criado:', nome, '→', list.length, 'símbolos:', list);

    return { name: nome, list };
}

export default fetchIndicatorSearch;

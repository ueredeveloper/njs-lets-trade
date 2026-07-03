import { useLanguage } from './contexts/LanguageContext';

// ─── Dicionário completo ──────────────────────────────────────────────────────

const T = {
  pt: {
    // App
    'app.loading':           'Carregando moedas...',
    'app.analyze':           'Analisar Indicadores',
    'app.statistics':        'Estatísticas',
    'app.currencies':        'Moedas',
    'app.crypto_screener':   'crypto screener',

    // Configurações
    'settings.title':        'Configurações',
    'settings.language':     'Idioma',
    'settings.palette':      'Paleta de cores',
    'settings.reload':       'Recarregar candles',
    'settings.reload_btn':   'Buscar 1000 candles',
    'settings.loading':      'Buscando...',
    'settings.symbol_ph':    'Símbolo (ex: BTCUSDT)',
    'settings.all':          'Todos',
    'settings.error':        'erro',
    'settings.asset_display': 'Exibição de ativos',
    'settings.asset_display_hint': 'Por padrão só criptomoedas spot tradicionais. Marque para incluir categorias especiais.',
    'settings.category.stablecoins':     'Stablecoins',
    'settings.category.leveragedLong': 'Tokens alavancados Long (3L, 5L, BULL…)',
    'settings.category.leveragedShort':'Tokens alavancados Short (3S, 5S, BEAR…)',
    'settings.category.wrapped':         'Wrapped Tokens (WBTC, WETH, bridged…)',
    'settings.category.liquidStaking': 'Staking líquido (stETH, cbETH, mSOL…)',
    'settings.category.lpTokens':        'LP Tokens (Liquidity Provider)',
    'settings.category.synthetic':       'Tokens sintéticos ou derivados',

    // Indicadores — tipos
    'ind.placeholder':       'Indicador',
    'ind.ichimoku':          'Nuvens de Ichimoku',
    'ind.ma':                'Média Móvel',
    'ind.ma_time_above':     '% Tempo acima MA',
    'ind.ma_crossover':      'Cruzamento de MAs',
    'ind.rsi':               'RSI',
    'ind.marketcap':         'Market Cap',

    // Indicadores — descrições tooltip
    'ind.desc.ichimoku':     'Sistema japonês com 5 linhas que indica tendência, suporte/resistência e momentum. Muito usado em análise técnica avançada.',
    'ind.desc.ma':           'Média Móvel Simples (SMA) — média dos últimos N preços de fechamento. Quando o preço cruza a MA, sinaliza mudança de tendência.',
    'ind.desc.ma_time_above': '% do histórico em que o close ficou acima da MA50 (igual ao gráfico Binance), no(s) intervalo(s) escolhido(s). Cache no servidor — outros % reutilizam os dados.',
    'ind.desc.ma_crossover':  'SMA9 × SMA21: escolha o timeframe dos candles (5m, 15m, 1h…) e há quanto tempo cruzou (≤5 min = cruzou nos últimos 5 minutos). São coisas independentes.',
    'ind.desc.rsi':          'RSI — oscilador de 0 a 100 que mede força do movimento. Abaixo de 30 = sobrevendido (possível alta). Acima de 70 = sobrecomprado (possível queda).',
    'ind.desc.marketcap':    'Cruza dados da CoinGecko com o volume da Binance. "Giro de volume" detecta moedas com preço inflado sem sustentação real de negócios. "Diluição futura" identifica tokens com muita emissão ainda pendente.',

    // Comparadores
    'cmp.above':             'Acima',
    'cmp.bellow':            'Abaixo',

    // Linhas do candle
    'candle.high':           'Máxima',
    'candle.close':          'Fechamento',
    'candle.low':            'Mínima',
    'candle.high_full':      'Máxima do Candle',
    'candle.close_full':     'Fechamento do Candle',
    'candle.low_full':       'Mínima do Candle',

    // Ichimoku
    'ichi.conversion':       'Conversão',
    'ichi.base':             'Base',
    'ichi.spanA':            'Span A',
    'ichi.spanB':            'Span B',
    'ichi.spanAB':           'Span A+B',
    'ichi.high':             'Máxima',
    'ichi.close':            'Fechamento',
    'ichi.low':              'Mínima',
    'ichi.label.conversion': 'Conversão (Tenkan-sen) — média das últimas 9 barras',
    'ichi.label.base':       'Base (Kijun-sen) — média das últimas 26 barras',
    'ichi.label.spanA':      'Span A — borda superior/inferior da nuvem',
    'ichi.label.spanB':      'Span B — borda oposta da nuvem',
    'ichi.label.spanAB':     'Span A + B — acima de ambas as bordas da nuvem',
    'ichi.label.high':       'High — máxima do candle',
    'ichi.label.close':      'Close — fechamento do candle',
    'ichi.label.low':        'Low — mínima do candle',

    // Market Cap
    'mcap.turnover':         'Giro de Volume',
    'mcap.dilution':         'Diluição Futura',
    'mcap.low_t':            'Baixo — possível inflado (<5%)',
    'mcap.mid_t':            'Médio — normal (5–30%)',
    'mcap.high_t':           'Alto — especulativo (>30%)',
    'mcap.low_d':            'Baixo — pouca diluição (<2×)',
    'mcap.mid_d':            'Médio — moderado (2–5×)',
    'mcap.high_d':           'Alto — risco elevado (>5×)',
    'mcap.tip_t':            'Baixo <5% (inflado) · Médio 5–30% (normal) · Alto >30% (especulativo)',
    'mcap.tip_d':            'Baixo <2× (saudável) · Médio 2–5× · Alto >5× (risco de diluição)',
    'mcap.tip_metric':       'Giro: volume÷market cap. Baixo = preço sem sustentação real. Diluição: tokens ainda não emitidos vs. cap atual.',

    // Intervalos
    'iv.add':                'Adicionar intervalo',
    'iv.remove':             'Remover',

    // Botões painel de indicadores
    'ip.add_row':            'Adicionar outra condição de indicador para a mesma busca',
    'ip.remove_row':         'Remover o último indicador da lista',
    'ip.search':             'Executar a busca — pode demorar alguns segundos dependendo da quantidade de moedas e intervalos',
    'ip.searching':          'Buscando...',

    // Resumo do indicador (buildSummary)
    'sum.rsi':               (c1, v1, c2, v2, ivl) => `RSI ${c1} ${v1} e ${c2} ${v2} → ${ivl}`,
    'sum.ichimoku':          (l1, cmp, l2, ivl) => `Ichimoku: ${l1} ${cmp} ${l2} → ${ivl}`,
    'sum.ma':                (len, cmp, cdl, ivl) => `MA${len}: preço (${cdl}) ${cmp} da média → ${ivl}`,
    'sum.ma_time_above':     (per, pct, ivl) => `MA${per}: ≥${pct}% do histórico acima da MA → ${ivl}`,
    'sum.macross':           (p1, iv1, p2, iv2, mode, extra) => `SMA${p1}(${iv1}) × SMA${p2}(${iv2}): ${mode} ${extra}`,
    'sum.macross_age':       (age, tol) => `(há ${age}, tol ±${tol}%)`,
    'sum.macross_prox':      (prox) => `(gap ≤${prox}%)`,
    'sum.mcap':              (metric, preset) => `Market Cap: ${metric} ${preset}`,
    'sum.above':             'acima de',
    'sum.bellow':            'abaixo de',
    'sum.above_short':       'acima',
    'sum.bellow_short':      'abaixo',

    // Tabela de moedas
    'table.search':          'Buscar moeda...',
    'table.currencies':      'Moedas',
    'table.macross_crossed': (arrow, age) => `${arrow} cruzou há ${age}`,
    'table.macross_near':    (arrow, gap) => `≈${arrow} gap ${gap}`,

    // Estatísticas
    'stats.search':          'Buscar',
    'stats.details':         'Detalhes',
    'stats.start':           'Início',
    'stats.end':             'Fim',
    'stats.entry_p':         'P. entrada',
    'stats.exit_p':          'P. saída',
    'stats.rsi':             'RSI',
    'stats.value':           'Valor.',
    'stats.open':            'em aberto',
    'stats.configure':       'Configure os parâmetros e clique em Buscar.',
    'stats.click_row':       'Clique para ver este período no gráfico',
    'stats.card.candles':    'Candles',
    'stats.card.rsi_p':      'Períodos RSI',
    'stats.card.occur':      'Ocorrências',
    'stats.card.avg':        'Valor. média',
    'stats.card.entry_rsi':  'RSI entrada',
    'stats.card.exit_rsi':   'RSI saída',
    'stats.tip.candles':     'Total de candles analisados no período selecionado.',
    'stats.tip.rsi_p':       'Candles com RSI calculado — os primeiros 14 são descartados pelo período do indicador.',
    'stats.tip.occur':       'Número de ciclos completos: entrada na sobrevenda e saída na sobrecompra.',
    'stats.tip.avg':         'Valor em aberto não é contabilizado.',
    'stats.tip.entry_rsi':   'RSI abaixo deste valor marca o início de um ciclo (zona de sobrevenda).',
    'stats.tip.exit_rsi':    'RSI acima deste valor encerra o ciclo (zona de sobrecompra).',

    // Gráfico
    'chart.select':          'Selecione uma moeda para ver o gráfico',

    // Filtros — descrições
    'filter.usdt':           'Todos os pares USDT (Binance + Gate.io)',
    'filter.btc':            'Moedas com par BTC',
    'filter.bnb':            'Moedas com par BNB',
    'filter.vol_above':      (val, ivl) => `Volume acima de ${val} USDT (${ivl})`,
    'filter.vol_range':      (lo, hi, ivl) => `Volume entre ${lo} e ${hi} USDT (${ivl})`,
    'filter.mkt_above':      (val) => `Volume acima de ${val} USDT (Binance + Gate.io)`,
    'filter.mkt_range':      (lo, hi) => `Volume entre ${lo} e ${hi} USDT (Binance + Gate.io)`,
    'filter.rsi':            (c1, v1, c2, v2, ivl) => `RSI ${c1} de ${v1} e ${c2} de ${v2} (${ivl})`,
    'filter.ichi':           (l1, cmp, l2, ivl) => `Ichimoku: ${l1} ${cmp} ${l2} (${ivl})`,
    'filter.ma':             (p, cmp, cdl, ivl) => `MA${p} ${cmp} ${cdl} (${ivl})`,
    'filter.ma_pct':         (p, pct, ivl) => `MA${p}: ≥${pct}% do histórico acima da MA (${ivl})`,
    'filter.macross':        (p1, iv1, p2, iv2, mode, extra, sigIv) => `SMA${p1}(${iv1}) × SMA${p2}(${iv2}): ${mode} ${extra} [${sigIv}]`,
    'filter.macross.cross_up':   'cruzou para cima',
    'filter.macross.cross_down': 'cruzou para baixo',
    'filter.macross.near_up':    'próximo de cruzar ↑',
    'filter.macross.near_down':  'próximo de cruzar ↓',
    'filter.macross.age_last':   'no último candle',
    'filter.macross.age_min':    (min) => `há ≤${min} min`,
    'filter.acima':          'acima do',
    'filter.abaixo':         'abaixo do',
    'filter.mcap_low_t':     'Volume baixo vs. market cap — possivelmente inflado (<5%)',
    'filter.mcap_mid_t':     'Volume normal vs. market cap (5–30%)',
    'filter.mcap_high_t':    'Volume alto vs. market cap — especulativo (>30%)',
    'filter.mcap_low_d':     'Poucos tokens ainda por vir — FDV até 2× market cap (a maior parte do supply já circula)',
    'filter.mcap_mid_d':     'Diluição moderada — FDV entre 2× e 5× market cap',
    'filter.mcap_high_d':    'Alta diluição futura — FDV acima de 5× market cap',
    'filter.stables_usd':    'Stablecoins atreladas ao dólar (USDC, DAI, FDUSD…)',
    'filter.stables_eur':    'Stablecoins atreladas ao euro (EURT, EURC…)',
    'filter.stables_gold':   'Tokens lastreados em ouro (PAXG, XAUT…)',
    'filter.stables_other':  'Stablecoins de outras moedas (JPY, IDR, SGD…)',

    // Cruzamento de MAs — UI
    'macross.mode.cross_up':   'Cruzou ↑',
    'macross.mode.cross_down': 'Cruzou ↓',
    'macross.mode.near_up':    'Prestes ↑',
    'macross.mode.near_down':  'Prestes ↓',
    'macross.age.last':        'Último candle fechado',
    'macross.age.1':           '≤ 1 min',
    'macross.age.5':           '≤ 5 min',
    'macross.age.15':          '≤ 15 min',
    'macross.age.30':          '≤ 30 min',
    'macross.age.60':          '≤ 1 h',
    'macross.age.240':         '≤ 4 h',
    'macross.age.1440':        '≤ 24 h',
    'macross.mixed_intervals': 'Intervalos diferentes por SMA',
    'macross.label.candles':   'Candles das SMAs',
    'macross.label.age':       'Cruzou há',
    'macross.add_age':         'Adicionar janela temporal',
    'macross.remove_age':      'Remover',
    'macross.tip.candle_iv':   'Em qual timeframe as SMAs são calculadas (5m, 15m, 1h…). Independente de “cruzou há”.',
    'macross.tip.age':         'Há quanto tempo o cruzamento ocorreu (ex.: ≤5 min = cruzou nos últimos 5 minutos)',
    'macross.tip.tolerance':   'Tolerância no cruzamento (±%) — relaxa a condição no candle anterior',
    'macross.tip.proximity':   'Distância máxima entre as SMAs (% da SMA lenta) — atualiza em tempo real',
    'macross.tip.iv1':         'Intervalo da SMA rápida',
    'macross.tip.iv2':         'Intervalo da SMA lenta',
    'macross.tip.ma1':         'SMA rápida (período menor, ex: 9)',
    'macross.tip.ma2':         'SMA lenta (período maior, ex: 21 ou 200)',
    'macross.tip.mode':        'Cruzou = já cruzou (filtra por tempo). Prestes = gap encolhendo, ainda não cruzou. Ambas são SMA.',

    // Botões filtros
    'filter.search_ph':      'Buscar filtro...',
    'filter.btn_join':       'Intersecionar filtros marcados — exibe apenas moedas presentes em TODOS os filtros selecionados',
    'filter.btn_remove':     'Remover filtros marcados da lista',
    'filter.btn_clear':      'Limpar todos os filtros e voltar à lista completa',
  },

  en: {
    // App
    'app.loading':           'Loading currencies...',
    'app.analyze':           'Analyze Indicators',
    'app.statistics':        'Statistics',
    'app.currencies':        'Currencies',
    'app.crypto_screener':   'crypto screener',

    // Settings
    'settings.title':        'Settings',
    'settings.language':     'Language',
    'settings.palette':      'Color palette',
    'settings.reload':       'Reload candles',
    'settings.reload_btn':   'Fetch 1000 candles',
    'settings.loading':      'Loading...',
    'settings.symbol_ph':    'Symbol (e.g. BTCUSDT)',
    'settings.all':          'All',
    'settings.error':        'error',
    'settings.asset_display': 'Asset display',
    'settings.asset_display_hint': 'By default only traditional spot cryptocurrencies. Check to include special categories.',
    'settings.category.stablecoins':     'Stablecoins',
    'settings.category.leveragedLong': 'Leveraged Long tokens (3L, 5L, BULL…)',
    'settings.category.leveragedShort':'Leveraged Short tokens (3S, 5S, BEAR…)',
    'settings.category.wrapped':         'Wrapped tokens (WBTC, WETH, bridged…)',
    'settings.category.liquidStaking': 'Liquid staking (stETH, cbETH, mSOL…)',
    'settings.category.lpTokens':        'LP tokens (Liquidity Provider)',
    'settings.category.synthetic':       'Synthetic or derivative tokens',

    // Indicator types
    'ind.placeholder':       'Indicator',
    'ind.ichimoku':          'Ichimoku Cloud',
    'ind.ma':                'Moving Average',
    'ind.ma_time_above':     '% Time above MA',
    'ind.ma_crossover':      'MA Crossover',
    'ind.rsi':               'RSI',
    'ind.marketcap':         'Market Cap',

    // Indicator descriptions
    'ind.desc.ichimoku':     'Japanese system with 5 lines indicating trend, support/resistance and momentum. Widely used in advanced technical analysis.',
    'ind.desc.ma':           'Simple Moving Average (SMA) — average of the last N closing prices. When price crosses the MA, it signals a trend change.',
    'ind.desc.ma_time_above': '% of history where close stayed above MA50 (same as Binance chart), for each selected interval. Cached on server — other % thresholds reuse data.',
    'ind.desc.ma_crossover':  'SMA9 × SMA21: pick MA candle timeframe (5m, 15m, 1h…) and how long ago it crossed (≤5 min = within last 5 minutes). These are independent.',
    'ind.desc.rsi':          'RSI — oscillator from 0 to 100 measuring movement strength. Below 30 = oversold (possible rise). Above 70 = overbought (possible fall).',
    'ind.desc.marketcap':    'Cross-references CoinGecko data with Binance volume. "Volume turnover" detects coins with inflated prices. "Future dilution" identifies tokens with large pending supply.',

    // Comparators
    'cmp.above':             'Above',
    'cmp.bellow':            'Below',

    // Candle lines
    'candle.high':           'High',
    'candle.close':          'Close',
    'candle.low':            'Low',
    'candle.high_full':      'Candle High',
    'candle.close_full':     'Candle Close',
    'candle.low_full':       'Candle Low',

    // Ichimoku
    'ichi.conversion':       'Conversion',
    'ichi.base':             'Base',
    'ichi.spanA':            'Span A',
    'ichi.spanB':            'Span B',
    'ichi.spanAB':           'Span A+B',
    'ichi.high':             'High',
    'ichi.close':            'Close',
    'ichi.low':              'Low',
    'ichi.label.conversion': 'Conversion (Tenkan-sen) — average of last 9 bars',
    'ichi.label.base':       'Base (Kijun-sen) — average of last 26 bars',
    'ichi.label.spanA':      'Span A — upper/lower cloud border',
    'ichi.label.spanB':      'Span B — opposite cloud border',
    'ichi.label.spanAB':     'Span A + B — above both cloud borders',
    'ichi.label.high':       'High — candle high',
    'ichi.label.close':      'Close — candle close',
    'ichi.label.low':        'Low — candle low',

    // Market Cap
    'mcap.turnover':         'Volume Turnover',
    'mcap.dilution':         'Future Dilution',
    'mcap.low_t':            'Low — possibly inflated (<5%)',
    'mcap.mid_t':            'Medium — normal (5–30%)',
    'mcap.high_t':           'High — speculative (>30%)',
    'mcap.low_d':            'Low — little dilution (<2×)',
    'mcap.mid_d':            'Medium — moderate (2–5×)',
    'mcap.high_d':           'High — elevated risk (>5×)',
    'mcap.tip_t':            'Low <5% (inflated) · Medium 5–30% (normal) · High >30% (speculative)',
    'mcap.tip_d':            'Low <2× (healthy) · Medium 2–5× · High >5× (dilution risk)',
    'mcap.tip_metric':       'Turnover: volume÷market cap. Low = price without real support. Dilution: tokens not yet issued vs. current cap.',

    // Intervals
    'iv.add':                'Add interval',
    'iv.remove':             'Remove',

    // Indicator panel buttons
    'ip.add_row':            'Add another indicator condition to the search',
    'ip.remove_row':         'Remove the last indicator from the list',
    'ip.search':             'Run the search — may take a few seconds depending on the number of coins and intervals',
    'ip.searching':          'Searching...',

    // Indicator summary (buildSummary)
    'sum.rsi':               (c1, v1, c2, v2, ivl) => `RSI ${c1} ${v1} and ${c2} ${v2} → ${ivl}`,
    'sum.ichimoku':          (l1, cmp, l2, ivl) => `Ichimoku: ${l1} ${cmp} ${l2} → ${ivl}`,
    'sum.ma':                (len, cmp, cdl, ivl) => `MA${len}: price (${cdl}) ${cmp} MA → ${ivl}`,
    'sum.ma_time_above':     (per, pct, ivl) => `MA${per}: ≥${pct}% of history above MA → ${ivl}`,
    'sum.macross':           (p1, iv1, p2, iv2, mode, extra) => `SMA${p1}(${iv1}) × SMA${p2}(${iv2}): ${mode} ${extra}`,
    'sum.macross_age':       (age, tol) => `(within ${age}, tol ±${tol}%)`,
    'sum.macross_prox':      (prox) => `(gap ≤${prox}%)`,
    'sum.mcap':              (metric, preset) => `Market Cap: ${metric} ${preset}`,
    'sum.above':             'above',
    'sum.bellow':            'below',
    'sum.above_short':       'above',
    'sum.bellow_short':      'below',

    // Currency table
    'table.search':          'Search currency...',
    'table.currencies':      'Currencies',
    'table.macross_crossed': (arrow, age) => `${arrow} crossed ${age} ago`,
    'table.macross_near':    (arrow, gap) => `≈${arrow} gap ${gap}`,

    // Statistics
    'stats.search':          'Search',
    'stats.details':         'Details',
    'stats.start':           'Start',
    'stats.end':             'End',
    'stats.entry_p':         'Entry P.',
    'stats.exit_p':          'Exit P.',
    'stats.rsi':             'RSI',
    'stats.value':           'Value',
    'stats.open':            'open',
    'stats.configure':       'Configure parameters and click Search.',
    'stats.click_row':       'Click to view this period on the chart',
    'stats.card.candles':    'Candles',
    'stats.card.rsi_p':      'RSI Periods',
    'stats.card.occur':      'Occurrences',
    'stats.card.avg':        'Avg. Value',
    'stats.card.entry_rsi':  'Entry RSI',
    'stats.card.exit_rsi':   'Exit RSI',
    'stats.tip.candles':     'Total candles analyzed in the selected period.',
    'stats.tip.rsi_p':       'Candles with RSI calculated — first 14 are discarded for the indicator period.',
    'stats.tip.occur':       'Number of complete cycles: oversold entry and overbought exit.',
    'stats.tip.avg':         'Open value is not counted.',
    'stats.tip.entry_rsi':   'RSI below this value marks the start of a cycle (oversold zone).',
    'stats.tip.exit_rsi':    'RSI above this value ends the cycle (overbought zone).',

    // Chart
    'chart.select':          'Select a currency to view the chart',

    // Filter descriptions
    'filter.usdt':           'All USDT pairs (Binance + Gate.io)',
    'filter.btc':            'Currencies with BTC pair',
    'filter.bnb':            'Currencies with BNB pair',
    'filter.vol_above':      (val, ivl) => `Volume above ${val} USDT (${ivl})`,
    'filter.vol_range':      (lo, hi, ivl) => `Volume between ${lo} and ${hi} USDT (${ivl})`,
    'filter.mkt_above':      (val) => `Volume above ${val} USDT (Binance + Gate.io)`,
    'filter.mkt_range':      (lo, hi) => `Volume between ${lo} and ${hi} USDT (Binance + Gate.io)`,
    'filter.rsi':            (c1, v1, c2, v2, ivl) => `RSI ${c1} ${v1} and ${c2} ${v2} (${ivl})`,
    'filter.ichi':           (l1, cmp, l2, ivl) => `Ichimoku: ${l1} ${cmp} ${l2} (${ivl})`,
    'filter.ma':             (p, cmp, cdl, ivl) => `MA${p} ${cmp} ${cdl} (${ivl})`,
    'filter.ma_pct':         (p, pct, ivl) => `MA${p}: ≥${pct}% of history above MA (${ivl})`,
    'filter.macross':        (p1, iv1, p2, iv2, mode, extra, sigIv) => `SMA${p1}(${iv1}) × SMA${p2}(${iv2}): ${mode} ${extra} [${sigIv}]`,
    'filter.macross.cross_up':   'crossed up',
    'filter.macross.cross_down': 'crossed down',
    'filter.macross.near_up':    'near cross ↑',
    'filter.macross.near_down':  'near cross ↓',
    'filter.macross.age_last':   'on last candle',
    'filter.macross.age_min':    (min) => `≤${min} min ago`,
    'filter.acima':          'above',
    'filter.abaixo':         'below',
    'filter.mcap_low_t':     'Low volume vs. market cap — possibly inflated (<5%)',
    'filter.mcap_mid_t':     'Normal volume vs. market cap (5–30%)',
    'filter.mcap_high_t':    'High volume vs. market cap — speculative (>30%)',
    'filter.mcap_low_d':     'Few tokens yet to come — FDV up to 2× market cap (most supply already circulating)',
    'filter.mcap_mid_d':     'Moderate dilution — FDV between 2× and 5× market cap',
    'filter.mcap_high_d':    'High future dilution — FDV above 5× market cap',
    'filter.stables_usd':    'USD-pegged stablecoins (USDC, DAI, FDUSD…)',
    'filter.stables_eur':    'EUR-pegged stablecoins (EURT, EURC…)',
    'filter.stables_gold':   'Gold-backed tokens (PAXG, XAUT…)',
    'filter.stables_other':  'Other currency stablecoins (JPY, IDR, SGD…)',

    'macross.mode.cross_up':   'Crossed ↑',
    'macross.mode.cross_down': 'Crossed ↓',
    'macross.mode.near_up':    'Near ↑',
    'macross.mode.near_down':  'Near ↓',
    'macross.age.last':        'Last closed candle',
    'macross.age.1':           '≤ 1 min',
    'macross.age.5':           '≤ 5 min',
    'macross.age.15':          '≤ 15 min',
    'macross.age.30':          '≤ 30 min',
    'macross.age.60':          '≤ 1 h',
    'macross.age.240':         '≤ 4 h',
    'macross.age.1440':        '≤ 24 h',
    'macross.mixed_intervals': 'Different interval per SMA',
    'macross.label.candles':   'SMA candles',
    'macross.label.age':       'Crossed ago',
    'macross.add_age':         'Add time window',
    'macross.remove_age':      'Remove',
    'macross.tip.candle_iv':   'Timeframe where SMAs are calculated (5m, 15m, 1h…). Separate from “crossed ago”.',
    'macross.tip.ma1':         'Fast SMA (shorter period, e.g. 9)',
    'macross.tip.ma2':         'Slow SMA (longer period, e.g. 21 or 200)',
    'macross.tip.mode':        'Cross direction: fast MA crossed above or below slow MA',
    'macross.tip.age':         'How long ago the cross occurred (e.g. ≤5 min = within last 5 minutes)',
    'macross.tip.tolerance':   'Crossover tolerance (±%) — relaxes condition on previous candle',
    'macross.tip.iv1':         'Fast SMA interval',
    'macross.tip.iv2':         'Slow SMA interval',

    // Filter buttons
    'filter.search_ph':      'Search filters...',
    'filter.btn_join':       'Intersect checked filters — shows only coins present in ALL selected filters',
    'filter.btn_remove':     'Remove checked filters from the list',
    'filter.btn_clear':      'Clear all filters and return to the full list',
  },
};

// ─── Hook principal ───────────────────────────────────────────────────────────

export function useI18n() {
  const { lang } = useLanguage();
  const dict = T[lang] ?? T.pt;

  function t(key, ...args) {
    const val = dict[key] ?? T.pt[key] ?? key;
    return typeof val === 'function' ? val(...args) : val;
  }

  function formatPrice(value, decimals = 4) {
    const num = Number(value);
    if (isNaN(num)) return String(value);
    const locale = lang === 'pt' ? 'pt-BR' : 'en-US';
    return num.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatNumber(value, decimals = 2) {
    const num = Number(value);
    if (isNaN(num)) return String(value);
    const locale = lang === 'pt' ? 'pt-BR' : 'en-US';
    return num.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return { t, lang, formatPrice, formatNumber };
}

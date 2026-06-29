/** Padrões de recuperação 1h — espelham backend/bot/5min-trade-bot/recoveryPatternConfig.js */

export function getRecoveryPatternOptions(rsiBuy = 30) {
  const rsi = Number(rsiBuy) || 30;
  return [
    {
      type: 'two_green',
      label: '2 verdes seguidos',
      visual: [true, true],
      summary: 'Recuperação mínima nas últimas 2 horas',
      tooltip:
        'Últimos 2 candles 1h fechados verdes (close > open). ' +
        'Útil acima da MA quando a moeda já mostrou sinal de alta curta.',
    },
    {
      type: 'two_one',
      label: '2 verdes + 1 vermelho',
      visual: [true, true, false],
      summary: 'Recuperação curta: subiu 2h, pullback de 1 candle',
      tooltip:
        'Últimos 3 candles 1h fechados: dois verdes seguidos e um vermelho no final. ' +
        'Indica que a moeda já começou a subir mas ainda respirou. ' +
        `No histórico, medimos entradas RSI<${rsi} quando este padrão estava ativo e a alta até RSI de saída.`,
    },
    {
      type: 'three_green',
      label: '3 verdes seguidos',
      visual: [true, true, true],
      summary: 'Alta consistente nas últimas 3 horas',
      tooltip:
        'Últimos 3 candles 1h fechados todos verdes (close > open). ' +
        'Confirma recuperação mais sólida antes de entrar no RSI 5m.',
    },
    {
      type: 'three_one',
      label: '3 verdes + 1 vermelho',
      visual: [true, true, true, false],
      summary: 'Subiu forte, pullback — padrão de reversão clássico',
      tooltip:
        'Últimos 4 candles 1h: três verdes e um vermelho no final. ' +
        'Moeda subiu, fez uma pausa e pode retomar. ' +
        'Análise histórica cruza com entradas RSI<' + rsi + ' neste contexto.',
    },
    {
      type: 'five_green',
      label: '5 verdes seguidos',
      visual: [true, true, true, true, true],
      summary: 'Tendência de alta forte nas últimas 5 horas',
      tooltip:
        'Últimos 5 candles 1h fechados todos verdes. Exige recuperação mais longa — ' +
        'menos entradas, porém com confirmação de força. Compare win rate no histórico da moeda.',
    },
  ];
}

export function recoveryPatternTypeLabel(type) {
  return getRecoveryPatternOptions().find(o => o.type === type)?.label ?? type;
}

export function recoveryPatternTypesLabel(types) {
  if (!Array.isArray(types) || !types.length) return 'nenhum';
  return types.map(t => recoveryPatternTypeLabel(t)).join(' ou ');
}

export function recoveryPatternZonesLabel(zones, abovePct = 5) {
  if (!Array.isArray(zones) || !zones.length) return '';
  const parts = [];
  if (zones.includes('above_ma')) parts.push(`acima MA +${abovePct}%`);
  if (zones.includes('between_ma')) parts.push('entre MA e piso');
  return parts.join(' · ');
}

/** RSI de compra padrão no painel 5m Trade */
export const DEFAULT_FIVE_M_RSI_BUY  = 25;
export const DEFAULT_FIVE_M_RSI_SELL = 70;

export function stopPayloadFromRecovery(rec) {
  if (!rec || rec.error) return rec?.error ? { error: rec.error } : null;
  return {
    rsiBuy: rec.rsiBuy,
    rsiSell: rec.rsiSell,
    currentPrice: rec.currentPrice,
    hist: rec.hist,
    fixed2: rec.fixed2,
    fixed5: rec.fixed5,
    ma: rec.ma,
    recommended: rec.recommended,
    stopCompare: rec.stopCompare,
  };
}

export function getStopLossOptions(rsiBuy = 30) {
  const rsi = Number(rsiBuy) || 30;
  return [
    {
      type: 'fixed_2',
      label: 'Fixo −2% da entrada',
      summary: 'Stop simples: vende se cair 2% abaixo do preço médio de compra',
      tooltip:
        'Stop loss básico e previsível. O nível é fixado na entrada (preço médio após DCA) ' +
        'e não muda até a venda. Útil quando você quer um teto de perda curto e claro, ' +
        'sem depender do histórico da moeda.',
      group: 'basico',
    },
    {
      type: 'fixed_5',
      label: 'Fixo −5% da entrada',
      summary: 'Stop simples: vende se cair 5% abaixo do preço médio de compra',
      tooltip:
        'Igual ao fixo −2%, mas com margem maior para volatilidade intradiária em candles 5m. ' +
        'Boa opção padrão quando não há histórico RSI suficiente para calcular um stop adaptado.',
      group: 'basico',
    },
    {
      type: 'hist',
      label: `Histórico RSI<${rsi}`,
      summary: `Sugerido: queda típica quando RSI ficou abaixo de ${rsi} até subir`,
      tooltip:
        `Analisa o histórico de candles 5m e encontra cada vez que o RSI(14) cruzou abaixo de ${rsi} ` +
        `(seu limiar de compra). Em cada episódio, mede a queda máxima do preço até o RSI recuperar ` +
        `(subir para ${rsi + 3} ou mais). O stop sugerido usa o percentil 75 (P75) dessas quedas — ` +
        'tolerando a maior parte dos dips históricos desta moeda neste limiar, mas cortando quedas extremas. ' +
        'Recalcula quando você muda o RSI de compra ou clica em Calcular.',
      group: 'rsi',
    },
    {
      type: 'ma',
      label: 'MA −2% do piso adaptativo',
      summary: 'Stop dinâmico: 2% abaixo do piso MA50 1h (ou MA do filtro, se ativo)',
      tooltip:
        'Usa MA50 1h por padrão (ou a MA "acima" do filtro, se habilitado). O piso adaptativo vem do histórico de dips da moeda. ' +
        'O stop fica 2% abaixo desse piso — não exige filtro de entrada ligado. Recalcula a cada tick.',
      group: 'ma',
    },
  ];
}

/** @deprecated use getStopLossOptions */
export const STOP_LOSS_OPTIONS = getStopLossOptions(30);

export function stopLossTypeLabel(type, rsiBuy = 30) {
  return getStopLossOptions(rsiBuy).find(o => o.type === type)?.label ?? type;
}

export function stopLossTypesLabel(types, rsiBuy = 30) {
  if (!Array.isArray(types) || !types.length) return 'nenhum';
  return types.map(t => stopLossTypeLabel(t, rsiBuy)).join(' + ');
}

export function stopTypeReady(type, stop, rsiBuy) {
  return stopOptionAvailable(type, stop, rsiBuy);
}

export function initialStopLossTypes(entry) {
  const sl = entry?.stopLoss;
  if (Array.isArray(sl?.types)) {
    return sl.types.filter(t => getStopLossOptions().some(o => o.type === t));
  }
  if (sl?.type && getStopLossOptions().some(o => o.type === sl.type)) {
    return [sl.type];
  }
  return [];
}

export function toggleStopType(list, type) {
  return list.includes(type) ? list.filter(t => t !== type) : [...list, type];
}

export function stopOptionAvailable(type, stop, rsiBuy) {
  if (type === 'fixed_2') return !!stop?.fixed2?.ok;
  if (type === 'fixed_5') return !!stop?.fixed5?.ok;
  if (type === 'hist') {
    if (!stop?.hist) return false;
    const buy = Number(rsiBuy);
    const histBuy = Number(stop.hist.rsiBuy ?? stop.rsiBuy);
    if (Number.isFinite(buy) && Number.isFinite(histBuy) && buy !== histBuy) return false;
    return !!stop.hist.ok;
  }
  if (type === 'ma') return !!stop?.ma?.ok;
  return false;
}

export function stopOptionDetail(type, stop, rsiBuy) {
  if (type === 'fixed_2' && stop?.fixed2?.ok) {
    return `Sair em ${stop.fixed2.stopPrice} · −${stop.fixed2.stopPct}%`;
  }
  if (type === 'fixed_5' && stop?.fixed5?.ok) {
    return `Sair em ${stop.fixed5.stopPrice} · −${stop.fixed5.stopPct}%`;
  }
  if (type === 'hist' && stop?.hist?.ok) {
    return (
      `Sair em ${stop.hist.stopPrice} · −${stop.hist.stopPct}% (P75) · ` +
      `${stop.hist.episodeCount} episódios RSI<${stop.hist.rsiBuy ?? rsiBuy}` +
      (stop.hist.lowSample ? ' · amostra pequena' : '')
    );
  }
  if (type === 'ma' && stop?.ma?.ok) {
    return `Sair em ${stop.ma.stopPrice} · −${stop.ma.stopPct}% · piso ${stop.ma.adaptiveFloor}`;
  }
  if (type === 'hist' && stop?.hist && !stop.hist.ok) {
    const min = stop.hist.minRsiObserved;
    if (min != null && Number(min) >= Number(rsiBuy)) {
      return (
        `Sem histórico para RSI<${rsiBuy} — RSI mínimo nos ~${stop.hist.candleCount ?? '?'} candles 5m ` +
        `foi ${min} (nunca cruzou abaixo de ${rsiBuy}) — use fixo −5%`
      );
    }
    return `Sem histórico para RSI<${rsiBuy} (${stop.hist.reason ?? 'poucos episódios'}) — use fixo −5%`;
  }
  if (type === 'hist' && stop && Number(stop.rsiBuy ?? stop.hist?.rsiBuy) !== Number(rsiBuy)) {
    return 'Aguarde recálculo para o RSI de compra atual';
  }
  return null;
}

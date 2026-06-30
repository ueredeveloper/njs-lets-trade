/** Colunas de regras exibidas na tabela de sinais 5m */
export const FIVE_M_RULE_COLUMNS = [
  { key: 'ma1h',    short: 'MA1h',   title: 'Filtro MA50 1h (acima)' },
  { key: 'ma5m',    short: 'MA5m',   title: 'Toque MA50 5m' },
  { key: 'pattern', short: 'Padrão', title: 'Padrão recuperação 1h' },
  { key: 'rsiPath', short: 'RSI',    title: 'Caminho RSI (< rsiBuy)' },
  { key: 'maPath',  short: 'MA↳',    title: 'Caminho MA50 5m ativo' },
  { key: 'order',   short: 'Ordem',  title: 'Compra executada na corretora' },
];

function rulesFromLegacyRow(row) {
  const d = row?.details ?? {};
  const recovery = d.recoveryEval ?? {};
  const patternRequired = recovery.patternRequired === true;
  const patternOk = !patternRequired || recovery.ok === true;
  const pathSig = d.pathSignal ?? {};
  const entryPath = row?.entry_path;

  const cell = (ok, label, extra = {}) => ({
    ok: ok === true ? true : (ok === false ? false : null),
    label,
    ...extra,
  });

  const rules = {
    ma1h: cell(row?.ma1h_ok === true, 'MA50 1h'),
    ma5m: cell(row?.ma5m_triggered === true, 'MA50 5m'),
    pattern: cell(patternOk, 'Padrão 1h', { required: patternRequired, reason: recovery.reason ?? null }),
    rsiPath: cell(
      d.rsiBuySignal === true ? true : (d.rsiBuySignal === false ? false : (entryPath === 'rsi' ? true : null)),
      'Caminho RSI',
      { applicable: entryPath === 'rsi' || d.rsiBuySignal != null },
    ),
    maPath: cell(
      pathSig.maSignal === true ? true : (entryPath === 'ma50_5m' && row?.ma5m_triggered ? true : null),
      'Caminho MA50 5m',
      { applicable: entryPath === 'ma50_5m' || pathSig.maSignal != null },
    ),
    allRules: cell(row?.allowed === true, 'Todas regras'),
  };

  if (row?.event_type === 'entry' || row?.event_type === 'possible_entry') {
    rules.order = cell(row.event_type === 'entry', row.event_type === 'entry' ? 'Ordem executada' : 'Ordem não preencheu');
  }

  return rules;
}

export function getSignalRules(row) {
  const rules = row?.details?.rules ?? rulesFromLegacyRow(row);
  if ((row?.event_type === 'entry' || row?.event_type === 'possible_entry') && !rules.order) {
    rules.order = {
      ok: row.event_type === 'entry',
      label: row.event_type === 'entry' ? 'Ordem executada' : 'Ordem não preencheu',
    };
  }
  return rules;
}

export function ruleCell(rule) {
  if (!rule || rule.applicable === false) {
    return { glyph: '—', className: 'text-p5/25', title: 'Não aplicável' };
  }
  if (rule.ok === true) {
    return { glyph: '✓', className: 'text-emerald-400', title: rule.label ?? 'OK' };
  }
  if (rule.ok === false) {
    const extra = rule.reason ? ` — ${rule.reason}` : (rule.detail ? ` — ${rule.detail}` : '');
    return { glyph: '✗', className: 'text-red-400', title: `${rule.label ?? 'Bloqueado'}${extra}` };
  }
  return { glyph: '?', className: 'text-amber-400/90', title: `${rule.label ?? 'Regra'} — sem dados no registro` };
}

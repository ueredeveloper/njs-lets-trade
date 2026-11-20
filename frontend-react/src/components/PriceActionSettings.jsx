import { useEffect, useState } from 'react';
import { getPriceActionConfig, savePriceActionConfig } from '../services/api';
import CandlePatternIcon from './CandlePatternIcon';

// Configurações → Price action: config do bot "Explosão de Alta automática"
// (backend/bot/breakout-auto/priceActionConfig.js), gravada em price_action_bot_config pelo botão
// Salvar. O bot relê a cada varredura (15 min), então a mudança salva vale sem reiniciar.
// Largura: a sidebar tem w-80 — todo campo ocupa a coluna inteira (w-full min-w-0) e a unidade vai
// no rótulo, pra nenhum campo ficar espremido nem estourar a lateral.

// Padrões de ALTA no fechamento (backend/bot/shared/candleCloseCondition.js#bullishClosePattern):
// liberam a entrada mesmo com corpo abaixo do mínimo. Padrão de BAIXA sempre barra (não é opção).
const BULLISH_PATTERN_FIELDS = [
  { key: 'hammer', label: 'Martelo', hint: 'pavio inferior longo: venderam, mas os compradores devolveram a queda' },
  { key: 'morning star', label: 'Estrela da manhã', hint: 'vermelho forte, indecisão e um verde acima do meio do 1º' },
  { key: 'three white soldiers', label: 'Três soldados', hint: 'três verdes em escada, cada um fechando mais alto' },
  { key: 'bullish engulfing', label: 'Engolfo de alta', hint: 'o corpo verde cobre o vermelho anterior inteiro' },
  { key: 'piercing line', label: 'Linha de perfuração', hint: 'o verde recupera mais da metade do vermelho anterior' },
  { key: 'tweezer bottom', label: 'Fundo pinça', hint: 'duas mínimas iguais: o suporte segurou duas vezes' },
  { key: 'bullish marubozu', label: 'Marubozu de alta', hint: 'corpo verde quase sem pavio: comprou do início ao fim' },
];

const REGIME_FIELDS = [
  { key: 'btcEma50_4h', label: 'BTC 4h acima da EMA50', hint: 'o mercado em alta no 4h' },
  { key: 'coinEma20_1d', label: 'Moeda acima da EMA20 1d', hint: 'fechamento diário da moeda acima da média de 20 dias' },
  { key: 'coinMacd4h', label: 'MACD 4h da moeda > 0', hint: 'histograma MACD(12,26,9) 4h positivo' },
  { key: 'btcEma20_1dRising', label: 'Período de baixa: EMA20 1d do BTC subindo', hint: 'só entra com a EMA20 diária do BTC acima da de 5 dias antes' },
];

// Volume 24h mínimo (USDT) — entrada e ranking de alta. Padrão 1M. Sempre em milhões: 0,5M · 1M · 2M …
const VOLUME_OPTIONS = [0, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000];
const volLabel = (v) => (v === 0 ? 'sem mínimo' : `${String(+(v / 1e6).toFixed(3)).replace('.', ',')}M`);
const TOP_OPTIONS = [10, 20, 40];

const fmtBrt = (iso) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** Rótulo em cima + controle ocupando a coluna toda. */
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] text-p5/50 truncate" title={label}>{label}</span>
      {children}
    </label>
  );
}

function Card({ title, tone, right, children }) {
  return (
    <div className="rounded-md p-2.5 min-w-0" style={tone}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

function Check({ checked, onChange, label, hint, children }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group min-w-0">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 shrink-0 accent-p4" />
      {children}
      <span className="text-[11px] text-p5 leading-snug group-hover:text-white min-w-0">
        {label}
        {hint && <span className="block text-[10px] text-p5/40">{hint}</span>}
      </span>
    </label>
  );
}

export default function PriceActionSettings({ open, inp }) {
  const [cfg, setCfg] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState(null); // null | 'saving' | 'saved' | erro (string)
  const [lastTop, setLastTop] = useState(40); // último top N escolhido (religar o filtro volta nele)

  useEffect(() => {
    if (!open || cfg) return;
    // Campo ausente (config salva antes da lista existir) = TODOS os padrões marcados, igual ao bot.
    getPriceActionConfig()
      .then((c) => {
        if (c.regime?.topGainers > 0) setLastTop(c.regime.topGainers);
        setCfg({ ...c, bullishPatterns: Array.isArray(c.bullishPatterns) ? c.bullishPatterns : BULLISH_PATTERN_FIELDS.map((f) => f.key) });
      })
      .catch((err) => setLoadError(err.message));
  }, [open, cfg]);

  const patch = (p) => { setDirty(true); setSaveState(null); setCfg((prev) => ({ ...prev, ...p })); };
  const patchRegime = (p) => { setDirty(true); setSaveState(null); setCfg((prev) => ({ ...prev, regime: { ...prev.regime, ...p } })); };

  async function save() {
    setSaveState('saving');
    try {
      const saved = await savePriceActionConfig(cfg);
      // Mostra o que o BANCO gravou (já normalizado: stop mín. 10%, valores fora da faixa ajustados).
      setCfg((prev) => ({ ...saved, bullishPatterns: saved.bullishPatterns ?? prev.bullishPatterns }));
      setDirty(false);
      setSaveState('saved');
    } catch (err) {
      setSaveState(err.message || 'erro ao salvar');
    }
  }

  if (loadError) return <p className="text-[10px] text-red-400">Erro ao carregar: {loadError}</p>;
  if (!cfg) return <p className="text-[10px] text-p5/40">Carregando…</p>;

  const rg = cfg.regime;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const field = `${inp} w-full min-w-0`;

  const saveBar = (
    <div className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={save}
        disabled={saveState === 'saving'}
        className={`shrink-0 px-3 py-1.5 rounded text-xs text-white transition-colors disabled:opacity-50 ${dirty ? 'bg-p4 hover:brightness-110' : 'bg-p3 hover:bg-p4'}`}
      >
        {saveState === 'saving' ? 'Salvando…' : 'Salvar'}
      </button>
      <span className="text-[10px] leading-snug min-w-0">
        {saveState === 'saved' && <span className="text-emerald-400">Salvo no banco — vale na próxima varredura (até 15 min)</span>}
        {saveState && !['saving', 'saved'].includes(saveState) && <span className="text-red-400">Não salvou: {saveState}</span>}
        {!saveState && dirty && <span className="text-amber-300">● alterações não salvas</span>}
        {!saveState && !dirty && (cfg.updatedAt
          ? <span className="text-p5/40">salvo em {fmtBrt(cfg.updatedAt)}</span>
          : <span className="text-p5/40">nunca salvo — o bot usa o padrão</span>)}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {cfg.tableMissing && (
        <p className="text-[10px] text-amber-300 leading-relaxed">
          Tabela ainda não criada — rode <code>supabase/add-price-action-bot-config.sql</code> no Supabase pra salvar.
        </p>
      )}

      {saveBar}

      <Check checked={cfg.enabled} onChange={(v) => patch({ enabled: v })}
        label="Bot ligado" hint="desligado: para de criar ordens novas (as abertas continuam com a OCO)" />

      <Card title="Entrada (candle 4h)" tone={{ background: '#0f1a14', border: '1px solid #2a4a3a' }}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Corpo mínimo (%)">
            <input type="number" min={0.5} max={50} step={0.5} className={field} value={cfg.minBodyPct}
              onChange={(e) => patch({ minBodyPct: num(e.target.value) })} />
          </Field>
          <Field label="Volume 24h mínimo">
            <select className={field} value={cfg.minVolume24h} onChange={(e) => patch({ minVolume24h: Number(e.target.value) })}>
              {(VOLUME_OPTIONS.includes(cfg.minVolume24h) ? VOLUME_OPTIONS : [...VOLUME_OPTIONS, cfg.minVolume24h].sort((a, b) => a - b))
                .map((v) => <option key={v} value={v}>{volLabel(v)}</option>)}
            </select>
          </Field>
          <Field label="Valor por ordem (USDT)">
            <input type="number" min={6} step={1} className={field} value={cfg.usdt}
              onChange={(e) => patch({ usdt: num(e.target.value) })} />
          </Field>
          <Field label="Máx. ordens abertas">
            <input type="number" min={1} max={50} step={1} className={field} value={cfg.maxActive}
              onChange={(e) => patch({ maxActive: num(e.target.value) })} />
          </Field>
        </div>
        <div className="mt-2">
          <Check checked={cfg.firstOfMove} onChange={(v) => patch({ firstOfMove: v })} label="Só a 1ª explosão do movimento" />
        </div>
        <p className="text-[10px] text-p5/40 mt-1 leading-relaxed">Compra a mercado no fechamento do candle: corpo ≥ mínimo ou padrão de alta, nunca padrão de baixa.</p>
      </Card>

      <Card
        title="Padrões de alta"
        tone={{ background: '#0f1520', border: '1px solid #2a3a4a' }}
        right={(
          <div className="flex gap-2 text-[10px] shrink-0">
            <button type="button" className="text-p5/60 hover:text-white" onClick={() => patch({ bullishPatterns: BULLISH_PATTERN_FIELDS.map((f) => f.key) })}>todos</button>
            <button type="button" className="text-p5/60 hover:text-white" onClick={() => patch({ bullishPatterns: [] })}>nenhum</button>
          </div>
        )}
      >
        <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">Liberam a entrada com corpo abaixo do mínimo.</p>
        <div className="flex flex-col gap-1.5">
          {BULLISH_PATTERN_FIELDS.map((f) => {
            const on = cfg.bullishPatterns.includes(f.key);
            return (
              <Check
                key={f.key} checked={on} label={f.label} hint={f.hint}
                onChange={(v) => patch({
                  bullishPatterns: v
                    ? BULLISH_PATTERN_FIELDS.map((x) => x.key).filter((k) => k === f.key || cfg.bullishPatterns.includes(k))
                    : cfg.bullishPatterns.filter((k) => k !== f.key),
                })}
              >
                <CandlePatternIcon pattern={f.key} className={on ? '' : 'opacity-40 grayscale'} />
              </Check>
            );
          })}
        </div>
        <p className="text-[10px] text-p5/40 mt-2 leading-relaxed">
          Nenhum marcado = só entra pelo corpo mínimo. Padrões de baixa (estrela cadente, martelo invertido, doji lápide, enforcado,
          engolfo de baixa, topo pinça) sempre barram a compra.
        </p>
      </Card>

      <Card title="Saída (OCO)" tone={{ background: '#141018', border: '1px solid #3a2a4a' }}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Alvo (%)">
            <input type="number" min={1} max={200} step={0.5} className={field} value={cfg.targetPct}
              onChange={(e) => patch({ targetPct: num(e.target.value) })} />
          </Field>
          <Field label="Stop (%, mín. 10)">
            <input type="number" min={10} max={90} step={0.5} className={field} value={cfg.stopPct}
              onChange={(e) => patch({ stopPct: num(e.target.value) })} />
          </Field>
        </div>
      </Card>

      {/* Regra de queda (v1.193.0) — mesmo seletor da caixa Price action do gráfico. Executada pelo
          watcher do bot (manualOcoWatcher.js#processOnDrop) com a posição já comprada. */}
      <Card title="Se cair depois da compra" tone={{ background: '#1a1410', border: '1px solid #4a3a2a' }}>
        <div className="flex flex-col gap-1.5">
          {[
            { v: 'off', label: 'Alvo normal', hint: 'nada muda: a OCO fica com o alvo e o stop de cima' },
            { v: 'breakeven', label: 'Alvo na entrada', hint: 'caiu X%: o alvo da OCO vai pro preço de entrada (sai no zero a zero); o stop não muda' },
            { v: 'martingale', label: 'Martingale', hint: 'caiu X%: o alvo vai pra entrada E compra de novo, com OCO própria: alvo = preço da 1ª entrada, stop −Y% do preço da 2ª compra' },
          ].map((o) => (
            <label key={o.v} className="flex items-start gap-2 cursor-pointer group min-w-0">
              <input
                type="radio" name="pa-on-drop" className="mt-0.5 shrink-0 accent-p4"
                checked={(cfg.onDrop?.mode ?? 'off') === o.v}
                onChange={() => patch({ onDrop: { ...cfg.onDrop, mode: o.v } })}
              />
              <span className="text-[11px] text-p5 leading-snug group-hover:text-white min-w-0">
                {o.label}
                <span className="block text-[10px] text-p5/40">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {(cfg.onDrop?.mode ?? 'off') !== 'off' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Field label="Queda (%)">
              <input type="number" min={1} max={80} step={0.5} className={field} value={cfg.onDrop.dropPct}
                onChange={(e) => patch({ onDrop: { ...cfg.onDrop, dropPct: num(e.target.value) } })} />
            </Field>
            {cfg.onDrop.mode === 'martingale' && (
              <>
                <Field label="2ª compra (USDT)">
                  <select className={field} value={cfg.onDrop.martingaleUsdt}
                    onChange={(e) => patch({ onDrop: { ...cfg.onDrop, martingaleUsdt: Number(e.target.value) } })}>
                    {[...new Set([cfg.usdt, 2 * cfg.usdt, 3 * cfg.usdt, 4 * cfg.usdt, 5 * cfg.usdt, cfg.onDrop.martingaleUsdt])]
                      .filter((v) => v > 0).sort((a, b) => a - b)
                      .map((v) => <option key={v} value={v}>{v} USDT{v === cfg.usdt ? ' (= entrada)' : ''}</option>)}
                  </select>
                </Field>
                <Field label="Stop da 2ª (%, mín. 10)">
                  <input type="number" min={10} max={90} step={0.5} className={field} value={cfg.onDrop.martingaleStopPct}
                    onChange={(e) => patch({ onDrop: { ...cfg.onDrop, martingaleStopPct: num(e.target.value) } })} />
                </Field>
              </>
            )}
          </div>
        )}
        <p className="text-[10px] text-p5/40 mt-2 leading-relaxed">
          Vale pras ordens criadas depois de salvar (as já abertas seguem a regra de quando foram criadas). O stop da 1ª compra nunca muda.
          No martingale a 2ª compra aparece como uma ordem OCO separada (dá pra vender sozinha pelo gráfico).
        </p>
      </Card>

      <Card title="Filtros de mercado" tone={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
        <div className="flex flex-col gap-2">
          {REGIME_FIELDS.map((f) => (
            <Check key={f.key} checked={!!rg[f.key]} onChange={(v) => patchRegime({ [f.key]: v })} label={f.label} hint={f.hint} />
          ))}
          {/* Ranking de alta 24h da Binance — 0 = desligado; religar volta no último top escolhido. */}
          <Check
            checked={rg.topGainers > 0}
            onChange={(v) => patchRegime({ topGainers: v ? (lastTop || 40) : 0 })}
            label="Moeda entre as maiores altas 24h da Binance"
            hint="ranking dos pares USDT ativos (sem stablecoin / ação tokenizada) na hora da checagem"
          />
          <div className="grid grid-cols-2 gap-2 pl-5">
            <Field label="Ranking">
              <select
                className={field}
                disabled={!(rg.topGainers > 0)}
                value={rg.topGainers > 0 ? rg.topGainers : (lastTop || 40)}
                onChange={(e) => { const v = Number(e.target.value); setLastTop(v); patchRegime({ topGainers: v }); }}
              >
                {[...new Set([...TOP_OPTIONS, ...(rg.topGainers > 0 ? [rg.topGainers] : [])])].sort((a, b) => a - b)
                  .map((n) => <option key={n} value={n}>Top {n}</option>)}
              </select>
            </Field>
            <Field label="Volume 24h no ranking">
              <select className={field} disabled={!(rg.topGainers > 0)} value={rg.minVolume24h}
                onChange={(e) => patchRegime({ minVolume24h: Number(e.target.value) })}>
                {(VOLUME_OPTIONS.includes(rg.minVolume24h) ? VOLUME_OPTIONS : [...VOLUME_OPTIONS, rg.minVolume24h].sort((a, b) => a - b))
                  .map((v) => <option key={v} value={v}>{volLabel(v)}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <p className="text-[10px] text-p5/40 mt-2 leading-relaxed">
          Conferidos na varredura e de novo no fechamento do candle, só com candles 4h/1d já fechados. Falha ao buscar dados = não compra.
          Estudo (caixa Price action, 1000 candles 4h, +15%/−30%): 77 moedas +5,6%/trade; 20 maiores altas +6,9%; 40 +5,0% (com taxa).
        </p>
      </Card>

      {saveBar}
    </div>
  );
}

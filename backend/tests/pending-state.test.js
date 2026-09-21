const fs = require('fs');
const os = require('os');
const path = require('path');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-state-'));
  process.env.PENDING_STATE_FILE = path.join(tmpDir, 'pending-state.json');
  jest.resetModules();
});

afterEach(() => {
  delete process.env.PENDING_STATE_FILE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pendingState (journal local de compra/OCO)', () => {
  test('stash grava, peek lê e clear apaga', () => {
    const { stashPendingState, peekPendingState, clearPendingState } = require('../bot/shared/pendingState');
    expect(peekPendingState(682)).toBeNull();
    stashPendingState(682, { phase: 'BOUGHT', buy_price: 1 }, { symbol: 'BOMEUSDT', strategyId: 'rsi-momentum' });
    expect(peekPendingState(682)).toMatchObject({
      symbol: 'BOMEUSDT', strategyId: 'rsi-momentum', patch: { phase: 'BOUGHT', buy_price: 1 },
    });
    clearPendingState(682);
    expect(peekPendingState(682)).toBeNull();
  });

  test('updates seguintes mesclam por cima (o mais novo vence, rules_state substituído inteiro)', () => {
    const { stashPendingState, peekPendingState } = require('../bot/shared/pendingState');
    stashPendingState(1, { phase: 'BOUGHT', buy_price: 1, rules_state: { a: 1 } });
    const merged = stashPendingState(1, { rules_state: { exitBracket: { orderListId: 9 } } });
    expect(merged.patch).toEqual({
      phase: 'BOUGHT', buy_price: 1, rules_state: { exitBracket: { orderListId: 9 } },
    });
    expect(peekPendingState(1).stashedAt).toBe(merged.stashedAt);
  });

  test('linhas diferentes não se misturam', () => {
    const { stashPendingState, peekPendingState, clearPendingState } = require('../bot/shared/pendingState');
    stashPendingState(1, { phase: 'BOUGHT' });
    stashPendingState(2, { phase: 'BOUGHT', buy_price: 5 });
    clearPendingState(1);
    expect(peekPendingState(1)).toBeNull();
    expect(peekPendingState(2).patch.buy_price).toBe(5);
  });

  test('arquivo corrompido não derruba — recomeça vazio', () => {
    fs.writeFileSync(process.env.PENDING_STATE_FILE, '{ não é json');
    const { peekPendingState, stashPendingState } = require('../bot/shared/pendingState');
    expect(peekPendingState(1)).toBeNull();
    expect(() => stashPendingState(1, { phase: 'BOUGHT' })).not.toThrow();
  });
});

describe('tradeExecution durableState — falha do Supabase não perde a compra', () => {
  function loadWithSb(sbReq) {
    jest.doMock('../bot/shared/supabaseRest', () => ({ sbReq }));
    jest.doMock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn() }));
    return require('../bot/shared/tradeExecution');
  }

  const strategy = { config: { stopLoss: {} } };
  const baseArgs = () => ({
    rowId: 682, strategy, log: jest.fn(), session: {}, entryMeta: { ma1: 70 },
    capital: 40, strategyId: 'rsi-momentum', symbol: 'BOMEUSDT',
    result: { filledQty: 100, quoteQty: 40, avgPrice: 0.4 },
  });

  test('PATCH falha → compra fica no journal, recordBuyFill não lança; flush grava quando o Supabase volta', async () => {
    let up = false;
    const calls = [];
    const sbReq = jest.fn(async (method, table, body, query) => {
      calls.push({ method, table, body, query });
      if (!up) throw new Error('fetch failed');
      if (method === 'GET') return [{ id: 682, phase: 'WATCHING', buy_time: null }];
      return [{}];
    });
    const { createTradeExecution } = loadWithSb(sbReq);
    const { peekPendingState } = require('../bot/shared/pendingState');
    const { recordBuyFill, flushPendingState, saveState } = createTradeExecution({
      botLabel: 'TEST', buildReasonLines: () => [], durableState: true,
    });

    const args = baseArgs();
    const out = await recordBuyFill(args);
    expect(out.ok).toBe(true);
    expect(peekPendingState(682).patch).toMatchObject({ phase: 'BOUGHT', buy_price: 0.4, buy_qty: 100 });

    // um update posterior (ex.: bracket colocada) é mesclado no journal, sem lançar
    await saveState(682, { rules_state: { exitBracket: { orderListId: 7 } } }, args.log);
    expect(peekPendingState(682).patch.rules_state).toEqual({ exitBracket: { orderListId: 7 } });

    // Supabase ainda fora → flush informa que segue pendente
    expect(await flushPendingState(682, args.log)).toBe(true);

    up = true;
    expect(await flushPendingState(682, args.log)).toBe(false);
    expect(peekPendingState(682)).toBeNull();
    const patch = calls.filter(c => c.method === 'PATCH').at(-1);
    expect(patch.query).toBe('?id=eq.682');
    expect(patch.body).toMatchObject({ phase: 'BOUGHT', buy_price: 0.4, rules_state: { exitBracket: { orderListId: 7 } } });
  });

  test('flush descarta pendência se já existe OUTRA compra registrada na linha', async () => {
    let up = false;
    const sbReq = jest.fn(async (method) => {
      if (!up) throw new Error('fetch failed');
      if (method === 'GET') return [{ id: 682, phase: 'BOUGHT', buy_time: '2026-09-21T10:00:00.000Z' }];
      return [{}];
    });
    const { createTradeExecution } = loadWithSb(sbReq);
    const { peekPendingState } = require('../bot/shared/pendingState');
    const { recordBuyFill, flushPendingState } = createTradeExecution({
      botLabel: 'TEST', buildReasonLines: () => [], durableState: true,
    });
    await recordBuyFill(baseArgs());
    const patchesBefore = sbReq.mock.calls.filter(c => c[0] === 'PATCH').length;
    up = true;
    expect(await flushPendingState(682, jest.fn())).toBe(false);
    expect(peekPendingState(682)).toBeNull();
    // descartou: nenhum PATCH novo por cima da compra que já estava registrada
    expect(sbReq.mock.calls.filter(c => c[0] === 'PATCH').length).toBe(patchesBefore);
  });

  test('sem durableState o comportamento antigo é mantido (erro propaga)', async () => {
    const sbReq = jest.fn(async () => { throw new Error('fetch failed'); });
    const { createTradeExecution } = loadWithSb(sbReq);
    const { recordBuyFill } = createTradeExecution({ botLabel: 'TEST', buildReasonLines: () => [] });
    await expect(recordBuyFill(baseArgs())).rejects.toThrow('fetch failed');
  });
});

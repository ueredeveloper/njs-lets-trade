'use strict';

/**
 * Cobre o lado puro (sem git/rede) de backend/admin/botControl.js:
 * estado persistido (pending/last) e os exit codes sentinela.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botctl-'));
process.env.INTERNAL_ADMIN_STATE_FILE = path.join(tmpDir, 'control-action.json');

const botControl = require('../admin/botControl');

describe('botControl — exit codes', () => {
  test('STOP=0, RESTART=10, UPDATE=11, SYNC_LOCK=12', () => {
    expect(botControl.EXIT).toEqual({ STOP: 0, RESTART: 10, UPDATE: 11, SYNC_LOCK: 12 });
  });

  test('CONTROL_ACTIONS: as ações que reiniciam o processo (pull roda inline, fora daqui)', () => {
    expect(botControl.CONTROL_ACTIONS).toEqual({
      stop: 0, restart: 10, update: 11, 'sync-lock': 12,
    });
  });

  test('runSyncLock exportado', () => {
    expect(typeof botControl.runSyncLock).toBe('function');
  });
});

describe('botControl — estado persistido', () => {
  beforeEach(() => {
    try { fs.rmSync(process.env.INTERNAL_ADMIN_STATE_FILE); } catch { /* ok */ }
  });

  test('readState sem arquivo → pending/last nulos', () => {
    expect(botControl.readState()).toEqual({ pending: null, last: null });
  });

  test('setPending grava a intenção com timestamp e quem pediu', () => {
    botControl.setPending('update', '5561999171222');
    const st = botControl.readState();
    expect(st.pending.action).toBe('update');
    expect(st.pending.by).toBe('5561999171222');
    expect(Date.parse(st.pending.at)).not.toBeNaN();
  });

  test('recordResult limpa pending e guarda o último resultado', () => {
    botControl.setPending('update', null);
    botControl.recordResult('update', { ok: true, fromCommit: 'aaa', toCommit: 'bbb', updated: true });
    const st = botControl.readState();
    expect(st.pending).toBeNull();
    expect(st.last).toMatchObject({ action: 'update', ok: true, fromCommit: 'aaa', toCommit: 'bbb' });
    expect(Date.parse(st.last.at)).not.toBeNaN();
  });

  test('readState com JSON corrompido → volta ao default sem lançar', () => {
    fs.writeFileSync(process.env.INTERNAL_ADMIN_STATE_FILE, '{ nao é json');
    expect(botControl.readState()).toEqual({ pending: null, last: null });
  });

  test('clearStalePending descarta pending órfão e registra a interrupção', () => {
    botControl.setPending('update', '5561');
    botControl.clearStalePending();
    const st = botControl.readState();
    expect(st.pending).toBeNull();
    expect(st.last).toMatchObject({ action: 'update', ok: false });
    expect(st.last.error).toMatch(/reinício inesperado/);
  });

  test('clearStalePending sem pending → no-op', () => {
    botControl.recordResult('restart', { ok: true });
    botControl.clearStalePending();
    expect(botControl.readState().last).toMatchObject({ action: 'restart', ok: true });
  });
});

'use strict';

/**
 * runUpdate — regressão do bug "npm is not a function": o parâmetro da função se chamava
 * `npm` (mesmo nome do helper `npm()` do módulo), então dentro de runUpdate a chamada
 * `npm(['ci', ...])` na verdade invocava a STRING 'auto'/'always' como função. Corrigido
 * renomeando o parâmetro pra `npmMode` (ver botControl.js).
 *
 * Monta um "remote" de verdade (bare repo local, sem rede) 1 commit à frente com o
 * package-lock.json mudado — igual o cenário real que dispara `npm ci`. `child_process` é
 * mockado só pra trocar a chamada real de `npm`/`npm.cmd` por um fake instantâneo; todo `git`
 * continua rodando de verdade (mesmo padrão de bot-control-synclock.test.js).
 */

jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  return {
    ...real,
    execFileSync: jest.fn((cmd, args, opts) => {
      if (cmd === 'npm' || cmd === 'npm.cmd') return ''; // fake — sem rodar npm de verdade
      return real.execFileSync(cmd, args, opts);
    }),
  };
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync: mockedExecFileSync } = require('child_process');
const { execFileSync: realExecFileSync } = jest.requireActual('child_process');

const git = (dir, args) => realExecFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

const localRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'update-local-'));
const remoteRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'update-remote-'));

process.env.INTERNAL_ADMIN_STATE_FILE = path.join(localRepo, 'state.json');
const { internalConfig } = require('../admin/internalConfig');
internalConfig.repoRoot = localRepo;
internalConfig.gitRemote = 'origin';
internalConfig.gitBranch = 'main';
const bc = require('../admin/botControl');

function writeLock(dir, depVersion) {
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
    name: 'upd-test', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'upd-test', version: '1.0.0', dependencies: { x: depVersion } } },
  }, null, 2) + '\n');
}

beforeAll(() => {
  git(remoteRepo, ['init', '--bare', '-q']);
  // HEAD do bare aponta pra 'main' desde o início — sem isso, `git clone` tenta dar checkout no
  // branch default antigo ('master', que não existe) e o clone fica sem working tree.
  git(remoteRepo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  git(localRepo, ['init', '-q']);
  git(localRepo, ['config', 'user.email', 't@t.co']);
  git(localRepo, ['config', 'user.name', 'test']);
  git(localRepo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(localRepo, 'package.json'), JSON.stringify({ name: 'upd-test', version: '1.0.0' }, null, 2) + '\n');
  writeLock(localRepo, '1.0.0');
  git(localRepo, ['add', '-A']);
  git(localRepo, ['commit', '-qm', 'init']);
  git(localRepo, ['branch', '-M', 'main']);
  git(localRepo, ['remote', 'add', 'origin', remoteRepo]);
  git(localRepo, ['push', '-q', 'origin', 'main']);

  // "alguém" avança o remoto com o lock mudado, via um clone à parte — não mexe no HEAD do
  // repo local, que fica pra trás (é o que o teste vai atualizar com runUpdate).
  const pusherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'update-pusher-'));
  git(pusherRepo, ['clone', '-q', remoteRepo, '.']);
  git(pusherRepo, ['config', 'user.email', 't@t.co']);
  git(pusherRepo, ['config', 'user.name', 'test']);
  git(pusherRepo, ['config', 'commit.gpgsign', 'false']);
  writeLock(pusherRepo, '2.0.0');
  git(pusherRepo, ['commit', '-aqm', 'bump lock']);
  git(pusherRepo, ['push', '-q', 'origin', 'main']);
});

afterAll(() => {
  try { fs.rmSync(localRepo, { recursive: true, force: true }); } catch { /* ok */ }
  try { fs.rmSync(remoteRepo, { recursive: true, force: true }); } catch { /* ok */ }
});

test('lockfile mudou no merge → chama o helper npm() como FUNÇÃO, não quebra com "npm is not a function"', async () => {
  mockedExecFileSync.mockClear();
  const r = await bc.runUpdate();

  expect(r.ok).toBe(true);
  expect(r.updated).toBe(true);
  expect(r.npmRan).toBe(true);
  expect(r.error).toBeUndefined();

  const npmCall = mockedExecFileSync.mock.calls.find(([cmd]) => cmd === 'npm' || cmd === 'npm.cmd');
  expect(npmCall).toBeDefined();
  expect(npmCall[1]).toEqual(['ci', '--omit=dev', '--no-audit', '--no-fund']);
});

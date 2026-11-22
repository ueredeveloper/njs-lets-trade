'use strict';

/**
 * runReset — `git reset --hard <sha>` do /reset. Repo local + "remoto" bare de verdade (sem
 * rede); só o `npm` é trocado por um fake (mesmo padrão de bot-control-update.test.js).
 */

jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  return {
    ...real,
    execFileSync: jest.fn((cmd, args, opts) => {
      if (cmd === 'npm' || cmd === 'npm.cmd') return '';
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

const localRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-local-'));
const remoteRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-remote-'));

process.env.INTERNAL_ADMIN_STATE_FILE = path.join(os.tmpdir(), `reset-state-${process.pid}.json`);
const { internalConfig } = require('../admin/internalConfig');
internalConfig.repoRoot = localRepo;
internalConfig.gitRemote = 'origin';
internalConfig.gitBranch = 'main';
const bc = require('../admin/botControl');

let c1; let c2; let c3;

function commitFile(name, content, msg) {
  fs.writeFileSync(path.join(localRepo, name), content);
  git(localRepo, ['add', '-A']);
  git(localRepo, ['commit', '-qm', msg]);
  return git(localRepo, ['rev-parse', 'HEAD']);
}

beforeAll(() => {
  git(remoteRepo, ['init', '--bare', '-q']);
  git(remoteRepo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(localRepo, ['init', '-q']);
  git(localRepo, ['config', 'user.email', 't@t.co']);
  git(localRepo, ['config', 'user.name', 'test']);
  git(localRepo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(localRepo, 'package-lock.json'), '{"v":1}\n');
  c1 = commitFile('a.txt', 'v1\n', 'c1');
  git(localRepo, ['branch', '-M', 'main']);
  c2 = commitFile('package-lock.json', '{"v":2}\n', 'c2 lock');
  c3 = commitFile('a.txt', 'v3\n', 'c3');
  git(localRepo, ['remote', 'add', 'origin', remoteRepo]);
  git(localRepo, ['push', '-q', 'origin', 'main']);
});

afterAll(() => {
  for (const d of [localRepo, remoteRepo]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ok */ } }
  try { fs.rmSync(process.env.INTERNAL_ADMIN_STATE_FILE); } catch { /* ok */ }
});

test('isValidCommit: só hex 7–40', () => {
  expect(bc.isValidCommit('68ea1c1')).toBe(true);
  expect(bc.isValidCommit('a'.repeat(40))).toBe(true);
  for (const bad of ['', '68ea1c', 'HEAD~1', 'origin/main', '--hard', '68ea1c1;rm', 'g8ea1c1', 'a'.repeat(41), null]) {
    expect(bc.isValidCommit(bad)).toBe(false);
  }
});

test('commit inválido → recusa sem tocar no repo', async () => {
  const r = await bc.runReset('HEAD~1');
  expect(r.ok).toBe(false);
  expect(git(localRepo, ['rev-parse', 'HEAD'])).toBe(c3);
});

test('commit inexistente → recusa', async () => {
  const r = await bc.runReset('deadbeef');
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/não encontrado/);
});

test('commit fora do histórico do remoto → recusa', async () => {
  git(localRepo, ['checkout', '-qb', 'side']);
  const side = commitFile('b.txt', 'x\n', 'side');
  git(localRepo, ['checkout', '-q', 'main']);
  const r = await bc.runReset(side.slice(0, 10));
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/histórico/);
  expect(git(localRepo, ['rev-parse', 'HEAD'])).toBe(c3);
});

test('reset pra commit antigo: descarta alteração local, roda npm ci (lock mudou), informa atraso', async () => {
  fs.writeFileSync(path.join(localRepo, 'a.txt'), 'sujo\n');
  mockedExecFileSync.mockClear();
  const r = await bc.runReset(c1.slice(0, 7));
  expect(r.ok).toBe(true);
  expect(r.changed).toBe(true);
  expect(git(localRepo, ['rev-parse', 'HEAD'])).toBe(c1);
  expect(fs.readFileSync(path.join(localRepo, 'a.txt'), 'utf8').trim()).toBe('v1');
  expect(r.discarded.some((l) => l.includes('a.txt'))).toBe(true);
  expect(r.behind).toBe(2);
  expect(r.npmRan).toBe(true);
  expect(mockedExecFileSync.mock.calls.some(([cmd]) => cmd === 'npm' || cmd === 'npm.cmd')).toBe(true);
});

test('reset pro mesmo commit com árvore limpa → nada a fazer', async () => {
  const r = await bc.runReset(c1);
  expect(r.ok).toBe(true);
  expect(r.changed).toBe(false);
});

test('reset de volta pro topo (desfazer)', async () => {
  const r = await bc.runReset(c3.slice(0, 8));
  expect(r.ok).toBe(true);
  expect(git(localRepo, ['rev-parse', 'HEAD'])).toBe(c3);
  expect(r.behind).toBe(0);
  void c2;
});

test("'latest' (/reset sem argumento): volta pro último commit do remoto, descartando o que é local", async () => {
  await bc.runReset(c1);
  fs.writeFileSync(path.join(localRepo, 'a.txt'), 'sujo\n');
  const r = await bc.runReset('latest');
  expect(r.ok).toBe(true);
  expect(r.changed).toBe(true);
  expect(git(localRepo, ['rev-parse', 'HEAD'])).toBe(c3);
  expect(r.behind).toBe(0);
  expect(r.discarded.length).toBe(1);
  expect(bc.isValidResetTarget('latest')).toBe(true);
  expect(bc.isValidResetTarget('LATEST')).toBe(false);
});

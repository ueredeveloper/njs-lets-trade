'use strict';

/**
 * runSyncLock — caminhos que não dependem de rede/npm real:
 *   - árvore limpa + lock não muda → committed:false
 *   - arquivo sujo além do package-lock.json → recusa
 *   - só o package-lock.json sujo → NÃO é motivo de recusa
 * (o caminho "npm install --package-lock-only muda o lock → commit + push" foi
 *  validado à mão no repo real: +611 linhas no lock, `npm ci --dry-run` sai 0.)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'synclock-'));
const git = (args) => execFileSync('git', args, { cwd: tmpRepo, encoding: 'utf8' }).trim();

// aponta o botControl pro repo temporário ANTES de exigi-lo (repoRoot() lê ao vivo)
process.env.INTERNAL_ADMIN_STATE_FILE = path.join(tmpRepo, 'state.json');
const { internalConfig } = require('../admin/internalConfig');
internalConfig.repoRoot = tmpRepo;
const bc = require('../admin/botControl');

const emptyLock = () => JSON.stringify(
  { name: 'sl-test', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'sl-test', version: '1.0.0' } } },
  null, 2,
) + '\n';

beforeAll(() => {
  git(['init', '-q']);
  git(['config', 'user.email', 't@t.co']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(tmpRepo, 'package.json'),
    JSON.stringify({ name: 'sl-test', version: '1.0.0', dependencies: {} }, null, 2) + '\n');
  fs.writeFileSync(path.join(tmpRepo, 'package-lock.json'), emptyLock());
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
});

afterAll(() => {
  try { fs.rmSync(tmpRepo, { recursive: true, force: true }); } catch { /* ok */ }
});

test('árvore limpa + package-lock.json sincronizado → ok, sem commit', async () => {
  const r = await bc.runSyncLock();
  expect(r.ok).toBe(true);
  expect(r.changed).toBe(false);
  expect(r.committed).toBe(false);
  expect(git(['log', '--oneline']).split('\n')).toHaveLength(1);
});

test('arquivo sujo além do package-lock.json → recusa e não commita', async () => {
  fs.writeFileSync(path.join(tmpRepo, 'outro.txt'), 'x');
  const r = await bc.runSyncLock();
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/working tree sujo/);
  expect(r.error).toContain('outro.txt');
  expect(git(['log', '--oneline']).split('\n')).toHaveLength(1);
  fs.unlinkSync(path.join(tmpRepo, 'outro.txt'));
});

test('só o package-lock.json sujo NÃO é motivo de recusa', async () => {
  fs.appendFileSync(path.join(tmpRepo, 'package-lock.json'), '\n');
  const r = await bc.runSyncLock();
  expect(r.error || '').not.toMatch(/working tree sujo/);
  git(['checkout', '--', 'package-lock.json']);
});

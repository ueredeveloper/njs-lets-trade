'use strict';

/**
 * Lê informações do repositório git (branch, commit, data, working tree sujo).
 * Usado pela API interna de administração — alimenta o `/admin/status` do njs-whatsapp
 * (versão Git / commit / branch). Resultado em cache curto pra não chamar git a cada request.
 */

const { execFileSync } = require('child_process');
const { internalConfig } = require('./internalConfig');

const CACHE_TTL_MS = 15_000;
let cache = null;
let cachedAt = 0;

function git(args) {
  return execFileSync('git', args, {
    cwd: internalConfig.repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 4000,
  }).trim();
}

function readGitInfo() {
  try {
    return {
      available: true,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) || null,
      commit: git(['rev-parse', '--short', 'HEAD']) || null,
      commitFull: git(['rev-parse', 'HEAD']) || null,
      commitDate: git(['log', '-1', '--format=%cI']) || null,
      subject: git(['log', '-1', '--format=%s']) || null,
      dirty: git(['status', '--porcelain']).length > 0,
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

function getGitInfo() {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache;
  cache = readGitInfo();
  cachedAt = now;
  return cache;
}

module.exports = { getGitInfo };

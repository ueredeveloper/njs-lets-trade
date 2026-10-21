'use strict';

/**
 * Arquivos de estudo da aba Estatísticas → Bandeiras: cada "Buscar" grava a simulação COMPLETA
 * (config + agregados + todas as moedas, bandeiras e entradas) em
 * backend/data/flag-studies/<data BRT>_<escopo>_<intervalo>.json (gitignored via backend/data/**).
 * Mantém os MAX_FILES mais recentes. Falha de disco nunca derruba a busca (best-effort).
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../data/flag-studies');
const MAX_FILES = 50;
const NAME_RE = /^[\w.-]+\.json$/;

function brtStamp(d = new Date()) {
  // YYYY-MM-DD_HH-MM-SS em BRT (UTC−3), pra o nome do arquivo bater com o horário do usuário.
  const b = new Date(d.getTime() - 3 * 3600 * 1000);
  return b.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

function saveFlagStudy(result) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const scope = result.scope === 'symbol' ? result.symbol : 'mercado';
    const file = `${brtStamp()}_${scope}_${result.interval}.json`.replace(/[^\w.-]/g, '');
    const { study, occurrences, forming, ...aggregates } = result;
    const payload = {
      savedAt: new Date().toISOString(),
      timezoneNote: 'Datas em ISO UTC; nome do arquivo em BRT (America/Sao_Paulo).',
      ...aggregates,
      coins: study ?? [],
    };
    fs.writeFileSync(path.join(DIR, file), JSON.stringify(payload, null, 1));
    prune();
    return file;
  } catch (err) {
    console.warn('[flag-study] não gravou o arquivo de estudo:', err.message);
    return null;
  }
}

function prune() {
  const files = listFlagStudies();
  for (const f of files.slice(MAX_FILES)) {
    try { fs.unlinkSync(path.join(DIR, f.file)); } catch { /* ignora */ }
  }
}

function listFlagStudies() {
  try {
    return fs.readdirSync(DIR)
      .filter((f) => NAME_RE.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(DIR, f));
        return { file: f, sizeBytes: st.size, savedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

/** Caminho absoluto de um estudo — null se o nome não for um arquivo válido da pasta. */
function resolveFlagStudy(file) {
  if (!NAME_RE.test(String(file ?? ''))) return null;
  const full = path.join(DIR, file);
  return fs.existsSync(full) ? full : null;
}

module.exports = { saveFlagStudy, listFlagStudies, resolveFlagStudy, FLAG_STUDY_DIR: DIR };

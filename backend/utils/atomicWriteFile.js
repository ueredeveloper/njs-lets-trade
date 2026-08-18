'use strict';

const fs = require('node:fs/promises');

/** Grava em "<file>.tmp-<pid>-<timestamp>" e troca pro nome final com rename (atômico no
 * mesmo volume) — evita arquivo truncado/corrompido se o processo for morto no meio da
 * escrita (ex.: auto-shutdown por inatividade chamando process.exit() enquanto um
 * saveToDisk() de cache ainda estava em andamento; visto corrompendo bb-band-width-cache.json
 * pra 0 bytes numa sessão de debug). Um rename nunca deixa o arquivo pela metade: ou aponta
 * pro conteúdo antigo completo, ou pro novo completo. */
async function atomicWriteFile(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}

module.exports = atomicWriteFile;

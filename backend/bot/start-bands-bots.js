'use strict';

/**
 * SHIM DE COMPATIBILIDADE (v1.135.6) — o launcher virou `start-trade-bots.js`.
 *
 * Este arquivo existe só pra um `/update` disparado pelo supervisor ANTIGO
 * (<= v1.135.5), que ainda tem `LAUNCHER = .../start-bands-bots.js` fixo no
 * código já em execução. Sem isto, o primeiro `spawnLauncher()` pós-merge cairia
 * em ENOENT e os bots ficariam num loop de respawn.
 *
 * Pode ser apagado depois que o supervisor tiver reiniciado a partir da v1.135.6+
 * (restart manual do `npm run bots` no Termux) — aí o `LAUNCHER` já aponta pro
 * nome novo.
 */

require('./start-trade-bots.js');

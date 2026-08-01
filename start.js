const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUNDLE_INDEX = path.join(__dirname, 'frontend-react/dist/index.html');
const hasBundle = fs.existsSync(BUNDLE_INDEX);
const lifecycle = process.env.npm_lifecycle_event || 'start';
const forceDev = lifecycle === 'start:dev';
const forceBundle = lifecycle === 'start:bundle';
const onTermux = !!process.env.TERMUX_VERSION;

// Termux: bundle pré-compilado (sem Vite/Rollup). PC: `npm run start:dev` para HMR.
const useBundle = forceBundle || (!forceDev && hasBundle && onTermux);

let vite;
if (!useBundle) {
  if (onTermux && !hasBundle) {
    console.error(
      '[start] Termux sem bundle em frontend-react/dist/. ' +
      'No PC: npm run build:frontend, commit e pull de novo.'
    );
    process.exit(1);
  }

  vite = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, 'frontend-react'),
    stdio: 'inherit',
    shell: true,
  });

  vite.on('error', (err) => {
    console.error('[vite] erro ao iniciar:', err.message);
    process.exit(1);
  });

  vite.on('close', (code) => {
    if (code !== 0) console.error(`[vite] encerrou com código ${code}`);
    process.exit(code ?? 0);
  });

  // No Windows, vite foi iniciado com shell:true (npm run dev via cmd.exe), então
  // vite.kill() só mata o cmd.exe, deixando o processo real do Vite órfão. taskkill
  // /T mata a árvore inteira. Precisa ser síncrono pois 'exit' não espera async.
  process.on('exit', () => {
    if (!vite || vite.killed || vite.exitCode !== null) return;
    if (process.platform === 'win32') {
      try {
        require('child_process').execSync(`taskkill /PID ${vite.pid} /T /F`, { stdio: 'ignore' });
      } catch {}
    } else {
      vite.kill();
    }
  });
  process.on('SIGINT', () => process.exit());
} else {
  process.env.SERVE_BUNDLE = '1';
  console.log('[start] modo bundle — frontend em http://localhost:3000');
}

require('./backend/server');

const { spawn } = require('child_process');
const path = require('path');

const vite = spawn('npm', ['run', 'dev'], {
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

process.on('exit', () => vite.kill());
process.on('SIGINT', () => process.exit());

require('./backend/server');

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { bootLog, bootError } from './utils/bootLog.js'

bootLog('main.jsx — script carregado');

window.addEventListener('error', (e) => {
  bootError('window.error', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: e.error });
});
window.addEventListener('unhandledrejection', (e) => {
  bootError('unhandledrejection', e.reason);
});

const rootEl = document.getElementById('root');
bootLog('main.jsx — createRoot', { hasRoot: !!rootEl });

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

bootLog('main.jsx — render() chamado');

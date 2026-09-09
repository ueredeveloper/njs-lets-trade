import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadUiPreferences } from './utils/uiPreferences'
import { applyPaletteById } from './utils/palettes'

// Aplica a paleta salva antes do primeiro paint (evita flash da paleta default).
applyPaletteById(loadUiPreferences().paletteDefault)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

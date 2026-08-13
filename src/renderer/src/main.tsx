import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles.css'
// Kit de UI (tokens cd-*): fuente de verdad de los diálogos de creación.
// Se carga después de styles.css para que sus tokens ganen donde coincidan.
import './claude-deck-ui.css'
import '@xterm/xterm/css/xterm.css'

// Aplicar el tema guardado antes del primer render para evitar flash.
// El tema por defecto es el claro crema (rediseño 2a); 'dark' es la variante.
const savedTheme = localStorage.getItem('deck-theme')
if (savedTheme === 'dark') document.documentElement.dataset.theme = 'dark'

// Sin StrictMode: el doble montaje de efectos en dev duplicaría los
// terminales xterm y perdería el buffer de attach del PTY.
createRoot(document.getElementById('root')!).render(<App />)

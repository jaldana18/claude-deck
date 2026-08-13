import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import '@xterm/xterm/css/xterm.css'

// Aplicar el tema guardado antes del primer render para evitar flash
const savedTheme = localStorage.getItem('deck-theme')
if (savedTheme === 'light') document.documentElement.dataset.theme = 'light'

// Sin StrictMode: el doble montaje de efectos en dev duplicaría los
// terminales xterm y perdería el buffer de attach del PTY.
createRoot(document.getElementById('root')!).render(<App />)

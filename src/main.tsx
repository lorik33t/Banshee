// StrictMode is disabled temporarily to avoid double effects while debugging
// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Initialize React app
async function initApp() {
  if ((window as any).__TAURI__) {
    await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/plugin-fs')
    ])

    const ls = localStorage.getItem('ls-width')
    const wb = localStorage.getItem('wb-width')
    if (ls) document.documentElement.style.setProperty('--ls-width', ls + 'px')
    if (wb) document.documentElement.style.setProperty('--wb-width', wb + 'px')
  }

  const rootElement = document.getElementById('root')
  if (rootElement) {
    createRoot(rootElement).render(<App />)
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initApp()
  })
} else {
  initApp()
}
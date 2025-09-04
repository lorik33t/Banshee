// StrictMode is disabled temporarily to avoid double effects while debugging
// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Import Tauri APIs to ensure they're loaded
import '@tauri-apps/api/core'
import '@tauri-apps/plugin-fs'

// Initialize React app
function initApp() {
  const rootElement = document.getElementById('root')
  if (rootElement) {
    createRoot(rootElement).render(
      <App />
    )
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Initialize app settings (only in Tauri environment)
    if ((window as any).__TAURI__) {
      // Restore persisted pane widths
      const ls = localStorage.getItem('ls-width')
      const wb = localStorage.getItem('wb-width')
      if (ls) document.documentElement.style.setProperty('--ls-width', ls + 'px')
      if (wb) document.documentElement.style.setProperty('--wb-width', wb + 'px')
    }
    initApp()
  })
} else {
  // DOM is already ready
  if ((window as any).__TAURI__) {
    // Restore persisted pane widths
    const ls = localStorage.getItem('ls-width')
    const wb = localStorage.getItem('wb-width')
    if (ls) document.documentElement.style.setProperty('--ls-width', ls + 'px')
    if (wb) document.documentElement.style.setProperty('--wb-width', wb + 'px')
  }
  initApp()
}
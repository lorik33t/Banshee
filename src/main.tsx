import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
const { invoke } = (window as any).__TAURI__ || { invoke: async () => {} }

// Start Claude in a demo-safe directory (user can change later via settings)
invoke?.('start_claude', { projectDir: '.' }).catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

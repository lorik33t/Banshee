import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

interface AuthStatus {
  gemini: boolean
  qwen: boolean
  codex: boolean
}

interface ModelAuthState {
  authStatus: AuthStatus
  isChecking: boolean
  lastChecked: number | null
  
  checkAuthStatus: () => Promise<void>
  setAuthStatus: (model: keyof AuthStatus, authenticated: boolean) => void
}

export const useModelAuth = create<ModelAuthState>((set, get) => ({
  authStatus: (() => {
    try {
      const stored = localStorage.getItem('modelAuthStatus')
      if (stored) return JSON.parse(stored) as AuthStatus
    } catch {}
    return { gemini: false, qwen: false, codex: false }
  })(),
  isChecking: false,
  lastChecked: null,
  
  checkAuthStatus: async () => {
    const state = get()
    
    // Don't check if already checking
    if (state.isChecking) return
    
    // Don't check if we checked in the last 30 seconds
    if (state.lastChecked && Date.now() - state.lastChecked < 30000) return
    
    set({ isChecking: true })
    
    try {
      const REPOS_DIR_SNIPPET = 'REPOS_DIR="${BANSHEE_REPOS_DIR:-$HOME/.banshee}";'
      
      // Check all models in parallel
      const [geminiAuth, qwenAuth, codexAuth] = await Promise.all<Promise<boolean>[]>([
        // Gemini - check if CLI works
        invoke('run_command', { 
          command: `gemini --version 2>&1` 
        }).then((result: any) => result.exit_code === 0).catch(() => false),
        
        // Qwen - check if authenticated
        invoke('run_command', { 
          command: `echo "" | qwen -p "test" 2>&1 | grep -q "Loaded cached Qwen credentials" && echo "authenticated"` 
        }).then((result: any) => (result.output || '').includes('authenticated')).catch(() => false),
        
        // Codex - check for API key
        invoke('run_command', {
          command: `${REPOS_DIR_SNIPPET} [ -f "$REPOS_DIR/codex/.env" ] && grep -q "OPENAI_API_KEY=" "$REPOS_DIR/codex/.env" && echo "found"`
        }).then((result: any) => (result.output || '').includes('found')).catch(() => false)
      ])
      
      const newStatus: AuthStatus = {
        gemini: geminiAuth,
        qwen: qwenAuth,
        codex: codexAuth
      }
      try { localStorage.setItem('modelAuthStatus', JSON.stringify(newStatus)) } catch {}
      set({ authStatus: newStatus, isChecking: false, lastChecked: Date.now() })
    } catch (error) {
      console.error('Error checking auth status:', error)
      set({ isChecking: false })
    }
  },
  
  setAuthStatus: (model, authenticated) => {
    set(state => {
      const updated = { ...state.authStatus, [model]: authenticated }
      try { localStorage.setItem('modelAuthStatus', JSON.stringify(updated)) } catch {}
      return { authStatus: updated }
    })
  }
}))
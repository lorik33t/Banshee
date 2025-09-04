import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

interface ModelAuthSimpleProps {
  model: 'gemini' | 'qwen' | 'codex'
  onAuthenticated: () => void
}

interface ModelConfig {
  displayName: string
  subtitle: string
  docsUrl: string
  color: string
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  gemini: {
    displayName: 'Google Gemini',
    subtitle: '1M context • Free tier: 60 req/min',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    color: '#4285f4'
  },
  qwen: {
    displayName: 'Alibaba Qwen',
    subtitle: 'Repository-scale automation',
    docsUrl: 'https://github.com/QwenLM/qwen-code',
    color: '#ff6b00'
  },
  codex: {
    displayName: 'OpenAI Codex',
    subtitle: 'Advanced reasoning models',
    docsUrl: 'https://platform.openai.com/docs',
    color: '#10b981'
  }
}

export function ModelAuthSimple({ model, onAuthenticated }: ModelAuthSimpleProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isChecking, setIsChecking] = useState(false) // Don't check automatically
  const [hasChecked, setHasChecked] = useState(false)
  
  const config = MODEL_CONFIGS[model]
  // Resolve dynamic repo/config directory on shell side
  const REPOS_DIR_SNIPPET = 'REPOS_DIR="${BANSHEE_REPOS_DIR:-$HOME/.banshee}";'
  
  // Don't check automatically - let user trigger it or check after a delay
  useEffect(() => {
    // Only check after settings dialog has been open for a bit
    const timeoutId = setTimeout(() => {
      if (!hasChecked) {
        checkAuthStatus()
      }
    }, 2000) // Wait 2 seconds before checking
    
    return () => clearTimeout(timeoutId)
  }, [model, hasChecked])
  
  const checkAuthStatus = async () => {
    setIsChecking(true)
    setHasChecked(true)
    try {
      // Check if CLI is available and authenticated
      switch (model) {
        case 'gemini':
          // Check if gemini CLI works
          const geminiCheck: any = await invoke('run_command', { 
            command: `gemini --version 2>&1` 
          }).catch(() => null)
          setIsAuthenticated(!!geminiCheck && geminiCheck?.exit_code === 0)
          break
          
        case 'qwen':
          // Check if qwen CLI works and is authenticated
          const qwenCheck: any = await invoke('run_command', { 
            command: `echo "" | qwen -p "test" 2>&1 | grep -q "Loaded cached Qwen credentials" && echo "authenticated"` 
          }).catch(() => null)
          setIsAuthenticated(!!qwenCheck && qwenCheck?.output?.includes('authenticated'))
          break
          
        case 'codex':
          // Check for OpenAI API key in config
          const keyCheck: any = await invoke('run_command', {
            command: `${REPOS_DIR_SNIPPET} [ -f "$REPOS_DIR/codex/.env" ] && grep -q "OPENAI_API_KEY=" "$REPOS_DIR/codex/.env" && echo "found"`
          }).catch(() => null)
          setIsAuthenticated(!!keyCheck && keyCheck?.output?.includes('found'))
          break
      }
      
      if (isAuthenticated) {
        onAuthenticated()
      }
    } catch (e) {
      console.error('Error checking auth status:', e)
      setIsAuthenticated(false)
    } finally {
      setIsChecking(false)
    }
  }
  
  return (
    <div className="model-auth-simple">
      <div className="model-header-simple">
        <div className="model-info">
          <div className="model-icon" style={{ background: `${config.color}20`, color: config.color }}>
            {model === 'gemini' && (
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
              </svg>
            )}
            {model === 'qwen' && (
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              </svg>
            )}
            {model === 'codex' && (
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>
              </svg>
            )}
          </div>
          <div>
            <h3>{config.displayName}</h3>
            <p className="model-subtitle-simple">{config.subtitle}</p>
          </div>
        </div>
        <a 
          href={config.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="model-docs-link-simple"
        >
          <ExternalLink size={14} />
          Docs
        </a>
      </div>
      
      <div className="auth-status-container">
        {isChecking ? (
          // Show spinner while checking
          <div className="auth-status checking">
            <div className="spinner" />
            <span>Checking...</span>
          </div>
        ) : !hasChecked ? (
          // Show unknown state before first check
          <div className="auth-status unknown">
            <div className="status-dot" />
            <span>Status unknown</span>
          </div>
        ) : isAuthenticated ? (
          <div className="auth-status authenticated">
            <CheckCircle size={20} color="#10b981" />
            <span>Currently authenticated</span>
          </div>
        ) : (
          <div className="auth-status not-authenticated">
            <AlertCircle size={20} color="#ef4444" />
            <span>Not authenticated</span>
          </div>
        )}
      </div>
    </div>
  )
}
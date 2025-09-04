import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { LogIn, CheckCircle, AlertCircle, ExternalLink, Loader2, Download, Key } from 'lucide-react'
import { CustomInput } from './CustomInput'
import { CustomSelect } from './CustomSelect'

interface ModelAuthProps {
  model: 'gemini' | 'qwen' | 'codex'
  onAuthenticated: () => void
}

interface AuthConfig {
  method: 'oauth' | 'apikey' | 'both'
  oauthUrl?: string
  apiKeyUrl: string
  docsUrl: string
  displayName: string
  provider: string
  instructions: string[]
}

const AUTH_CONFIGS: Record<string, AuthConfig> = {
  gemini: {
    method: 'both',
    oauthUrl: 'https://accounts.google.com/oauth2/auth',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    displayName: 'Google Gemini',
    provider: 'Google',
    instructions: [
      'Option 1: OAuth - Recommended for personal use',
      'Option 2: API Key - Better for automation',
      'Free tier: 60 requests/min, 1,000 requests/day'
    ]
  },
  qwen: {
    method: 'both',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    docsUrl: 'https://github.com/QwenLM/qwen-code',
    displayName: 'Alibaba Qwen',
    provider: 'Qwen',
    instructions: [
      'Repository-scale automation',
      'Free tier: 2,000 requests/day'
    ]
  },
  codex: {
    method: 'both',
    oauthUrl: 'https://chat.openai.com',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs',
    displayName: 'OpenAI Codex',
    provider: 'OpenAI',
    instructions: [
      'Click "Get API Key" to open OpenAI Platform',
      'Sign in with your OpenAI/ChatGPT account',
      'Navigate to API keys section',
      'Click "Create new secret key"',
      'Copy the generated key (you won\'t see it again!)',
      'Paste it below and click "Save API Key"'
    ]
  }
}

export function ModelAuth({ model, onAuthenticated }: ModelAuthProps) {
  const [authMethod, setAuthMethod] = useState<'oauth' | 'apikey'>(
    AUTH_CONFIGS[model].method === 'apikey' ? 'apikey' : 'oauth'
  )
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentKeyPreview, setCurrentKeyPreview] = useState('')
  const [isInstalled, setIsInstalled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  
  const config = AUTH_CONFIGS[model]
  // Resolve repo/config directory dynamically on the shell side:
  // Uses $BANSHEE_REPOS_DIR if set, otherwise falls back to $HOME/.banshee
  const REPOS_DIR_SNIPPET = 'REPOS_DIR="${BANSHEE_REPOS_DIR:-$HOME/.banshee}";'
  
  // Note: We intentionally do NOT auto-run checkStatus on mount to avoid
  // heavy shell checks during app startup. Checks run on-demand via UI.
  
  const checkStatus = async () => {
    if (isChecking) return
    setIsChecking(true)
    try {
      // Check if installed
      let installCheck = null
      switch (model) {
        case 'gemini':
          installCheck = await invoke('run_command', { 
            command: `${REPOS_DIR_SNIPPET} [ -f "$REPOS_DIR/.gemini-installed" ] && echo "found"` 
          }).catch(() => null)
          break
        case 'qwen':
          // For Qwen, just check if the CLI is available (users install it themselves)
          installCheck = await invoke('run_command', { 
            command: `which qwen >/dev/null 2>&1 && echo "found"` 
          }).catch(() => null)
          break
        case 'codex':
          installCheck = await invoke('run_command', { 
            command: `${REPOS_DIR_SNIPPET} which codex 2>/dev/null || [ -f "$REPOS_DIR/codex/target/release/codex" ] && echo "found"` 
          }).catch(() => null)
          break
      }
      
      const installed = !!installCheck
      setIsInstalled(installed)
      
      // Skip writing binPath to settings for performance and to avoid blocking on startup

      // Check authentication only if installed
      if (installed) {
        let configFile = ''
        let keyName = ''
        
        switch (model) {
          case 'gemini':
            // Check for both our config and Gemini's native config locations
            const geminiConfigCheck: any = await invoke('run_command', {
              command: `${REPOS_DIR_SNIPPET} [ -f "$REPOS_DIR/.gemini/.env" ] && grep -q "GEMINI_API_KEY=" "$REPOS_DIR/.gemini/.env" && echo "gemini-native" || echo "not-found"`
            }).catch(() => ({ output: 'not-found' }))
            const geminiOut = typeof geminiConfigCheck === 'string' ? geminiConfigCheck : (geminiConfigCheck?.output || '')
            if (geminiOut.includes('gemini-native')) {
              setIsAuthenticated(true)
              setCurrentKeyPreview('Gemini CLI OAuth/Config')
              return
            }
            
            // Fallback to our custom config
            configFile = '"$REPOS_DIR/.gemini-config"'
            keyName = 'GEMINI_API_KEY'
            break
          case 'qwen':
            // Qwen only supports API key authentication
            configFile = '"$REPOS_DIR/.qwen-config"'
            keyName = 'QWEN_API_KEY'
            break
          case 'codex':
            configFile = '"$REPOS_DIR/codex/.env"'
            keyName = 'OPENAI_API_KEY'
            break
        }
        
        const result: any = await invoke('run_command', {
          command: `${REPOS_DIR_SNIPPET} [ -f ${configFile} ] && grep "${keyName}=" ${configFile} | cut -d= -f2`
        }).catch(() => null)
        const output = typeof result === 'string' ? result : (result?.output || '')
        if (output) {
          const key = output.trim()
          if (key) {
            setIsAuthenticated(true)
            // Show only first and last 4 characters of key
            if (key.length > 8) {
              setCurrentKeyPreview(`${key.slice(0, 4)}...${key.slice(-4)}`)
            } else {
              setCurrentKeyPreview('***')
            }
          }
        }
      }
    } catch (e) {
      console.error('Error checking status:', e)
    } finally {
      setIsChecking(false)
    }
  }
  
  const handleOAuthSignIn = async () => {
    setLoading(true)
    try {
      if (model === 'gemini') {
        // For Gemini, start an interactive OAuth flow using the CLI
        try {
          setError('Starting Gemini OAuth - this will open your browser...')
          setShowInstructions(true)
          
          // Run gemini in the background - it will handle OAuth automatically
          // We'll use a simple prompt to trigger the auth flow
          const result = await invoke('run_command', {
            command: 'echo "Starting authentication..." | timeout 30 gemini --prompt "test" || echo "Auth flow initiated"'
          })
          
          console.log('[Gemini OAuth] Auth flow result:', result)
          
          // Give user time to complete OAuth in browser
          setError('Complete the Google sign-in in your browser, then click "Check Authentication" below')
          
        } catch (e) {
          console.error('[Gemini OAuth] Error:', e)
          setError('Failed to start OAuth flow. Try the API key method instead.')
        }
      } else if (model === 'qwen') {
        // For Qwen, just show a message to authenticate in Terminal
        setError('Please run "qwen" in Terminal to authenticate')
        setShowInstructions(false)
      } else if (model === 'codex') {
        // For OpenAI, direct to ChatGPT Plus/Pro subscription page
        await invoke('run_command', {
          command: `open "https://chat.openai.com/auth/login?next=/gpts"`
        })
        setError('Sign in to ChatGPT Plus/Pro/Team to use with Codex. Then get your API key.')
        setShowInstructions(true)
      }
    } catch (e) {
      setError(`Failed to open sign-in page: ${e}`)
    } finally {
      setLoading(false)
    }
  }
  
  const installModel = async () => {
    console.log(`[${model}] Install button clicked, starting installation...`)
    setIsInstalling(true)
    setError('')
    
    try {
      let command = ''
      
      switch (model) {
        case 'gemini':
          // Install Gemini CLI globally from npm (official package)
          command = `${REPOS_DIR_SNIPPET} mkdir -p "$REPOS_DIR" && npm install -g @google/gemini-cli && touch "$REPOS_DIR/.gemini-installed" && echo "Gemini CLI installed successfully"`
          break
        case 'qwen':
          // Users install Qwen manually
          return
        case 'codex':
          // Clone and setup Codex from GitHub (Rust-based, needs cargo)
          command = `${REPOS_DIR_SNIPPET} mkdir -p "$REPOS_DIR" && cd "$REPOS_DIR" && if [ ! -d "codex" ]; then git clone https://github.com/openai/codex.git; fi && cd codex && if command -v cargo >/dev/null 2>&1; then cargo build --release && ln -sf "$(pwd)/target/release/codex" /usr/local/bin/codex 2>/dev/null || echo "Need sudo for symlink"; else echo "Cargo not found. Install Rust first: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; fi`
          break
      }
      
      console.log(`[${model}] Installing with command:`, command)
      const result = await invoke('run_command', { command })
      
      console.log(`[${model}] Installation result:`, result)
      
      // Wait a moment for the installation to settle
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Verify installation worked before marking as installed
      let verifyCommand = ''
      switch (model) {
        case 'gemini':
          // Verify both marker file exists AND gemini command is available
          verifyCommand = `${REPOS_DIR_SNIPPET} [ -f "$REPOS_DIR/.gemini-installed" ] && gemini --version && echo "verified"`
          break
        case 'codex':
          verifyCommand = `${REPOS_DIR_SNIPPET} which codex 2>/dev/null || [ -f "$REPOS_DIR/codex/target/release/codex" ] && echo "verified"`
          break
      }
      
      const verificationRes: any = await invoke('run_command', { command: verifyCommand }).catch(() => null)
      const verificationOut = typeof verificationRes === 'string' ? verificationRes : (verificationRes?.output || '')
      if (verificationOut && verificationOut.includes('verified')) {
        setIsInstalled(true)
        setError('')
        console.log(`[${model}] Installation verified successfully`)
      } else {
        setError(`Installation verification failed for ${model}. Please try again.`)
        console.error(`[${model}] Installation verification failed:`, verificationRes)
      }
      
      setIsInstalling(false)
      
      // Re-check status after installation
      await checkStatus()
    } catch (e) {
      console.error(`Error installing ${model}:`, e)
      setError(`Failed to install ${model}: ${e}`)
      setIsInstalling(false)
    }
  }
  
  const handleApiKeySave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key')
      return
    }
    
    setLoading(true)
    setError('')
    
    try {
      let configPath = ''
      let keyName = ''
      
      switch (model) {
        case 'gemini':
          // Use Gemini CLI's native config location
          configPath = '"$REPOS_DIR/.gemini/.env"'
          keyName = 'GEMINI_API_KEY'
          
          // Create .gemini directory if it doesn't exist
          await invoke('run_command', {
            command: `${REPOS_DIR_SNIPPET} mkdir -p "$REPOS_DIR/.gemini"`
          })
          break
        case 'qwen':
          configPath = '"$REPOS_DIR/.qwen-config"'
          keyName = 'QWEN_API_KEY'
          break
        case 'codex':
          configPath = '"$REPOS_DIR/codex/.env"'
          keyName = 'OPENAI_API_KEY'
          break
      }
      
      // Create repos directory if it doesn't exist
      await invoke('run_command', {
        command: `${REPOS_DIR_SNIPPET} mkdir -p "$REPOS_DIR"`
      })
      
      // For codex, also create the codex subdirectory
      if (model === 'codex') {
        await invoke('run_command', {
          command: `${REPOS_DIR_SNIPPET} mkdir -p "$REPOS_DIR/codex"`
        })
      }
      
      // Save the API key
      await invoke('run_command', {
        command: `${REPOS_DIR_SNIPPET} echo "${keyName}=${apiKey}" > ${configPath}`
      })
      
      // Verify it was saved
      const verify = await invoke('run_command', {
        command: `${REPOS_DIR_SNIPPET} grep -q "${keyName}=" ${configPath} && echo "success"`
      })
      
      if (verify === 'success') {
        setIsAuthenticated(true)
        checkStatus() // Refresh status
        onAuthenticated()
      } else {
        throw new Error('Failed to save API key')
      }
    } catch (e) {
      setError(`Failed to save API key: ${e}`)
    } finally {
      setLoading(false)
    }
  }
  
  const openApiKeyPage = async () => {
    try {
      // Use macOS open command to open URL in default browser
      await invoke('run_command', {
        command: `open "${config.apiKeyUrl}"`
      })
      setShowInstructions(true)
    } catch (e) {
      setError(`Please open this URL manually: ${config.apiKeyUrl}`)
      setShowInstructions(true)
    }
  }
  
  return (
    <div className="model-auth-container" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="model-auth-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{config.displayName}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {model === 'gemini' && '1M context • Free tier: 60 req/min'}
            {model === 'qwen' && 'Repository-scale automation'}
            {model === 'codex' && 'Ultra-fast code execution'}
          </div>
        </div>
        <a href={config.docsUrl} target="_blank" rel="noopener noreferrer" className="settings-btn secondary" style={{ height: 28, padding: '0 10px' }}>
          <ExternalLink size={14} />
          <span style={{ marginLeft: 6 }}>Docs</span>
        </a>
      </div>
      
      {isAuthenticated && (
        <div className="auth-current-status">
          <div className="auth-status-info">
            <CheckCircle size={16} color="#10b981" />
            <span>Currently authenticated</span>
          </div>
          {currentKeyPreview && (
            <div className="auth-key-preview">
              API Key: <code>{currentKeyPreview}</code>
            </div>
          )}
          <div className="auth-status-actions">
            <button
              className="settings-btn"
              style={{ height: 28 }}
              onClick={() => setIsAuthenticated(false)}
            >
              <Key size={14} />
              <span style={{ marginLeft: 6 }}>Update API Key</span>
            </button>
          </div>
        </div>
      )}
      
      {error && (
        <div className="auth-error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      
      {!isInstalled && (
        <div className="auth-install-section">
          {model === 'qwen' ? (
            <div className="auth-manual-install">
              <div className="auth-install-info">
                <AlertCircle size={16} color="#f59e0b" />
                <span>Qwen CLI not detected</span>
              </div>
              <div className="auth-install-instructions">
                <p>Install Qwen CLI in Terminal:</p>
                <div className="code-block">
                  <code>npm install -g @qwen-code/qwen-code@latest</code>
                </div>
                <p>Then run <code>qwen</code> to authenticate</p>
              </div>
              <button
                className="auth-btn secondary"
                onClick={() => checkStatus()}
              >
                <CheckCircle size={14} />
                Refresh Status
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#f59e0b', fontSize: 12 }}>
                <AlertCircle size={14} />
                Not installed
              </span>
              <button className="settings-btn primary" style={{ height: 28 }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); installModel() }} disabled={isInstalling}>
                {isInstalling ? (<><Loader2 size={14} className="spin" /><span style={{ marginLeft: 6 }}>Installing…</span></>) : (<><Download size={14} /><span style={{ marginLeft: 6 }}>Install</span></>)}
              </button>
            </div>
          )}
        </div>
      )}
      
      {isInstalled && !isAuthenticated && (
        <div className="auth-config-section">
          <div className="auth-config-grid">
            {/* Authentication Method Dropdown */}
            {config.method === 'both' && (
              <div className="auth-config-field">
                <label>Authentication Method</label>
                <CustomSelect
                  value={authMethod}
                  onChange={(value) => {
                    setAuthMethod(value as 'oauth' | 'apikey')
                    setError('')
                    setShowInstructions(false)
                  }}
                  options={[
                    { 
                      value: 'oauth', 
                      label: `Sign in with ${config.provider}`
                    },
                    { 
                      value: 'apikey', 
                      label: 'Use API Key'
                    }
                  ]}
                />
              </div>
            )}
            
            {/* OAuth Method */}
            {authMethod === 'oauth' && (config.method === 'both' || config.method === 'oauth') && (
              <div className="auth-oauth-section">
                {model === 'qwen' ? (
                  /* Qwen-specific OAuth UI */
                  <div className="auth-qwen-terminal">
                    <div className="auth-terminal-message">
                      <p>To authenticate Qwen, run this command in Terminal:</p>
                      <div className="code-block">
                        <code>qwen</code>
                      </div>
                      <p className="auth-hint">This will open your browser for authentication</p>
                    </div>
                    
                    <button
                      className="settings-btn"
                      style={{ height: 32, marginTop: 16 }}
                      onClick={async () => {
                        setLoading(true)
                        try {
                          await checkStatus()
                          if (isAuthenticated) {
                            setError('')
                            onAuthenticated()
                          } else {
                            setError('Authentication not detected. Please complete the authentication in Terminal first.')
                          }
                        } catch (e) {
                          setError('Failed to check authentication status')
                        } finally {
                          setLoading(false)
                        }
                      }}
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 size={14} className="spin" />
                          <span style={{ marginLeft: 6 }}>Checking...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle size={14} />
                          <span style={{ marginLeft: 6 }}>Check status</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  /* Other models OAuth UI */
                  <>
                    <button
                      className="settings-btn primary"
                      style={{ height: 32 }}
                      onClick={handleOAuthSignIn}
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 size={16} className="spin" />
                          Opening {config.provider}…
                        </>
                      ) : (
                        <>
                          <LogIn size={16} />
                          <span style={{ marginLeft: 6 }}>Sign in</span>
                        </>
                      )}
                    </button>
                    
                    <button
                      className="settings-btn"
                      style={{ height: 28, marginTop: 8 }}
                      onClick={async () => {
                        setLoading(true)
                        try {
                          await checkStatus()
                          if (isAuthenticated) {
                            setError('')
                            onAuthenticated()
                          } else {
                            setError('Authentication not detected yet. Complete sign-in, then try again or use API Key.')
                          }
                        } catch (e) {
                          setError('Failed to check authentication status')
                        } finally {
                          setLoading(false)
                        }
                      }}
                      disabled={loading}
                    >
                      <CheckCircle size={14} />
                      <span style={{ marginLeft: 6 }}>Check status</span>
                    </button>
                    
                    {showInstructions && (
                      <div className="auth-oauth-info">
                        <p style={{ fontSize: 12, color: 'var(--muted)' }}>A browser window will open to authenticate. Complete sign-in and return here, then click Check status.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {/* API Key Method */}
            {authMethod === 'apikey' && (config.method === 'both' || config.method === 'apikey') && (
              <div className="auth-apikey-section">
                <div className="auth-input-group">
                  <CustomInput
                    label="API Key"
                    type="password"
                    value={apiKey}
                    onChange={(v) => setApiKey(String(v))}
                    placeholder={`Enter your ${config.displayName} API key`}
                  />
                  
                  <div className="auth-input-actions">
                    <button
                      className="settings-btn"
                      style={{ height: 28 }}
                      onClick={openApiKeyPage}
                    >
                      <ExternalLink size={14} />
                      <span style={{ marginLeft: 6 }}>Get API Key</span>
                    </button>
                    
                    <button
                      className="settings-btn primary"
                      style={{ height: 28 }}
                      onClick={handleApiKeySave}
                      disabled={loading || !apiKey.trim()}
                    >
                      {loading ? (
                        <>
                          <Loader2 size={14} className="spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <CheckCircle size={14} />
                          <span style={{ marginLeft: 6 }}>Save Key</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                
                {showInstructions && (
                  <div className="auth-instructions-compact">
                    <p>To get your API key:</p>
                    <ol>
                      <li>Click "Get API Key" above</li>
                      <li>Sign in to {config.provider}</li>
                      <li>Create a new API key</li>
                      <li>Copy and paste it here</li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { X, Save, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSettings } from '../state/settings'

export function SettingsDialog() {
  const { 
    settings, 
    isOpen, 
    isLoading, 
    error,
    loadSettings, 
    saveSettings, 
    closeSettings 
  } = useSettings()
  
  const [localSettings, setLocalSettings] = useState(settings)
  const [activeTab, setActiveTab] = useState<'general' | 'permissions' | 'development' | 'mcp' | 'hooks' | 'advanced'>('general')
  
  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])
  
  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])
  
  if (!isOpen) return null
  
  const handleSave = async () => {
    await saveSettings(localSettings)
    closeSettings()
  }
  
  const updateLocal = <K extends keyof typeof localSettings>(
    key: K, 
    value: typeof localSettings[K]
  ) => {
    setLocalSettings({ ...localSettings, [key]: value })
  }
  
  return (
    <div className="settings-overlay">
      <div className="settings-dialog">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={closeSettings}>
            <X size={20} />
          </button>
        </div>
        
        <div className="settings-tabs">
          <button 
            className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button 
            className={`settings-tab ${activeTab === 'permissions' ? 'active' : ''}`}
            onClick={() => setActiveTab('permissions')}
          >
            Permissions
          </button>
          <button 
            className={`settings-tab ${activeTab === 'development' ? 'active' : ''}`}
            onClick={() => setActiveTab('development')}
          >
            Development
          </button>
          <button 
            className={`settings-tab ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            MCP Servers
          </button>
          <button 
            className={`settings-tab ${activeTab === 'hooks' ? 'active' : ''}`}
            onClick={() => setActiveTab('hooks')}
          >
            Hooks
          </button>
          <button 
            className={`settings-tab ${activeTab === 'advanced' ? 'active' : ''}`}
            onClick={() => setActiveTab('advanced')}
          >
            Advanced
          </button>
        </div>
        
        <div className="settings-content">
          {error && (
            <div className="settings-error">
              {error}
            </div>
          )}
          
          {activeTab === 'general' && (
            <div className="settings-section">
              <h3>General Settings</h3>
              
              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={localSettings.autoUpdates ?? true}
                    onChange={(e) => updateLocal('autoUpdates', e.target.checked)}
                  />
                  <span>Enable automatic updates</span>
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={localSettings.verbose ?? false}
                    onChange={(e) => updateLocal('verbose', e.target.checked)}
                  />
                  <span>Verbose output (show full command outputs)</span>
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  Chat history retention (days)
                  <input 
                    type="number"
                    value={localSettings.cleanupPeriodDays ?? 30}
                    onChange={(e) => updateLocal('cleanupPeriodDays', parseInt(e.target.value))}
                    min="1"
                    max="365"
                  />
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  Model Override
                  <select 
                    value={localSettings.model || ''}
                    onChange={(e) => updateLocal('model', e.target.value || undefined)}
                  >
                    <option value="">Default (claude-3-5-sonnet)</option>
                    <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Oct 2024)</option>
                    <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                    <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          
          {activeTab === 'permissions' && (
            <div className="settings-section">
              <h3>Permission Settings</h3>
              
              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={localSettings.autoApprove ?? false}
                    onChange={(e) => updateLocal('autoApprove', e.target.checked)}
                  />
                  <span>Auto-approve all tool usage</span>
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  Auto-approve patterns (one per line)
                  <textarea
                    value={localSettings.autoApprovePatterns?.join('\n') || ''}
                    onChange={(e) => {
                      const patterns = e.target.value.split('\n').filter(p => p.trim())
                      updateLocal('autoApprovePatterns', patterns.length > 0 ? patterns : undefined)
                    }}
                    placeholder="/path/to/your/project/**"
                    rows={4}
                  />
                </label>
                <small>Directories where tool usage is auto-approved</small>
              </div>
              
              <div className="setting-item">
                <label>
                  Deny patterns (one per line)
                  <textarea
                    value={localSettings.permissions?.deny?.join('\n') || ''}
                    onChange={(e) => {
                      const patterns = e.target.value.split('\n').filter(p => p.trim())
                      updateLocal('permissions', {
                        ...localSettings.permissions,
                        deny: patterns.length > 0 ? patterns : undefined
                      })
                    }}
                    placeholder="Read(./.env)&#10;Read(./secrets/**)&#10;Write(./config/credentials.json)"
                    rows={4}
                  />
                </label>
                <small>Prevent access to sensitive files (e.g., Read(./.env), Write(./secrets/**))</small>
              </div>
            </div>
          )}
          
          {activeTab === 'development' && (
            <div className="settings-section">
              <h3>Development Settings</h3>
              
              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={localSettings.includeCoAuthoredBy ?? true}
                    onChange={(e) => updateLocal('includeCoAuthoredBy', e.target.checked)}
                  />
                  <span>Include "Co-authored-by Claude" in git commits</span>
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  Environment Variables (JSON format)
                  <textarea
                    value={JSON.stringify(localSettings.env || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const env = JSON.parse(e.target.value)
                        updateLocal('env', env)
                      } catch {
                        // Invalid JSON, don't update
                      }
                    }}
                    placeholder='{"NODE_ENV": "development"}'
                    rows={6}
                  />
                </label>
                <small>Environment variables for each Claude session</small>
              </div>
            </div>
          )}
          
          {activeTab === 'mcp' && (
            <div className="settings-section">
              <h3>MCP Server Configuration</h3>
              
              <div className="setting-item">
                <label>
                  MCP Servers (JSON format)
                  <textarea
                    value={JSON.stringify(localSettings.mcpServers || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const servers = JSON.parse(e.target.value)
                        updateLocal('mcpServers', servers)
                      } catch {
                        // Invalid JSON, don't update
                      }
                    }}
                    placeholder={`{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"]
  },
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token"
    }
  }
}`}
                    rows={12}
                  />
                </label>
                <small>Configure MCP servers for tool integrations (filesystem, GitHub, Slack, etc.)</small>
              </div>
              
              <div className="setting-item">
                <h4>Popular MCP Servers:</h4>
                <small>
                  • Filesystem: Access local files and directories<br/>
                  • GitHub: Manage issues, PRs, and repositories<br/>
                  • Slack: Send messages and read channels<br/>
                  • Brave Search: Web search capabilities<br/>
                  • Sequential Thinking: Step-by-step problem solving<br/>
                  • Puppeteer: Browser automation
                </small>
              </div>
            </div>
          )}
          
          {activeTab === 'hooks' && (
            <div className="settings-section">
              <h3>Hooks Configuration</h3>
              
              <div className="setting-item">
                <label>
                  Hooks (JSON format)
                  <textarea
                    value={JSON.stringify(localSettings.hooks || [], null, 2)}
                    onChange={(e) => {
                      try {
                        const hooks = JSON.parse(e.target.value)
                        updateLocal('hooks', hooks)
                      } catch {
                        // Invalid JSON, don't update
                      }
                    }}
                    placeholder={`[
  {
    "matcher": "Edit|Write",
    "hooks": [
      {
        "type": "command",
        "command": "prettier --write \\"$CLAUDE_FILE_PATHS\\""
      }
    ]
  }
]`}
                    rows={10}
                  />
                </label>
                <small>Define pre/post tool execution commands (e.g., format on save, lint checks)</small>
              </div>
              
              <div className="setting-item">
                <h4>Hook Types:</h4>
                <small>
                  • PreToolUse: Before tool execution<br/>
                  • PostToolUse: After tool execution<br/>
                  • Notification: On notifications<br/>
                  • Stop: On session stop<br/>
                  <br/>
                  Available matchers: Edit, Write, Read, Bash, etc.
                </small>
              </div>
            </div>
          )}
          
          {activeTab === 'advanced' && (
            <div className="settings-section">
              <h3>Advanced Settings</h3>
              
              <div className="setting-item">
                <label>
                  API Key Helper Script
                  <input 
                    type="text"
                    value={localSettings.apiKeyHelper || ''}
                    onChange={(e) => updateLocal('apiKeyHelper', e.target.value || undefined)}
                    placeholder="/path/to/generate_api_key.sh"
                  />
                </label>
                <small>Script to generate authentication value</small>
              </div>
              
              <div className="setting-item">
                <label>
                  Force Login Method
                  <select 
                    value={localSettings.forceLoginMethod || ''}
                    onChange={(e) => updateLocal('forceLoginMethod', e.target.value as any || undefined)}
                  >
                    <option value="">No restriction</option>
                    <option value="claudeai">Claude.ai only</option>
                    <option value="console">Console only</option>
                  </select>
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={localSettings.hasCompletedOnboarding ?? false}
                    onChange={(e) => updateLocal('hasCompletedOnboarding', e.target.checked)}
                  />
                  <span>Has completed onboarding</span>
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={localSettings.shiftEnterKeyBinding ?? false}
                    onChange={(e) => updateLocal('shiftEnterKeyBinding', e.target.checked)}
                  />
                  <span>Enable Shift+Enter key binding in terminal</span>
                </label>
              </div>
              
              <div className="setting-item">
                <label>
                  Notification Channel
                  <select 
                    value={localSettings.preferredNotifChannel || ''}
                    onChange={(e) => updateLocal('preferredNotifChannel', e.target.value || undefined)}
                  >
                    <option value="">Default</option>
                    <option value="desktop">Desktop notifications</option>
                    <option value="terminal">Terminal output</option>
                    <option value="none">No notifications</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>
        
        <div className="settings-footer">
          <button 
            className="settings-btn secondary" 
            onClick={() => loadSettings()}
            disabled={isLoading}
          >
            <RefreshCw size={16} />
            Reload
          </button>
          <div className="settings-actions">
            <button className="settings-btn secondary" onClick={closeSettings}>
              Cancel
            </button>
            <button 
              className="settings-btn primary" 
              onClick={handleSave}
              disabled={isLoading}
            >
              <Save size={16} />
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
import { Save, Brain, Server, Shield, Code, Settings2, ArrowLeft, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSettings } from '../state/settings'
import { MCPServerConfig } from './MCPServerConfig'
import { SubAgentsConfig } from './SubAgentsConfig'
import { ModelSelector } from './ModelSelector'
import { CustomSelect } from './CustomSelect'
import { ToggleSwitch } from './ToggleSwitch'
import { CustomInput } from './CustomInput'
import { CustomTextArea } from './CustomTextArea'
// import { invoke } from '@tauri-apps/api/core'
import { ModelAuthStatic } from './ModelAuthStatic'
import { useModelAuth } from '../state/modelAuth'

interface SettingsDialogV2Props {
  onClose?: () => void
}

export function SettingsDialogV2({ onClose }: SettingsDialogV2Props) {
  const { 
    settings, 
    error,
    loadSettings, 
    saveSettings
  } = useSettings()
  const { checkAuthStatus, isChecking } = useModelAuth()
  
  // Initialize with current settings immediately
  const [localSettings, setLocalSettings] = useState(() => settings)
  const [activeTab, setActiveTab] = useState<'general' | 'agents' | 'mcp' | 'permissions' | 'advanced'>('general')
  // const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({
  //   gemini: { installed: false, installing: false, authenticated: false },
  //   qwen: { installed: false, installing: false, authenticated: false },
  //   codex: { installed: false, installing: false, authenticated: false }
  // })
  // Inline agent setup (no cards, no dropdowns)
  
  useEffect(() => {
    // Load settings in background without blocking UI
    requestAnimationFrame(() => {
      loadSettings()
    })
  }, [])
  
  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])
  
  // const checkModelStatus = async () => {
  //   // This is now handled by ModelAuthSimple components individually
  //   // No need to check here
  // }
  
  
  
  const handleSave = async () => {
    await saveSettings(localSettings)
    if (onClose) onClose()
  }
  
  const updateLocal = <K extends keyof typeof localSettings>(
    key: K, 
    value: typeof localSettings[K]
  ) => {
    setLocalSettings({ ...localSettings, [key]: value })
  }

  const tabs = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'agents', label: 'Sub-Agents', icon: Brain },
    { id: 'mcp', label: 'MCP Servers', icon: Server },
    { id: 'permissions', label: 'Permissions', icon: Shield },
    { id: 'advanced', label: 'Advanced', icon: Code }
  ]
  
  return (
    <div className="settings-fullscreen">
      <div className="settings-header">
        <div className="settings-header-left">
          <button className="settings-back-btn" onClick={onClose}>
            <ArrowLeft size={20} />
          </button>
          <h2>Settings</h2>
        </div>
        <div className="settings-header-actions">
          <button className="settings-btn primary" onClick={handleSave}>
            <Save size={16} />
            Save Changes
          </button>
        </div>
      </div>
      
      <div className="settings-layout">
        <div className="settings-sidebar">
          {tabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id as any)}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
        
      <div className="settings-content">
          {error && (
            <div className="settings-error">
              {error}
            </div>
          )}
          
          {activeTab === 'general' && (
            <div className="settings-panel general-settings">
              <h3>General Settings</h3>
              
              {/* Agents (inline, no cards) */}
              <div className="settings-group">
                <div className="settings-group-header">
                  <div>
                    <h4>Agents (CLI Tools)</h4>
                    <p className="settings-description">Install and configure external CLI models. Supports API key and Sign-in.</p>
                  </div>
                  <button 
                    className="settings-btn secondary"
                    onClick={() => checkAuthStatus()}
                    disabled={isChecking}
                    style={{ height: 28 }}
                  >
                    <RefreshCw size={14} className={isChecking ? 'spin' : ''} />
                    <span style={{ marginLeft: 6 }}>Refresh</span>
                  </button>
                </div>
                <div className="agents-grid">
                  <div className="agent-inline"><ModelAuthStatic model="gemini" /></div>
                  <div className="agent-inline"><ModelAuthStatic model="qwen" /></div>
                  <div className="agent-inline"><ModelAuthStatic model="codex" /></div>
                </div>
                <div className="setting-item-row" style={{ marginTop: 12 }}>
                  <ToggleSwitch
                    label="Enable Gemini"
                    description="Allow router to use Gemini"
                    value={(localSettings.agents?.gemini?.enabled) !== false}
                    onChange={(v) => setLocalSettings({
                      ...localSettings,
                      agents: { 
                        ...(localSettings.agents || {}), 
                        gemini: { ...(localSettings.agents?.gemini || {}), enabled: v }
                      }
                    })}
                  />
                  <ToggleSwitch
                    label="Enable Qwen"
                    description="Allow router to use Qwen"
                    value={(localSettings.agents?.qwen?.enabled) !== false}
                    onChange={(v) => setLocalSettings({
                      ...localSettings,
                      agents: { 
                        ...(localSettings.agents || {}), 
                        qwen: { ...(localSettings.agents?.qwen || {}), enabled: v }
                      }
                    })}
                  />
                  <ToggleSwitch
                    label="Enable Codex"
                    description="Allow router to use Codex"
                    value={(localSettings.agents?.codex?.enabled) === true}
                    onChange={(v) => setLocalSettings({
                      ...localSettings,
                      agents: { 
                        ...(localSettings.agents || {}), 
                        codex: { ...(localSettings.agents?.codex || {}), enabled: v }
                      }
                    })}
                  />
                </div>

                {/* Codex UX preferences */}
                <div className="setting-item-row" style={{ marginTop: 6 }}>
                  <div className="setting-field">
                    <label className="setting-label">
                      Codex Display Mode
                      <small>Choose how Codex tool output appears</small>
                    </label>
                    <CustomSelect
                      value={(localSettings.agents?.codex?.displayMode as any) || 'clean'}
                      onChange={(value) => setLocalSettings({
                        ...localSettings,
                        agents: {
                          ...(localSettings.agents || {}),
                          codex: { ...(localSettings.agents?.codex || {}), displayMode: value as any }
                        }
                      })}
                      options={[
                        { value: 'clean', label: 'Clean (no tool tiles)' },
                        { value: 'compact', label: 'Compact tools (single summary tile)' },
                        { value: 'verbose', label: 'Verbose tools (individual tiles)' },
                      ]}
                    />
                  </div>
                  <ToggleSwitch
                    label="Show Codex reasoning"
                    description="Display Codex thinking text before the answer"
                    value={(localSettings.agents?.codex?.showReasoning) !== false}
                    onChange={(v) => setLocalSettings({
                      ...localSettings,
                      agents: {
                        ...(localSettings.agents || {}),
                        codex: { ...(localSettings.agents?.codex || {}), showReasoning: v }
                      }
                    })}
                  />
                </div>
              </div>
              
              <div className="settings-divider" />
              
              {/* Default Model Selection */}
              <div className="settings-group">
                <h4>Default Model</h4>
                <p className="settings-description">Choose the default AI model for new conversations</p>
                <div className="setting-item-row">
                  <ModelSelector
                    value={(localSettings as any).defaultModel || ''}
                    onChange={(value) => updateLocal('defaultModel' as any, value)}
                  />
                </div>
              </div>
              
              {/* Claude API Configuration */}
              <div className="settings-group">
                <h4>Claude Configuration</h4>
                <p className="settings-description">Configure your primary Claude API settings</p>
                
                <div className="setting-item">
                  <CustomInput
                    label="API Key"
                    type="password"
                    value={(localSettings as any).apiKey || ''}
                    onChange={(value) => updateLocal('apiKey' as any, value)}
                    placeholder="Enter Claude API key"
                  />
                </div>
                
                <div className="setting-item">
                  <CustomInput
                    label="Custom API Endpoint"
                    value={(localSettings as any).apiEndpoint || ''}
                    onChange={(value) => updateLocal('apiEndpoint' as any, value)}
                    placeholder="Default: api.anthropic.com"
                    description="Leave empty to use default endpoint"
                  />
                </div>
              </div>
              
              {/* User Interface Settings */}
              <div className="settings-group">
                <h4>User Interface</h4>
                <p className="settings-description">Customize the appearance of the application</p>
                
                <div className="setting-item-row">
                  <div className="setting-field">
                    <label className="setting-label">
                      Theme
                      <small>Application color scheme</small>
                    </label>
                    <CustomSelect
                      value={localSettings.theme || 'system'}
                      onChange={(value) => updateLocal('theme', value)}
                      options={[
                        { value: 'system', label: 'System' },
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' }
                      ]}
                    />
                  </div>
                  
                  <div className="setting-field">
                    <label className="setting-label">
                      Font Size
                      <small>Editor and terminal font size</small>
                    </label>
                    <CustomSelect
                      value={(localSettings as any).fontSize || 'medium'}
                      onChange={(value) => updateLocal('fontSize' as any, value)}
                      options={[
                        { value: 'small', label: 'Small (12px)' },
                        { value: 'medium', label: 'Medium (14px)' },
                        { value: 'large', label: 'Large (16px)' }
                      ]}
                    />
                  </div>
                </div>
                <div className="setting-item-row">
                  <ToggleSwitch
                    label="Verbose logs"
                    description="Show detailed logs in UI"
                    value={localSettings.verbose === true}
                    onChange={(value) => updateLocal('verbose' as any, value)}
                  />
                </div>
              </div>

              {/* Common Agent Behavior */}
              <div className="settings-group">
                <h4>Agent Behavior</h4>
                <div className="setting-item-row">
                  <ToggleSwitch
                    label="Enable MCP"
                    description="Allow use of Model Context Protocol servers"
                    value={localSettings.mcpEnabled !== false}
                    onChange={(v) => updateLocal('mcpEnabled' as any, v)}
                  />
                  <ToggleSwitch
                    label="Enable Web Search"
                    description="Allow models to use grounding/web search"
                    value={localSettings.webSearchEnabled === true}
                    onChange={(v) => updateLocal('webSearchEnabled' as any, v)}
                  />
                </div>
                <div className="setting-item-row">
                  <div className="setting-field" style={{ flex: 1 }}>
                    <label className="setting-label">Include Directories
                      <small>Comma-separated paths to include in context</small>
                    </label>
                    <CustomInput
                      value={(localSettings.includeDirs || []).join(', ')}
                      onChange={(val) => {
                        const str = String(val)
                        const dirs = str.split(',').map((seg: string) => seg.trim()).filter((seg: string) => !!seg)
                        updateLocal('includeDirs' as any, dirs)
                      }}
                      placeholder="src, docs, packages/*"
                    />
                  </div>
                  <div className="setting-field" style={{ width: 260 }}>
                    <label className="setting-label">Autonomy
                      <small>Degree of proactive actions</small>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={localSettings.autonomy ?? 50}
                      onChange={(e) => updateLocal('autonomy' as any, parseInt(e.target.value))}
                    />
                  </div>
                </div>
              </div>

            </div>
          )}
          
          {activeTab === 'agents' && (
            <div className="settings-panel">
              <SubAgentsConfig
                agents={(localSettings as any).subAgents || []}
                onChange={(agents) => updateLocal('subAgents' as any, agents)}
              />
            </div>
          )}
          
          {activeTab === 'mcp' && (
            <div className="settings-panel">
              <MCPServerConfig
                servers={localSettings.mcpServers || {}}
                onChange={(servers) => updateLocal('mcpServers', servers)}
              />
            </div>
          )}
          
          {activeTab === 'permissions' && (
            <div className="settings-panel">
              <h3>Permissions & Safety</h3>
              
              <div className="settings-group">
                <h4>File System Access</h4>
                <div className="setting-item">
                  <ToggleSwitch
                    label="Allow file writes"
                    description="Enable Claude to create and modify files"
                    value={(localSettings as any).allowFileWrites !== false}
                    onChange={(value) => updateLocal('allowFileWrites' as any, value)}
                  />
                </div>
                
                <div className="setting-item">
                  <ToggleSwitch
                    label="Allow file deletion"
                    description="Enable Claude to delete files (requires confirmation)"
                    value={(localSettings as any).allowFileDeletion === true}
                    onChange={(value) => updateLocal('allowFileDeletion' as any, value)}
                  />
                </div>
                
                <div className="setting-item-full">
                  <CustomTextArea
                    label="Protected Paths"
                    value={((localSettings as any).protectedPaths || []).join('\n')}
                    onChange={(value) => updateLocal('protectedPaths' as any, value.split('\n').filter(Boolean))}
                    placeholder="/etc&#10;/System&#10;~/.ssh"
                    description="Paths that Claude cannot modify (one per line)"
                    rows={4}
                  />
                </div>
              </div>
              
              <div className="settings-group">
                <h4>Command Execution</h4>
                <div className="setting-item">
                  <ToggleSwitch
                    label="Allow command execution"
                    description="Enable Claude to run terminal commands"
                    value={(localSettings as any).allowCommandExecution !== false}
                    onChange={(value) => updateLocal('allowCommandExecution' as any, value)}
                  />
                </div>
                
                <div className="setting-item">
                  <ToggleSwitch
                    label="Require command confirmation"
                    description="Ask before running potentially dangerous commands"
                    value={(localSettings as any).requireCommandConfirmation === true}
                    onChange={(value) => updateLocal('requireCommandConfirmation' as any, value)}
                  />
                </div>
                
                <div className="setting-item-full">
                  <CustomTextArea
                    label="Blocked Commands"
                    value={((localSettings as any).blockedCommands || []).join('\n')}
                    onChange={(value) => updateLocal('blockedCommands' as any, value.split('\n').filter(Boolean))}
                    placeholder="rm -rf&#10;sudo&#10;chmod 777"
                    description="Commands that Claude cannot execute (one per line)"
                    rows={4}
                  />
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'advanced' && (
            <div className="settings-panel">
              <h3>Advanced Settings</h3>
              
              <div className="settings-group">
                <h4>Performance</h4>
                <div className="setting-item">
                  <CustomInput
                    label="Max Tokens"
                    type="number"
                    value={String((localSettings as any).maxTokens || 4096)}
                    onChange={(value) => updateLocal('maxTokens' as any, parseInt(String(value)) || 4096)}
                    description="Maximum tokens per response"
                  />
                </div>
                
                <div className="setting-item">
                  <CustomInput
                    label="Temperature"
                    type="number"
                    value={String((localSettings as any).temperature || 0.7)}
                    onChange={(value) => updateLocal('temperature' as any, parseFloat(String(value)) || 0.7)}
                    description="Response randomness (0-1)"
                  />
                </div>
                
                <div className="setting-item">
                  <ToggleSwitch
                    label="Stream responses"
                    description="Show Claude's responses as they're generated"
                    value={(localSettings as any).streamResponses !== false}
                    onChange={(value) => updateLocal('streamResponses' as any, value)}
                  />
                </div>
              </div>
              
              <div className="settings-group">
                <h4>User Experience</h4>
                <div className="setting-item">
                  <ToggleSwitch
                    label="Has completed onboarding"
                    description="Skip the welcome tutorial"
                    value={localSettings.hasCompletedOnboarding === true}
                    onChange={(value) => updateLocal('hasCompletedOnboarding', value)}
                  />
                </div>
                
                <div className="setting-item">
                  <ToggleSwitch
                    label="Use Shift+Enter for new line"
                    description="Enter sends message, Shift+Enter adds line break"
                    value={localSettings.shiftEnterKeyBinding === true}
                    onChange={(value) => updateLocal('shiftEnterKeyBinding', value)}
                  />
                </div>

                
                <div className="setting-item">
                  <label className="setting-label">
                    Notification Channel
                    <small>How to receive notifications</small>
                  </label>
                  <CustomSelect
                    value={localSettings.preferredNotifChannel || 'browser'}
                    onChange={(value) => updateLocal('preferredNotifChannel', value)}
                    options={[
                      { value: 'browser', label: 'Browser Notifications' },
                      { value: 'sound', label: 'Sound Only' },
                      { value: 'none', label: 'None' }
                    ]}
                  />
                </div>
              </div>
              
              <div className="settings-group">
                <h4>Environment</h4>
                <div className="setting-item-full">
                  <CustomTextArea
                    label="Environment Variables"
                    value={JSON.stringify(localSettings.env || {}, null, 2)}
                    onChange={(value) => {
                      try {
                        const env = JSON.parse(value)
                        updateLocal('env', env)
                      } catch { /* Invalid JSON */ }
                    }}
                    placeholder='{"NODE_ENV": "development"}'
                    rows={6}
                  />
                </div>
              </div>
              
              <div className="settings-group">
                <h4>Developer</h4>
                <div className="setting-item">
                  <ToggleSwitch
                    label="Debug mode"
                    description="Show detailed logs and debugging information"
                    value={(localSettings as any).debugMode === true}
                    onChange={(value) => updateLocal('debugMode' as any, value)}
                  />
                </div>
                
                <div className="setting-item">
                  <ToggleSwitch
                    label="Telemetry"
                    description="Share anonymous usage data to improve Claude"
                    value={(localSettings as any).telemetry !== false}
                    onChange={(value) => updateLocal('telemetry' as any, value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Dropdown replaces modal; no overlay here */}
      </div>
  )
}

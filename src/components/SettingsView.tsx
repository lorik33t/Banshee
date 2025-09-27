import { useCallback, useEffect, useMemo, useState } from 'react'
import { Save, X } from 'lucide-react'
import { useSettings } from '../state/settings'

type ActiveTab = 'general' | 'integrations' | 'subagents' | 'advanced'

type EnvPair = { id: string; key: string; value: string }

type DraftServer = {
  command: string
  argsText: string
  type: string
  envPairs: EnvPair[]
}

const GENERAL_SETTINGS = [
  { key: 'includeCoAuthoredBy', label: 'Include Co-authored-by trailer' },
  { key: 'verbose', label: 'Enable verbose logging' },
  { key: 'backgroundExecution', label: 'Allow background execution' },
  { key: 'webSearchEnabled', label: 'Enable web search tools' }
] as const

const STREAMING_SPEED_OPTIONS = ['slow', 'normal', 'fast'] as const
const TRANSPORT_OPTIONS = ['stdio', 'sse', 'http'] as const

type McpTemplate = {
  id: string
  title: string
  description: string
  command: string
  args?: string
  type?: string
  env?: Record<string, string>
}

const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: 'filesystem',
    title: 'Filesystem inspector',
    description: 'Browse and read files via the open-source filesystem MCP server.',
    command: 'npx',
    args: '@modelcontextprotocol/server-filesystem',
    type: 'stdio'
  },
  {
    id: 'shell',
    title: 'Shell bridge',
    description: 'Expose a curated set of shell commands through the shell MCP server.',
    command: 'npx',
    args: '@modelcontextprotocol/server-shell --whitelist ./scripts',
    type: 'stdio'
  },
  {
    id: 'http-proxy',
    title: 'HTTP proxy',
    description: 'Forward MCP requests to a remote HTTPS endpoint.',
    command: 'codex',
    args: 'mcp http --url https://example.com/mcp',
    type: 'http',
    env: { API_KEY: 'replace-with-api-key' }
  }
]

const createEnvPairs = (env?: Record<string, string>): EnvPair[] => {
  const pairs = env
    ? Object.entries(env).map(([key, value], index) => ({ id: `${Date.now()}-${index}`, key, value }))
    : []
  if (!pairs.length || pairs[pairs.length - 1].key || pairs[pairs.length - 1].value) {
    pairs.push({ id: `${Date.now()}-${Math.random()}`, key: '', value: '' })
  }
  return pairs
}

const ensureTrailingBlank = (pairs: EnvPair[]) => {
  if (!pairs.length || pairs[pairs.length - 1].key || pairs[pairs.length - 1].value) {
    return [...pairs, { id: `${Date.now()}-${Math.random()}`, key: '', value: '' }]
  }
  return pairs
}

const envPairsToObject = (pairs: EnvPair[]) => {
  const entries = pairs
    .filter(({ key }) => key.trim().length)
    .map(({ key, value }) => [key.trim(), value])
  return entries.length ? Object.fromEntries(entries) : undefined
}

const initialNewServer = () => ({
  name: '',
  command: '',
  args: '',
  type: 'stdio',
  envPairs: createEnvPairs()
})

export function SettingsView() {
  const isOpen = useSettings((s) => s.isOpen)
  const settings = useSettings((s) => s.settings)
  const isLoading = useSettings((s) => s.isLoading)
  const error = useSettings((s) => s.error)
  const closeSettings = useSettings((s) => s.closeSettings)
  const loadSettings = useSettings((s) => s.loadSettings)
  const saveSettings = useSettings((s) => s.saveSettings)
  const updateSetting = useSettings((s) => s.updateSetting)

  const [hasSaved, setHasSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('general')
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [draftServer, setDraftServer] = useState<DraftServer | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [newServer, setNewServer] = useState(initialNewServer)
  const [newServerError, setNewServerError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSettings().catch(() => {})
      setHasSaved(false)
      setActiveTab('general')
      setEditingServerId(null)
      setDraftServer(null)
      setNewServer(initialNewServer())
    }
  }, [isOpen, loadSettings])

  const handleSave = async () => {
    await saveSettings(settings)
    setHasSaved(true)
  }

  const handleUpdateSetting = useCallback(
    (key: keyof typeof settings, value: any) => {
      setHasSaved(false)
      updateSetting(key as any, value)
    },
    [updateSetting]
  )

  const mcpServers = settings.mcpServers ?? {}
  const streamingSpeed = settings.streamingSpeed ?? 'normal'
  const autonomy = settings.autonomy ?? 50

  const startEditingServer = (name: string) => {
    const server = mcpServers[name] ?? { command: '', args: [], env: undefined, type: 'stdio' }
    setEditingServerId(name)
    setDraftServer({
      command: server.command ?? '',
      argsText: Array.isArray(server.args) ? server.args.join(' ') : '',
      type: server.type ?? 'stdio',
      envPairs: createEnvPairs(server.env)
    })
    setDraftError(null)
    setHasSaved(false)
  }

  const cancelEditingServer = () => {
    setEditingServerId(null)
    setDraftServer(null)
    setDraftError(null)
  }

  const handleRemoveServer = (name: string) => {
    const next = { ...mcpServers }
    delete next[name]
    handleUpdateSetting('mcpServers', next as any)
    if (editingServerId === name) {
      cancelEditingServer()
    }
  }

  const updateDraftEnv = (transform: (pairs: EnvPair[]) => EnvPair[]) => {
    setDraftServer((prev) => (prev ? { ...prev, envPairs: ensureTrailingBlank(transform(prev.envPairs)) } : prev))
    setDraftError(null)
    setHasSaved(false)
  }

  const updateNewEnv = (transform: (pairs: EnvPair[]) => EnvPair[]) => {
    setNewServer((prev) => ({ ...prev, envPairs: ensureTrailingBlank(transform(prev.envPairs)) }))
    setNewServerError(null)
    setHasSaved(false)
  }

  const handleSaveServer = () => {
    if (!editingServerId || !draftServer) return
    if (!draftServer.command.trim()) {
      setDraftError('Command is required')
      return
    }
    try {
      const args = draftServer.argsText.trim().length ? draftServer.argsText.trim().split(/\s+/) : []
      const env = envPairsToObject(draftServer.envPairs)
      const type = TRANSPORT_OPTIONS.includes(draftServer.type as any) ? draftServer.type : 'stdio'
      const next = {
        ...mcpServers,
        [editingServerId]: {
          command: draftServer.command.trim(),
          args,
          env,
          type
        }
      }
      handleUpdateSetting('mcpServers', next as any)
      cancelEditingServer()
    } catch (err) {
      setDraftError(`Failed to save server: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const makeUniqueName = (baseName: string) => {
    let unique = baseName
    let counter = 1
    while (mcpServers[unique]) {
      unique = `${baseName}-${counter++}`
    }
    return unique
  }

  const handleTemplateApply = (template: McpTemplate) => {
    const baseName = template.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server'
    const name = makeUniqueName(baseName)
    setActiveTab('integrations')
    setNewServer({
      name,
      command: template.command,
      args: template.args ?? '',
      type: template.type ?? 'stdio',
      envPairs: createEnvPairs(template.env)
    })
    setNewServerError(null)
    setHasSaved(false)
  }

  const handleAddServer = () => {
    if (!newServer.name.trim()) {
      setNewServerError('Name is required')
      return
    }
    if (mcpServers[newServer.name.trim()]) {
      setNewServerError('Server name must be unique')
      return
    }
    if (!newServer.command.trim()) {
      setNewServerError('Command is required')
      return
    }
    try {
      const args = newServer.args.trim().length ? newServer.args.trim().split(/\s+/) : []
      const env = envPairsToObject(newServer.envPairs)
      const type = TRANSPORT_OPTIONS.includes(newServer.type as any) ? newServer.type : 'stdio'
      const next = {
        ...mcpServers,
        [newServer.name.trim()]: {
          command: newServer.command.trim(),
          args,
          env,
          type
        }
      }
      handleUpdateSetting('mcpServers', next as any)
      setNewServer(initialNewServer())
      setNewServerError(null)
    } catch (err) {
      setNewServerError(`Invalid environment configuration: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const renderEnvEditor = (
    pairs: EnvPair[],
    onChange: (next: EnvPair[]) => void
  ) => (
    <div className="mcp-env-editor">
      {pairs.map((pair) => (
        <div key={pair.id} className="mcp-env-row">
          <input
            className="mcp-env-key-input"
            value={pair.key}
            placeholder="ENV_KEY"
            onChange={(event) => onChange(pairs.map((p) => (p.id === pair.id ? { ...p, key: event.target.value } : p)))}
          />
          <input
            className="mcp-env-value-input"
            value={pair.value}
            placeholder="value"
            onChange={(event) => onChange(pairs.map((p) => (p.id === pair.id ? { ...p, value: event.target.value } : p)))}
          />
          <button
            type="button"
            className="settings-btn-icon remove"
            onClick={() => onChange(pairs.filter((p) => p.id !== pair.id))}
            aria-label="Remove environment variable"
          />
        </div>
      ))}
    </div>
  )

  const renderGeneralTab = () => (
    <div className="settings-panel general-settings">
      <section>
        <h3>General</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>Customize how Codex behaves in the CLI and desktop app.</p>

        <div className="settings-grid">
          {GENERAL_SETTINGS.map(({ key, label }) => {
            const value = (settings as any)[key]
            return (
              <label key={key} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => handleUpdateSetting(key as any, event.target.checked as any)}
                />
                <span>{label}</span>
              </label>
            )
          })}
        </div>
      </section>

      <hr className="settings-divider" />

      <section>
        <h4>Streaming speed</h4>
        <div className="settings-pill-row">
          {STREAMING_SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              className={`settings-pill ${streamingSpeed === option ? 'selected' : ''}`}
              onClick={() => handleUpdateSetting('streamingSpeed', option)}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h4>Autonomy</h4>
        <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>Controls how aggressive Codex is with multi-step planning and unattended execution.</p>
        <input
          type="range"
          min={0}
          max={100}
          value={autonomy}
          onChange={(event) => handleUpdateSetting('autonomy', Number(event.target.value))}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Current: {autonomy}</div>
      </section>

      <hr className="settings-divider" />

      <section>
        <h4>Agents</h4>
        <div className="agents-grid">
          {(['gemini', 'qwen', 'codex'] as const).map((agentKey) => {
            const agentSettings = settings.agents?.[agentKey] ?? {}
            return (
              <label key={agentKey} className="agent-inline">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ textTransform: 'capitalize' }}>{agentKey}</strong>
                  <input
                    type="checkbox"
                    checked={Boolean(agentSettings.enabled)}
                    onChange={(event) => {
                      const next = {
                        ...(settings.agents || {}),
                        [agentKey]: { ...agentSettings, enabled: event.target.checked }
                      }
                      handleUpdateSetting('agents', next as any)
                    }}
                  />
                </div>
                <p style={{ fontSize: 12, marginTop: 8, color: 'var(--text-secondary)' }}>
                  {agentKey === 'codex'
                    ? 'Desktop Codex CLI integration'
                    : agentKey === 'gemini'
                      ? 'Large context sweeps'
                      : 'Bulk automation and repository ops'}
                </p>
              </label>
            )
          })}
        </div>
      </section>
    </div>
  )

  const renderIntegrationsTab = () => (
    <div className="settings-panel">
      <section className="mcp-config">
        <div className="mcp-header">
          <div className="mcp-title">
            <h4>Model Context Protocol (MCP)</h4>
            <span className="mcp-count">{Object.keys(mcpServers).length} configured</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            MCP servers let Codex call out to local or remote tools during a run.
          </p>
        </div>

        <div className="mcp-templates-grid">
          {MCP_TEMPLATES.map((template) => (
            <button key={template.id} className="mcp-template-card" type="button" onClick={() => handleTemplateApply(template)}>
              <div className="mcp-template-icon">⚙️</div>
              <div className="mcp-template-content">
                <h5>{template.title}</h5>
                <p>{template.description}</p>
              </div>
            </button>
          ))}
        </div>

        {Object.keys(mcpServers).length === 0 ? (
          <div className="mcp-empty-state">
            <h5>No MCP servers configured</h5>
            <p>Add a server below or start with one of the templates to connect Codex to external tools.</p>
          </div>
        ) : (
          <div className="mcp-servers-list">
            {Object.entries(mcpServers).map(([name, server]) => (
              <div key={name} className={`mcp-server-card ${editingServerId === name ? 'editing' : ''}`}>
                {editingServerId === name && draftServer ? (
                  <div className="mcp-server-edit-body">
                    <div className="mcp-field">
                      <label>Command</label>
                      <div className="mcp-input-group">
                        <input
                          value={draftServer.command}
                          onChange={(event) => {
                            setDraftServer((prev) => (prev ? { ...prev, command: event.target.value } : prev))
                            setDraftError(null)
                            setHasSaved(false)
                          }}
                          placeholder="/usr/local/bin/server"
                        />
                      </div>
                    </div>
                    <div className="mcp-field">
                      <label>Arguments</label>
                      <div className="mcp-input-group">
                        <input
                          value={draftServer.argsText}
                          onChange={(event) => {
                            setDraftServer((prev) => (prev ? { ...prev, argsText: event.target.value } : prev))
                            setDraftError(null)
                            setHasSaved(false)
                          }}
                          placeholder="--flag value"
                        />
                      </div>
                    </div>
                    <div className="mcp-field">
                      <label>Transport</label>
                      <div className="mcp-input-group">
                        <select
                          value={draftServer.type}
                          onChange={(event) => {
                            setDraftServer((prev) => (prev ? { ...prev, type: event.target.value } : prev))
                            setDraftError(null)
                            setHasSaved(false)
                          }}
                        >
                          {TRANSPORT_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="mcp-field">
                      <label>Environment variables</label>
                      {renderEnvEditor(draftServer.envPairs, (next) => updateDraftEnv(() => next))}
                    </div>
                    {draftError && <div className="settings-error">{draftError}</div>}
                    <div className="mcp-server-actions">
                      <button className="settings-btn secondary" onClick={cancelEditingServer}>Cancel</button>
                      <button className="settings-btn primary" onClick={handleSaveServer}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mcp-server-header">
                      <div className="mcp-server-info">
                        <h5>{name}</h5>
                        <div className="mcp-server-command">
                          <code>{server.command ?? ''} {(server.args ?? []).join(' ')}</code>
                        </div>
                      </div>
                      <div className="mcp-server-actions">
                        <button className="settings-btn secondary" onClick={() => startEditingServer(name)}>Edit</button>
                        <button className="settings-btn secondary" onClick={() => handleRemoveServer(name)}>Remove</button>
                      </div>
                    </div>
                    <div className={`mcp-server-status ${server.env ? 'configured' : 'needs-config'}`}>
                      {server.env ? 'Environment configured' : 'No environment variables'}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mcp-server-card editing">
          <div className="mcp-server-edit-body">
            <h5>Add new server</h5>
            <div className="mcp-field">
              <label>Name</label>
              <div className="mcp-input-group">
                <input
                  value={newServer.name}
                  onChange={(event) => {
                    setNewServer((prev) => ({ ...prev, name: event.target.value }))
                    setNewServerError(null)
                    setHasSaved(false)
                  }}
                  placeholder="my-mcp-server"
                />
              </div>
            </div>
            <div className="mcp-field">
              <label>Command</label>
              <div className="mcp-input-group">
                <input
                  value={newServer.command}
                  onChange={(event) => {
                    setNewServer((prev) => ({ ...prev, command: event.target.value }))
                    setNewServerError(null)
                    setHasSaved(false)
                  }}
                  placeholder="/usr/local/bin/server"
                />
              </div>
            </div>
            <div className="mcp-field">
              <label>Arguments</label>
              <div className="mcp-input-group">
                <input
                  value={newServer.args}
                  onChange={(event) => {
                    setNewServer((prev) => ({ ...prev, args: event.target.value }))
                    setNewServerError(null)
                    setHasSaved(false)
                  }}
                  placeholder="--port 8080"
                />
              </div>
            </div>
            <div className="mcp-field">
              <label>Transport</label>
              <div className="mcp-input-group">
                <select
                  value={newServer.type}
                  onChange={(event) => {
                    setNewServer((prev) => ({ ...prev, type: event.target.value }))
                    setHasSaved(false)
                  }}
                >
                  {TRANSPORT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mcp-field">
              <label>Environment variables</label>
              {renderEnvEditor(newServer.envPairs, (next) => updateNewEnv(() => next))}
            </div>
            {newServerError && <div className="settings-error">{newServerError}</div>}
            <div className="mcp-server-actions">
              <button className="settings-btn primary" onClick={handleAddServer}>Add Server</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )

  const renderPlaceholder = (title: string, copy: string) => (
    <div className="settings-panel">
      <div className="settings-placeholder">
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </div>
  )

  const renderContent = () => {
    switch (activeTab) {
      case 'integrations':
        return renderIntegrationsTab()
      case 'subagents':
        return renderPlaceholder('Sub-agents', 'Manage auxiliary agents and delegate tasks. Detailed configuration will arrive in a future release.')
      case 'advanced':
        return renderPlaceholder('Advanced', 'Fine-tune sandbox policies, approval rules, and automation behaviour. Coming soon.')
      case 'general':
      default:
        return renderGeneralTab()
    }
  }

  const statusMessage = useMemo(() => {
    if (isLoading) return 'Loading settings…'
    if (hasSaved) return 'Settings saved'
    if (error) return error
    return undefined
  }, [isLoading, hasSaved, error])

  if (!isOpen) return null

  return (
    <div className="settings-fullscreen">
      <header className="settings-header">
        <div className="settings-header-left">
          <button className="settings-back-btn" onClick={closeSettings} aria-label="Close settings">
            <X size={18} />
          </button>
          <h2>Settings</h2>
          {statusMessage && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{statusMessage}</span>}
        </div>
        <div className="settings-header-actions">
          <button className="settings-btn secondary" onClick={closeSettings}>Cancel</button>
          <button className="settings-btn primary" onClick={handleSave}>
            <Save size={16} style={{ marginRight: 6 }} /> Save Changes
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <button className={`settings-nav ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>
            General
          </button>
          <button className={`settings-nav ${activeTab === 'integrations' ? 'active' : ''}`} onClick={() => setActiveTab('integrations')}>
            Integrations
          </button>
          <button className={`settings-nav ${activeTab === 'subagents' ? 'active' : ''}`} onClick={() => setActiveTab('subagents')}>
            Sub-agents
          </button>
          <button className={`settings-nav ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>
            Advanced
          </button>
        </aside>

        <div className="settings-content">{renderContent()}</div>
      </div>
    </div>
  )
}

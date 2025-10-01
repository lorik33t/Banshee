import { useCallback, useEffect, useMemo, useState } from 'react'
import { Save, X } from 'lucide-react'
import { useSettings } from '../state/settings'
import type { ClaudeSettings, SandboxWorkspaceWriteConfig } from '../state/settings'
import {
  CODEX_MODELS,
  MODE_OPTIONS,
  DEFAULT_MODE_ID,
  type ModeOptionId,
  type ApprovalPolicyValue,
  type SandboxModeValue,
} from '../constants/codex'

type ActiveTab = 'general' | 'integrations' | 'subagents' | 'advanced'

type EnvPair = { id: string; key: string; value: string }

type DraftServer = {
  command: string
  argsText: string
  type: string
  envPairs: EnvPair[]
}

type SubAgentConfig = NonNullable<ClaudeSettings['subAgents']>[number]
type HookConfig = NonNullable<ClaudeSettings['hooks']>[number]
type GeneralToggleKey =
  | 'includeCoAuthoredBy'
  | 'verbose'
  | 'backgroundExecution'
  | 'webSearchEnabled'
  | 'mcpEnabled'
  | 'planningMode'

const GENERAL_SETTINGS: Array<{ key: GeneralToggleKey; label: string; description: string }> = [
  {
    key: 'includeCoAuthoredBy',
    label: 'Include co-authored-by trailer',
    description: 'Append a Git-style Co-authored-by signature to generated commits.'
  },
  {
    key: 'verbose',
    label: 'Enable verbose logging',
    description: 'Capture additional diagnostics from Codex runs in the terminal.'
  },
  {
    key: 'backgroundExecution',
    label: 'Allow background execution',
    description: 'Let Codex continue tasks when the window is unfocused.'
  },
  {
    key: 'webSearchEnabled',
    label: 'Enable web search tools',
    description: 'Expose the WebFetch/WebSearch MCP tools during a session.'
  },
  {
    key: 'mcpEnabled',
    label: 'Enable MCP tools',
    description: 'Mount configured Model Context Protocol servers by default.'
  },
  {
    key: 'planningMode',
    label: 'Enable planning mode',
    description: 'Have Codex draft a multi-step plan before executing commands.'
  }
]

const STREAMING_SPEED_OPTIONS = ['slow', 'normal', 'fast'] as const
const TRANSPORT_OPTIONS = ['stdio', 'sse', 'http'] as const
const APPROVAL_OPTIONS: Array<{ value: ApprovalPolicyValue; label: string; helper: string }> = [
  { value: 'untrusted', label: 'Trusted list', helper: 'Prompt unless the command matches your allow list.' },
  { value: 'on-request', label: 'On request', helper: 'Let Codex run freely until it asks to escalate.' },
  { value: 'on-failure', label: 'On failure', helper: 'Retry once in the sandbox, then ask before escalating.' },
  { value: 'never', label: 'Never prompt', helper: 'Codex runs with full trust; no approval dialogs.' },
]

const SANDBOX_OPTIONS: Array<{ value: SandboxModeValue; label: string; helper: string }> = [
  { value: 'read-only', label: 'Read-only', helper: 'Shell commands run in a readonly sandbox.' },
  { value: 'workspace-write', label: 'Workspace write', helper: 'Allow writes inside the workspace sandbox.' },
  { value: 'danger-full-access', label: 'Full access', helper: 'Disable sandboxing (dangerous outside trusted environments).' },
]

const MODE_DESCRIPTIONS: Record<ModeOptionId, string> = {
  'chat-plan': 'Drafts a plan first and requests approval along the way.',
  agent: 'Runs commands automatically but still prompts before escalation.',
  'agent-full': 'Hands-off automation with full sandbox bypass.',
}

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

const listToMultiline = (list?: string[]) => (list && list.length ? list.join('\n') : '')
const multilineToList = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, index, all) => line.length > 0 && all.indexOf(line) === index)

const isTransportOption = (value: string): value is (typeof TRANSPORT_OPTIONS)[number] =>
  TRANSPORT_OPTIONS.includes(value as (typeof TRANSPORT_OPTIONS)[number])

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
    try {
      await saveSettings(settings)
      setHasSaved(true)
      closeSettings()
    } catch (err) {
      console.error('Failed to save settings', err)
    }
  }

  const handleUpdateSetting = useCallback(
    <K extends keyof ClaudeSettings>(key: K, value: ClaudeSettings[K]) => {
      setHasSaved(false)
      updateSetting(key, value)
    },
    [updateSetting]
  )

  const mcpServers: NonNullable<ClaudeSettings['mcpServers']> = settings.mcpServers ?? {}
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
    const rest: NonNullable<ClaudeSettings['mcpServers']> = { ...mcpServers }
    delete rest[name]
    const remainingKeys = Object.keys(rest)
    handleUpdateSetting('mcpServers', remainingKeys.length ? rest : undefined)
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
      const type: (typeof TRANSPORT_OPTIONS)[number] = isTransportOption(draftServer.type) ? draftServer.type : 'stdio'
      const serverConfig: NonNullable<ClaudeSettings['mcpServers']>[string] = {
        command: draftServer.command.trim(),
        args,
        env,
        type
      }
      const next: NonNullable<ClaudeSettings['mcpServers']> = {
        ...mcpServers,
        [editingServerId]: serverConfig
      }
      handleUpdateSetting('mcpServers', next)
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
      const type: (typeof TRANSPORT_OPTIONS)[number] = isTransportOption(newServer.type) ? newServer.type : 'stdio'
      const serverConfig: NonNullable<ClaudeSettings['mcpServers']>[string] = {
        command: newServer.command.trim(),
        args,
        env,
        type
      }
      const next: NonNullable<ClaudeSettings['mcpServers']> = {
        ...mcpServers,
        [newServer.name.trim()]: serverConfig
      }
      handleUpdateSetting('mcpServers', next)
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

  const renderGeneralTab = () => {
    const permissionGroups = {
      allow: settings.permissions?.allow ?? [],
      ask: settings.permissions?.ask ?? [],
      deny: settings.permissions?.deny ?? []
    }
    const autoApproveValue = listToMultiline(settings.autoApprovePatterns)
    const themeSelection = settings.theme ?? 'system'
    const defaultModeId = settings.defaultModeId ?? DEFAULT_MODE_ID
    const currentMode = MODE_OPTIONS.find((opt) => opt.id === defaultModeId) ?? MODE_OPTIONS[0]
    const defaultModelId = settings.defaultModelId ?? CODEX_MODELS[0].id
    const approvalPolicy = settings.approvalPolicy ?? currentMode.approvalPolicy
    const sandboxMode = settings.sandboxMode ?? currentMode.sandboxMode
    const sandboxConfig: SandboxWorkspaceWriteConfig = {
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
      ...settings.sandboxWorkspaceWrite,
    }
    const fileOpener = settings.fileOpener ?? 'vscode'
    const historyPersistence = settings.historyPersistence ?? 'save-all'

    const handleDefaultModeChange = (modeId: ModeOptionId) => {
      handleUpdateSetting('defaultModeId', modeId)
      const option = MODE_OPTIONS.find((opt) => opt.id === modeId)
      if (option) {
        handleUpdateSetting('approvalPolicy', option.approvalPolicy)
        handleUpdateSetting('sandboxMode', option.sandboxMode)
      }
    }

    const handleApprovalChange = (value: ApprovalPolicyValue) => {
      handleUpdateSetting('approvalPolicy', value)
    }

    const handleSandboxChange = (value: SandboxModeValue) => {
      handleUpdateSetting('sandboxMode', value)
    }

    const updateSandboxConfig = (partial: Partial<SandboxWorkspaceWriteConfig>) => {
      handleUpdateSetting('sandboxWorkspaceWrite', { ...sandboxConfig, ...partial })
    }

    const updatePermissionsGroup = (group: 'allow' | 'ask' | 'deny', raw: string) => {
      const updated = multilineToList(raw)
      const nextValues: NonNullable<ClaudeSettings['permissions']> = {
        allow: group === 'allow' ? updated : permissionGroups.allow,
        ask: group === 'ask' ? updated : permissionGroups.ask,
        deny: group === 'deny' ? updated : permissionGroups.deny,
      }
      const totalEntries = (nextValues.allow?.length ?? 0) + (nextValues.ask?.length ?? 0) + (nextValues.deny?.length ?? 0)
      handleUpdateSetting('permissions', totalEntries === 0 ? undefined : nextValues)
    }

    return (
      <div className="settings-panel general-settings">
        <section>
          <h3>General</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
            Customize how Codex behaves in the CLI and desktop app.
          </p>

          <div className="settings-grid">
          {GENERAL_SETTINGS.map(({ key, label, description }) => {
            const value = settings[key]
            return (
              <label key={key} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => handleUpdateSetting(key, event.target.checked)}
                />
                <span>
                  <strong>{label}</strong>
                  {description && <small>{description}</small>}
                </span>
              </label>
            )
          })}
          </div>
        </section>

        <section className="settings-section">
          <h4>Appearance</h4>
          <div className="settings-card">
            <div className="settings-form-grid">
              <div className="settings-field">
                <label htmlFor="theme-select">Theme</label>
                <select
                  id="theme-select"
                  className="settings-select"
                  value={themeSelection}
                  onChange={(event) => handleUpdateSetting('theme', event.target.value as ClaudeSettings['theme'])}
                >
                  <option value="system">Follow system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
                <small>Selecting “Dark” forces the dark palette regardless of OS settings.</small>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h4>Execution defaults</h4>
          <div className="settings-card settings-card-stack">
            <div>
              <label className="settings-card-title">Default Codex mode</label>
              <p className="settings-card-subtitle">This determines auto-approval behavior, sandboxing, and context hints.</p>
              <div className="settings-pill-row">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={`settings-pill ${defaultModeId === option.id ? 'selected' : ''}`}
                    onClick={() => handleDefaultModeChange(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="settings-card-subtitle">{MODE_DESCRIPTIONS[currentMode.id]}</p>
            </div>

            <div className="settings-form-grid">
              <div className="settings-field">
                <label htmlFor="default-model-select">Default model</label>
                <select
                  id="default-model-select"
                  className="settings-select"
                  value={defaultModelId}
                  onChange={(event) => handleUpdateSetting('defaultModelId', event.target.value)}
                >
                  {CODEX_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="settings-card-title">Approval policy</label>
              <div className="settings-pill-row">
                {APPROVAL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`settings-pill ${approvalPolicy === option.value ? 'selected' : ''}`}
                    onClick={() => handleApprovalChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="settings-card-subtitle">
                {APPROVAL_OPTIONS.find((opt) => opt.value === approvalPolicy)?.helper}
              </p>
            </div>

            <div>
              <label className="settings-card-title">Sandbox mode</label>
              <div className="settings-pill-row">
                {SANDBOX_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`settings-pill ${sandboxMode === option.value ? 'selected' : ''}`}
                    onClick={() => handleSandboxChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="settings-card-subtitle">
                {SANDBOX_OPTIONS.find((opt) => opt.value === sandboxMode)?.helper}
              </p>

              {sandboxMode === 'workspace-write' && (
                <div className="settings-card settings-card-nested">
                  <div className="settings-field">
                    <label>Additional writable roots</label>
                    <textarea
                      className="settings-textarea"
                      placeholder="/tmp\n~/Downloads"
                      value={listToMultiline(sandboxConfig.writableRoots)}
                      onChange={(event) => updateSandboxConfig({ writableRoots: multilineToList(event.target.value) })}
                    />
                    <small>Each path is appended to the sandbox writable list.</small>
                  </div>
                  <label className="settings-toggle settings-toggle-rich">
                    <input
                      type="checkbox"
                      checked={Boolean(sandboxConfig.networkAccess)}
                      onChange={(event) => updateSandboxConfig({ networkAccess: event.target.checked })}
                    />
                    <span>
                      <strong>Allow network access</strong>
                      <small>Let Codex perform outbound network requests while sandboxed.</small>
                    </span>
                  </label>
                  <label className="settings-toggle settings-toggle-rich">
                    <input
                      type="checkbox"
                      checked={Boolean(sandboxConfig.excludeTmpdirEnvVar)}
                      onChange={(event) => updateSandboxConfig({ excludeTmpdirEnvVar: event.target.checked })}
                    />
                    <span>
                      <strong>Exclude $TMPDIR</strong>
                      <small>Prevent the mapped temporary directory from being writable.</small>
                    </span>
                  </label>
                  <label className="settings-toggle settings-toggle-rich">
                    <input
                      type="checkbox"
                      checked={Boolean(sandboxConfig.excludeSlashTmp)}
                      onChange={(event) => updateSandboxConfig({ excludeSlashTmp: event.target.checked })}
                    />
                    <span>
                      <strong>Exclude /tmp</strong>
                      <small>Ensure /tmp stays readonly even in workspace-write mode.</small>
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h4>Automation & safety</h4>
          <div className="settings-card settings-card-stack">
            <label className="settings-toggle settings-toggle-rich">
              <input
                type="checkbox"
                checked={Boolean(settings.autoApprove)}
                onChange={(event) => handleUpdateSetting('autoApprove', event.target.checked)}
              />
              <span>
                <strong>Auto-approve trusted commands</strong>
                <small>Skip manual approval when a command matches the patterns below.</small>
              </span>
            </label>

            <div className="settings-field">
              <label htmlFor="auto-approve-patterns">Auto-approve patterns</label>
              <textarea
                id="auto-approve-patterns"
                className="settings-textarea"
                placeholder="npm install\ngo test ./..."
                value={autoApproveValue}
                onChange={(event) => handleUpdateSetting('autoApprovePatterns', multilineToList(event.target.value))}
              />
              <small>One command or glob per line.</small>
            </div>
          </div>

          <div className="settings-card">
            <h5 className="settings-card-title">Command permissions</h5>
            <p className="settings-card-subtitle">Fine-tune when Codex can run a command without asking.</p>
            <div className="settings-permissions-grid">
              {(['allow', 'ask', 'deny'] as const).map((group) => (
                <div key={group} className="settings-permission-card">
                  <div>
                    <h5>
                      {group === 'allow'
                        ? 'Always allow'
                        : group === 'ask'
                          ? 'Ask every time'
                          : 'Always deny'}
                    </h5>
                    <small>One command glob per line.</small>
                  </div>
                  <textarea
                    className="settings-textarea"
                    value={listToMultiline(permissionGroups[group])}
                    onChange={(event) => updatePermissionsGroup(group, event.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h4>Streaming speed</h4>
          <div className="settings-card">
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
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h4>Autonomy</h4>
          <div className="settings-card settings-card-stack">
            <p className="settings-card-subtitle">
              Controls how aggressive Codex is with multi-step planning and unattended execution.
            </p>
            <input
              type="range"
              className="settings-range"
              min={0}
              max={100}
              value={autonomy}
              onChange={(event) => handleUpdateSetting('autonomy', Number(event.target.value))}
            />
            <div className="settings-range-value">Current: {autonomy}</div>
          </div>
        </section>

        <section className="settings-section">
          <h4>Desktop integration</h4>
          <div className="settings-card settings-card-stack">
            <div className="settings-field">
              <label htmlFor="file-opener">File opener</label>
              <select
                id="file-opener"
                className="settings-select"
                value={fileOpener}
                onChange={(event) => handleUpdateSetting('fileOpener', event.target.value as ClaudeSettings['fileOpener'])}
              >
                <option value="vscode">VS Code</option>
                <option value="vscode-insiders">VS Code Insiders</option>
                <option value="windsurf">Windsurf</option>
                <option value="cursor">Cursor</option>
                <option value="none">None</option>
              </select>
            </div>

            <div className="settings-field">
              <label htmlFor="history-select">Session history</label>
              <select
                id="history-select"
                className="settings-select"
                value={historyPersistence}
                onChange={(event) => handleUpdateSetting('historyPersistence', event.target.value as ClaudeSettings['historyPersistence'])}
              >
                <option value="save-all">Persist all history</option>
                <option value="none">Do not persist</option>
              </select>
              <small>Controls whether Codex stores conversation history between launches.</small>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h4>Agents</h4>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Agent configuration is now managed via <code>settings.json</code>. Edit that file directly to update integrations.
          </p>
        </section>
      </div>
    )
  }

  const renderIntegrationsTab = () => {
    const envEntries = [...Object.entries(settings.env ?? {}), ['', '']]
    const lspEntries = [...Object.entries(settings.lspServers ?? {}), ['', '']]

    const commitEnvEntries = (entries: Array<[string, string]>) => {
      const sanitized = entries
        .map(([key, value]) => [key.trim(), value] as [string, string])
        .filter(([key, value]) => key.length > 0 || value.length > 0)
        .reduce((acc, [key, value]) => {
          if (key.length > 0) acc[key] = value
          return acc
        }, {} as Record<string, string>)
      handleUpdateSetting('env', Object.keys(sanitized).length ? sanitized : undefined)
    }

    const commitLspEntries = (entries: Array<[string, string]>) => {
      const sanitized = entries
        .map(([lang, cmd]) => [lang.trim(), cmd.trim()] as [string, string])
        .filter(([lang, cmd]) => lang.length > 0 && cmd.length > 0)
        .reduce((acc, [lang, cmd]) => {
          acc[lang] = cmd
          return acc
        }, {} as Record<string, string>)
      handleUpdateSetting('lspServers', Object.keys(sanitized).length ? sanitized : undefined)
    }

    const updateEnvEntry = (index: number, field: 'key' | 'value', raw: string) => {
      const next = envEntries.map(([key, value], idx) =>
        idx === index ? (field === 'key' ? [raw, value] : [key, raw]) : [key, value]
      ) as Array<[string, string]>
      commitEnvEntries(next)
    }

    const removeEnvEntry = (index: number) => {
      if (index >= envEntries.length - 1) return
      const next = envEntries.filter((_, idx) => idx !== index) as Array<[string, string]>
      commitEnvEntries(next)
    }

    const updateLspEntry = (index: number, field: 'key' | 'value', raw: string) => {
      const next = lspEntries.map(([key, value], idx) =>
        idx === index ? (field === 'key' ? [raw, value] : [key, raw]) : [key, value]
      ) as Array<[string, string]>
      commitLspEntries(next)
    }

    const removeLspEntry = (index: number) => {
      if (index >= lspEntries.length - 1) return
      const next = lspEntries.filter((_, idx) => idx !== index) as Array<[string, string]>
      commitLspEntries(next)
    }

    return (
      <div className="settings-panel">
        <section className="settings-section">
          <h4>Models & API</h4>
          <div className="settings-form-grid">
            <div className="settings-field">
              <label htmlFor="model-override">Primary model override</label>
              <input
                id="model-override"
                className="settings-input"
                placeholder="gpt-5-codex"
                value={settings.model ?? ''}
                onChange={(event) => handleUpdateSetting('model', event.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="default-model">Default model</label>
              <input
                id="default-model"
                className="settings-input"
                placeholder="gpt-5-codex"
                value={settings.defaultModel ?? ''}
                onChange={(event) => handleUpdateSetting('defaultModel', event.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="api-endpoint">Custom API endpoint</label>
              <input
                id="api-endpoint"
                className="settings-input"
                placeholder="https://api.openai.com/v1"
                value={settings.apiEndpoint ?? ''}
                onChange={(event) => handleUpdateSetting('apiEndpoint', event.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="api-key">API key</label>
              <input
                id="api-key"
                className="settings-input"
                type="password"
                placeholder="sk-..."
                value={settings.apiKey ?? ''}
                onChange={(event) => handleUpdateSetting('apiKey', event.target.value)}
              />
            </div>
          </div>
          <div className="settings-field" style={{ marginTop: 16 }}>
            <label htmlFor="api-key-helper">API key helper text</label>
            <textarea
              id="api-key-helper"
              className="settings-textarea"
              placeholder="Shown when prompting for an API key in the CLI."
              value={settings.apiKeyHelper ?? ''}
              onChange={(event) => handleUpdateSetting('apiKeyHelper', event.target.value)}
            />
          </div>
        </section>

        <section className="settings-section">
          <h4>Global environment variables</h4>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            These variables are passed to every Codex run in addition to your shell environment.
          </p>
          <div className="settings-kv-list">
            {envEntries.map(([key, value], index) => {
              const isTrailing = index === envEntries.length - 1
              return (
                <div key={`env-${index}-${key}`} className="settings-kv-row">
                  <input
                    className="settings-input settings-kv-key"
                    placeholder="ENV_VAR"
                    value={key}
                    onChange={(event) => updateEnvEntry(index, 'key', event.target.value)}
                  />
                  <input
                    className="settings-input settings-kv-value"
                    placeholder="value"
                    value={value}
                    onChange={(event) => updateEnvEntry(index, 'value', event.target.value)}
                  />
                  {!isTrailing && (
                    <button
                      type="button"
                      className="settings-btn-icon remove"
                      onClick={() => removeEnvEntry(index)}
                      aria-label="Remove environment variable"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="settings-section">
          <h4>Language servers</h4>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            Configure language server commands for inline diagnostics in the editor.
          </p>
          <div className="settings-kv-list">
            {lspEntries.map(([language, command], index) => {
              const isTrailing = index === lspEntries.length - 1
              return (
                <div key={`lsp-${index}-${language}`} className="settings-kv-row">
                  <input
                    className="settings-input settings-kv-key"
                    placeholder="typescript"
                    value={language}
                    onChange={(event) => updateLspEntry(index, 'key', event.target.value)}
                  />
                  <input
                    className="settings-input settings-kv-value"
                    placeholder="node ./scripts/tsserver.js"
                    value={command}
                    onChange={(event) => updateLspEntry(index, 'value', event.target.value)}
                  />
                  {!isTrailing && (
                    <button
                      type="button"
                      className="settings-btn-icon remove"
                      onClick={() => removeLspEntry(index)}
                      aria-label="Remove language server"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

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
  }


  const renderSubagentsTab = () => {
    const subAgents: SubAgentConfig[] = settings.subAgents ?? []

    const updateSubAgent = (index: number, partial: Partial<SubAgentConfig>) => {
      const next = subAgents.map((agent, idx) => (idx === index ? { ...agent, ...partial } : agent))
      handleUpdateSetting('subAgents', next)
    }

    const updateTools = (index: number, raw: string) => {
      updateSubAgent(index, { tools: multilineToList(raw) })
    }

    const removeSubAgent = (index: number) => {
      const next = subAgents.filter((_, idx) => idx !== index)
      handleUpdateSetting('subAgents', next.length ? next : undefined)
    }

    const addSubAgent = () => {
      const next = [
        ...subAgents,
        {
          name: '',
          description: '',
          model: '',
          tools: [],
          systemPrompt: '',
          enabled: true,
          isModelAgent: false
        } as SubAgentConfig
      ]
      handleUpdateSetting('subAgents', next)
    }

    return (
      <div className="settings-panel">
        <section className="settings-section">
          <h4>Sub-agents</h4>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Define specialized assistants Codex can delegate to during complex runs.
          </p>
          {subAgents.length === 0 ? (
            <div className="settings-empty-card">
              <p>No sub-agents configured yet.</p>
            </div>
          ) : (
            <div className="subagent-list">
              {subAgents.map((agent, index) => (
                <div key={`${agent.name || 'agent'}-${index}`} className="subagent-card">
                  <div className="subagent-header">
                    <div className="settings-field" style={{ flex: 1 }}>
                      <label>Name</label>
                      <input
                        className="settings-input"
                        placeholder="codex-executor"
                        value={agent.name ?? ''}
                        onChange={(event) => updateSubAgent(index, { name: event.target.value })}
                      />
                    </div>
                    <div className="subagent-controls">
                      <label className="settings-switch">
                        <input
                          type="checkbox"
                          checked={agent.enabled ?? true}
                          onChange={(event) => updateSubAgent(index, { enabled: event.target.checked })}
                        />
                        <span>Enabled</span>
                      </label>
                      <label className="settings-switch">
                        <input
                          type="checkbox"
                          checked={agent.isModelAgent ?? false}
                          onChange={(event) => updateSubAgent(index, { isModelAgent: event.target.checked })}
                        />
                        <span>Model agent</span>
                      </label>
                      <button
                        type="button"
                        className="settings-btn-icon remove"
                        onClick={() => removeSubAgent(index)}
                        aria-label="Remove sub-agent"
                      />
                    </div>
                  </div>
                  <div className="subagent-body">
                    <div className="settings-field">
                      <label>Model</label>
                      <input
                        className="settings-input"
                        placeholder="gpt-5-codex"
                        value={agent.model ?? ''}
                        onChange={(event) => updateSubAgent(index, { model: event.target.value })}
                      />
                    </div>
                    <div className="settings-field subagent-tools">
                      <label>Allowed tools</label>
                      <textarea
                        className="settings-textarea"
                        placeholder="read\ngrep\ntask"
                        value={listToMultiline(agent.tools)}
                        onChange={(event) => updateTools(index, event.target.value)}
                      />
                      <small>One tool identifier per line.</small>
                    </div>
                    <div className="settings-field">
                      <label>Description</label>
                      <textarea
                        className="settings-textarea"
                        placeholder="What this agent excels at."
                        value={agent.description ?? ''}
                        onChange={(event) => updateSubAgent(index, { description: event.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>System prompt</label>
                      <textarea
                        className="settings-textarea"
                        placeholder="Guidance the agent should follow."
                        value={agent.systemPrompt ?? ''}
                        onChange={(event) => updateSubAgent(index, { systemPrompt: event.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="subagent-actions">
            <button type="button" className="settings-btn secondary" onClick={addSubAgent}>
              Add sub-agent
            </button>
          </div>
        </section>
      </div>
    )
  }

  const renderAdvancedTab = () => {
    const includeDirsValue = listToMultiline(settings.includeDirs)
    const hooks: HookConfig[] = settings.hooks ?? []
    const statusLineType = settings.statusLine?.type ?? 'static'
    const statusLineCommand = settings.statusLine?.type === 'command' ? settings.statusLine.command ?? '' : ''
    const statusLineContent = settings.statusLine?.type === 'static' ? settings.statusLine.content ?? '' : ''
    const cleanupDays = settings.cleanupPeriodDays

    const handleStatusLineTypeChange = (value: 'command' | 'static') => {
      if (value === 'command') {
        handleUpdateSetting('statusLine', { type: 'command', command: statusLineCommand })
      } else {
        handleUpdateSetting('statusLine', { type: 'static', content: statusLineContent })
      }
    }

    const handleStatusLineCommandChange = (value: string) => {
      handleUpdateSetting('statusLine', { type: 'command', command: value })
    }

    const handleStatusLineContentChange = (value: string) => {
      handleUpdateSetting('statusLine', { type: 'static', content: value })
    }

    const updateHook = (index: number, partial: Partial<HookConfig>) => {
      const next: HookConfig[] = hooks.map((hook, idx) => (idx === index ? { ...hook, ...partial } : hook))
      handleUpdateSetting('hooks', next)
    }

    const updateHookCommands = (index: number, raw: string) => {
      const commands = multilineToList(raw).map((command) => ({ type: 'command' as const, command }))
      updateHook(index, { hooks: commands })
    }

    const removeHook = (index: number) => {
      const next = hooks.filter((_, idx) => idx !== index)
      handleUpdateSetting('hooks', next.length ? next : undefined)
    }

    const addHook = () => {
      const next: HookConfig[] = [...hooks, { matcher: '', hooks: [] }]
      handleUpdateSetting('hooks', next)
    }

    return (
      <div className="settings-panel">
        <section className="settings-section">
          <h4>Workspace & history</h4>
          <div className="settings-form-grid">
            <div className="settings-field">
              <label htmlFor="cleanup-days">Cleanup period (days)</label>
              <input
                id="cleanup-days"
                className="settings-input"
                type="number"
                min={0}
                value={cleanupDays ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === '') {
                    handleUpdateSetting('cleanupPeriodDays', undefined)
                  } else {
                    const nextValue = Number(value)
                    handleUpdateSetting('cleanupPeriodDays', Number.isFinite(nextValue) ? nextValue : undefined)
                  }
                }}
              />
              <small>Older history entries are pruned on startup.</small>
            </div>
          </div>
          <div className="settings-toggle-group">
            <label className="settings-toggle settings-toggle-rich">
              <input
                type="checkbox"
                checked={settings.autoUpdates ?? true}
                onChange={(event) => handleUpdateSetting('autoUpdates', event.target.checked)}
              />
              <span>
                <strong>Enable automatic updates</strong>
                <small>Keep the Codex CLI up to date when new releases ship.</small>
              </span>
            </label>
            <label className="settings-toggle settings-toggle-rich">
              <input
                type="checkbox"
                checked={Boolean(settings.shiftEnterKeyBinding)}
                onChange={(event) => handleUpdateSetting('shiftEnterKeyBinding', event.target.checked)}
              />
              <span>
                <strong>Use Shift+Enter for newline</strong>
                <small>When disabled, Enter inserts a newline instead of sending.</small>
              </span>
            </label>
            <label className="settings-toggle settings-toggle-rich">
              <input
                type="checkbox"
                checked={Boolean(settings.checkpointClearOnStartup)}
                onChange={(event) => handleUpdateSetting('checkpointClearOnStartup', event.target.checked)}
              />
              <span>
                <strong>Clear checkpoints on startup</strong>
                <small>Removes prior turn checkpoints whenever Codex launches.</small>
              </span>
            </label>
          </div>
          <div className="settings-field" style={{ marginTop: 20 }}>
            <label htmlFor="include-dirs">Always include directories</label>
            <textarea
              id="include-dirs"
              className="settings-textarea"
              placeholder="src\npackages/api"
              value={includeDirsValue}
              onChange={(event) => handleUpdateSetting('includeDirs', multilineToList(event.target.value))}
            />
            <small>Paths are relative to the workspace root; one per line.</small>
          </div>
        </section>

        <section className="settings-section">
          <h4>Notifications & status line</h4>
          <div className="settings-form-grid">
            <div className="settings-field">
              <label htmlFor="preferred-channel">Preferred notification channel</label>
              <input
                id="preferred-channel"
                className="settings-input"
                placeholder="os, slack, email"
                value={settings.preferredNotifChannel ?? ''}
                onChange={(event) => handleUpdateSetting('preferredNotifChannel', event.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="force-login">Force login method</label>
              <select
                id="force-login"
                className="settings-select"
                value={settings.forceLoginMethod ?? ''}
                onChange={(event) => {
                  const value = event.target.value as 'claudeai' | 'console' | ''
                  handleUpdateSetting('forceLoginMethod', value ? value : undefined)
                }}
              >
                <option value="">Automatic</option>
                <option value="claudeai">Claude.ai</option>
                <option value="console">Console login</option>
              </select>
            </div>
            <div className="settings-field">
              <label htmlFor="status-line-mode">Status line mode</label>
              <select
                id="status-line-mode"
                className="settings-select"
                value={statusLineType}
                onChange={(event) => handleStatusLineTypeChange(event.target.value as 'command' | 'static')}
              >
                <option value="static">Static text</option>
                <option value="command">Command output</option>
              </select>
            </div>
          </div>
          {statusLineType === 'command' ? (
            <div className="settings-field" style={{ marginTop: 16 }}>
              <label htmlFor="status-command">Status command</label>
              <input
                id="status-command"
                className="settings-input"
                placeholder="./scripts/status.sh"
                value={statusLineCommand}
                onChange={(event) => handleStatusLineCommandChange(event.target.value)}
              />
              <small>Run before each prompt; stdout becomes the status line.</small>
            </div>
          ) : (
            <div className="settings-field" style={{ marginTop: 16 }}>
              <label htmlFor="status-static">Static message</label>
              <input
                id="status-static"
                className="settings-input"
                placeholder="Ready"
                value={statusLineContent}
                onChange={(event) => handleStatusLineContentChange(event.target.value)}
              />
            </div>
          )}
          <label className="settings-switch" style={{ marginTop: 20 }}>
            <input
              type="checkbox"
              checked={Boolean(settings.hasCompletedOnboarding)}
              onChange={(event) => handleUpdateSetting('hasCompletedOnboarding', event.target.checked)}
            />
            <span>Skip onboarding tips</span>
          </label>
        </section>

        <section className="settings-section">
          <h4>Automation hooks</h4>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            Run custom commands when files matching a pattern change or when projects load.
          </p>
          {hooks.length === 0 ? (
            <div className="settings-empty-card">
              <p>No hooks configured.</p>
            </div>
          ) : (
            <div className="settings-hooks-list">
              {hooks.map((hook, index) => (
                <div key={`hook-${index}`} className="settings-hook-card">
                  <div className="settings-field">
                    <label>Matcher</label>
                    <input
                      className="settings-input"
                      placeholder="src/**/*.ts"
                      value={hook.matcher ?? ''}
                      onChange={(event) => updateHook(index, { matcher: event.target.value })}
                    />
                  </div>
                  <div className="settings-field">
                    <label>Commands</label>
                    <textarea
                      className="settings-textarea"
                      placeholder="npm test -- src\nmake lint"
                      value={listToMultiline(hook.hooks?.map((entry) => entry.command))}
                      onChange={(event) => updateHookCommands(index, event.target.value)}
                    />
                    <small>Run commands in order; one per line.</small>
                  </div>
                  <div className="settings-hook-actions">
                    <button
                      type="button"
                      className="settings-btn-icon remove"
                      onClick={() => removeHook(index)}
                      aria-label="Remove hook"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="settings-hooks-actions">
            <button type="button" className="settings-btn secondary" onClick={addHook}>
              Add hook
            </button>
          </div>
        </section>
      </div>
    )
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'integrations':
        return renderIntegrationsTab()
      case 'subagents':
        return renderSubagentsTab()
      case 'advanced':
        return renderAdvancedTab()
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

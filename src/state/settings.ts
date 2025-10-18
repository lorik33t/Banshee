import { create } from 'zustand'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { ModeOptionId, ApprovalPolicyValue, SandboxModeValue } from '../constants/codex'

export interface SandboxWorkspaceWriteConfig {
  writableRoots?: string[]
  networkAccess?: boolean
  excludeTmpdirEnvVar?: boolean
  excludeSlashTmp?: boolean
}

export interface ClaudeSettings {
  // Permission settings
  autoApprove?: boolean
  autoApprovePatterns?: string[]
  permissions?: {
    allow?: string[]
    ask?: string[]
    deny?: string[]
  }
  
  // Model settings
  model?: string
  apiKeyHelper?: string
  customApiKeyResponses?: Record<string, boolean>
  
  // Development settings
  env?: Record<string, string>
  hooks?: Array<{
    matcher?: string
    hooks?: Array<{
      type: 'command'
      command: string
    }>
  }>
  includeCoAuthoredBy?: boolean
  
  // MCP Servers
  mcpServers?: Record<string, {
    command: string
    args?: string[]
    env?: Record<string, string>
    type?: 'stdio' | 'sse' | 'http'
    url?: string
    headers?: Record<string, string>
  }>
  
  // UI/UX settings
  theme?: 'light' | 'dark' | 'system' | 'retro'
  verbose?: boolean
  statusLine?: {
    type: 'command' | 'static'
    command?: string
    content?: string
  }
  preferredNotifChannel?: string
  planningMode?: boolean
  backgroundExecution?: boolean
  approvalPolicy?: ApprovalPolicyValue
  sandboxMode?: SandboxModeValue
  sandboxWorkspaceWrite?: SandboxWorkspaceWriteConfig
  defaultModeId?: ModeOptionId
  defaultModelId?: string
  fileOpener?: 'vscode' | 'vscode-insiders' | 'windsurf' | 'cursor' | 'none'
  historyPersistence?: 'save-all' | 'none'
  
  // System settings
  cleanupPeriodDays?: number
  autoUpdates?: boolean
  forceLoginMethod?: 'claudeai' | 'console'
  hasCompletedOnboarding?: boolean
  shiftEnterKeyBinding?: boolean
  // Checkpoints
  checkpointClearOnStartup?: boolean
  // AI Response Streaming
  streamingSpeed?: 'slow' | 'normal' | 'fast'
  
  // Projects configuration
  projects?: Record<string, {
    mcpServers?: Record<string, Record<string, unknown>>
    env?: Record<string, string>
  }>
  
  // Sub-agents
  subAgents?: Array<{
    name: string
    description: string
    tools?: string[]
    model?: string
    systemPrompt: string
    enabled?: boolean
    isModelAgent?: boolean
  }>

  // Agent binaries and config
  agents?: {
    gemini?: { binPath?: string; enabled?: boolean }
    qwen?: { binPath?: string; enabled?: boolean }
    codex?: { binPath?: string; enabled?: boolean; displayMode?: 'clean' | 'compact' | 'verbose'; showReasoning?: boolean }
  }

  // Language servers
  lspServers?: Record<string, string>

  // Common agent behavior toggles
  mcpEnabled?: boolean
  webSearchEnabled?: boolean
  includeDirs?: string[]
  autonomy?: number // 0-100

  // Primary model defaults (already referenced by SettingsDialogV2)
  defaultModel?: string
  apiKey?: string
  apiEndpoint?: string
}

interface SettingsState {
  settings: ClaudeSettings
  isOpen: boolean
  isLoading: boolean
  error?: string
  
  loadSettings: () => Promise<void>
  saveSettings: (settings: ClaudeSettings) => Promise<void>
  updateSetting: <K extends keyof ClaudeSettings>(key: K, value: ClaudeSettings[K]) => void
  openSettings: () => void
  closeSettings: () => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: {
    autoApprove: true,
    autoApprovePatterns: [],
    includeCoAuthoredBy: true,
    cleanupPeriodDays: 30,
    autoUpdates: true,
    verbose: false,
    checkpointClearOnStartup: false,
    streamingSpeed: 'normal',
    theme: 'system',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    sandboxWorkspaceWrite: {
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    defaultModeId: 'agent-full',
    defaultModelId: 'gpt-5-codex-high',
    fileOpener: 'vscode',
    historyPersistence: 'save-all',
    // New defaults
    mcpEnabled: true,
    webSearchEnabled: false,
    includeDirs: [],
    autonomy: 50,
    planningMode: false,
    agents: {
      gemini: { enabled: true },
      qwen: { enabled: true },
      codex: { enabled: false, displayMode: 'clean', showReasoning: true }
    },
    lspServers: {},
    // No sub-agents configured by default
    subAgents: []
  },
  isOpen: false,
  isLoading: false,
  
  loadSettings: async () => {
    set({ isLoading: true, error: undefined })
    try {
      const hasTauri = typeof window !== 'undefined' && Boolean((window as { __TAURI__?: unknown }).__TAURI__)
      if (hasTauri) {
        const settings = await tauriInvoke<ClaudeSettings>('load_settings')
        try {
          localStorage.setItem('claude_settings', JSON.stringify(settings ?? {}))
        } catch (storageError) {
          console.warn('[Settings] Failed to cache settings', storageError)
        }
        set({ settings, isLoading: false })
      } else {
        const stored = localStorage.getItem('claude_settings')
        if (stored) {
          set({ settings: JSON.parse(stored), isLoading: false })
        } else {
          set({ isLoading: false })
        }
      }
    } catch (err) {
      try {
        const stored = localStorage.getItem('claude_settings')
        if (stored) {
          set({ settings: JSON.parse(stored), isLoading: false, error: `Using local settings: ${err}` })
          return
        }
      } catch (fallbackError) {
        console.warn('[Settings] Failed to load fallback settings', fallbackError)
      }
      set({ error: `Failed to load settings: ${err}`, isLoading: false })
    }
  },

  saveSettings: async (settings: ClaudeSettings) => {
    set({ isLoading: true, error: undefined })
    try {
      const hasTauri = typeof window !== 'undefined' && Boolean((window as { __TAURI__?: unknown }).__TAURI__)
      if (hasTauri) {
        await tauriInvoke('save_settings', { settings })
        try {
          localStorage.setItem('claude_settings', JSON.stringify(settings ?? {}))
        } catch (storageError) {
          console.warn('[Settings] Failed to cache settings', storageError)
        }
      } else {
        localStorage.setItem('claude_settings', JSON.stringify(settings ?? {}))
      }
      set({ settings, isLoading: false })
    } catch (err) {
      set({ error: `Failed to save settings: ${err}`, isLoading: false })
    }
  },
  
  updateSetting: (key, value) => {
    const current = get().settings
    const next = { ...current, [key]: value }

    // Keep derived settings in sync when defaults change
    if (key === 'defaultModeId' && typeof value === 'string') {
      next.approvalPolicy = (value === 'chat-plan'
        ? 'on-request'
        : value === 'agent'
          ? 'on-failure'
          : 'never') as ApprovalPolicyValue
      next.sandboxMode = (value === 'chat-plan'
        ? 'workspace-write'
        : value === 'agent'
          ? 'workspace-write'
          : 'danger-full-access') as SandboxModeValue
    }

    set({ settings: next })
  },
  
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false })
}))

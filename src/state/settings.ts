import { create } from 'zustand'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'

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
  theme?: string
  verbose?: boolean
  statusLine?: {
    type: 'command' | 'static'
    command?: string
    content?: string
  }
  preferredNotifChannel?: string
  planningMode?: boolean
  backgroundExecution?: boolean
  
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
    mcpServers?: Record<string, any>
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

  // Primary model defaults
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
    // New defaults
    mcpEnabled: true,
    webSearchEnabled: false,
    includeDirs: [],
    autonomy: 50,
    agents: {
      gemini: { enabled: true },
      qwen: { enabled: true },
      codex: { enabled: false, displayMode: 'clean', showReasoning: true }
    },
    lspServers: {},
    // Preconfigure Claude Code subagents so Claude can delegate
    subAgents: [
      {
        name: 'gemini-context',
        description: 'Large‑context reads/sweeps across many files',
        tools: ['read', 'grep', 'web'],
        model: 'gemini',
        systemPrompt: 'You are a Gemini-powered subagent specialized in handling massive context windows (up to 1M tokens). Prioritize fast file enumeration, targeted reading, and concise summaries suitable for a synthesizer to consume.',
        enabled: true,
        isModelAgent: true
      },
      {
        name: 'qwen-automation',
        description: 'Repository‑scale code operations and automation',
        tools: ['bash', 'write', 'edit', 'grep'],
        model: 'qwen',
        systemPrompt: 'You are a Qwen-powered subagent optimized for repository-scale code operations (bulk edits, refactors, commands). Minimize chatter; output clear diffs and concise results.',
        enabled: true,
        isModelAgent: true
      },
      {
        name: 'codex-executor',
        description: 'Deep planning and analytical reasoning',
        tools: ['task'],
        model: 'codex',
        systemPrompt: 'You are a Codex-powered subagent specializing in careful multi-step reasoning. Produce a short plan and rationale that a synthesizer can integrate.',
        enabled: true,
        isModelAgent: true
      }
    ]
  },
  isOpen: false,
  isLoading: false,
  
  loadSettings: async () => {
    set({ isLoading: true, error: undefined })
    try {
      // Check if Tauri is available
      // @ts-ignore - Tauri window
      if (typeof window !== 'undefined' && (window as any).__TAURI__) {
        // Use Tauri API invoke (v2) instead of window.__TAURI__.invoke
        const settings = await tauriInvoke<ClaudeSettings>('load_settings')
        // Mirror to localStorage so ModelRouter (which reads localStorage) stays in sync
        try { localStorage.setItem('claude_settings', JSON.stringify(settings || {})) } catch {}
        set({ settings, isLoading: false })
      } else {
        // Running in browser - load from localStorage as fallback
        const stored = localStorage.getItem('claude_settings')
        if (stored) {
          set({ settings: JSON.parse(stored), isLoading: false })
        } else {
          set({ isLoading: false })
        }
      }
    } catch (err) {
      // On failure, fall back to localStorage and surface a concise error
      try {
        const stored = localStorage.getItem('claude_settings')
        if (stored) {
          set({ settings: JSON.parse(stored), isLoading: false, error: `Using local settings: ${err}` })
          return
        }
      } catch {}
      set({ error: `Failed to load settings: ${err}`, isLoading: false })
    }
  },
  
  saveSettings: async (settings: ClaudeSettings) => {
    set({ isLoading: true, error: undefined })
    try {
      // Check if Tauri is available
      // @ts-ignore - Tauri window
      if (typeof window !== 'undefined' && (window as any).__TAURI__) {
        // Use Tauri API invoke (v2) instead of window.__TAURI__.invoke
        await tauriInvoke('save_settings', { settings })
        // Also mirror to localStorage so router sees the updated flags immediately
        try { localStorage.setItem('claude_settings', JSON.stringify(settings || {})) } catch {}
      } else {
        // Running in browser - save to localStorage as fallback
        localStorage.setItem('claude_settings', JSON.stringify(settings || {}))
      }
      set({ settings, isLoading: false })
    } catch (err) {
      set({ 
        error: `Failed to save settings: ${err}`,
        isLoading: false 
      })
    }
  },
  
  updateSetting: (key, value) => {
    const current = get().settings
    set({ 
      settings: { ...current, [key]: value }
    })
  },
  
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false })
}))

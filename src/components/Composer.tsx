import { Paperclip, Image as ImageIcon, Mic, Terminal as TerminalIcon, StopCircle, Send, ChevronDown } from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useSession } from '../state/session'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { useSettings } from '../state/settings'
import type { SessionEvent } from '../state/session'

const agents = [
  {
    id: 'codex',
    name: 'Codex',
    color: '#10b981',
    description: 'OpenAI Codex CLI • Streaming'
  }
]

type ReasoningEffortLevel = 'minimal' | 'low' | 'medium' | 'high'

type CodexModel = {
  id: string
  label: string
  description: string
  color: string
  slug: string
  effort?: ReasoningEffortLevel
}

type ModeOptionId = 'chat-plan' | 'agent' | 'agent-full'

type ApprovalPolicyValue = 'on-request' | 'on-failure' | 'never'
type SandboxModeValue = 'workspace-write' | 'danger-full-access' | 'read-only'

type ModeOption = {
  id: ModeOptionId
  label: string
  autoAccept: boolean
  approvalPolicy: ApprovalPolicyValue
  sandboxMode: SandboxModeValue
}

const CODEX_MODELS: CodexModel[] = [
  {
    id: 'gpt-5-codex-low',
    label: 'gpt-5-codex low',
    description: 'Codex automation tuned for low reasoning effort.',
    color: '#6366f1',
    slug: 'gpt-5-codex',
    effort: 'low'
  },
  {
    id: 'gpt-5-codex-medium',
    label: 'gpt-5-codex medium',
    description: 'Balanced Codex automation profile.',
    color: '#7c3aed',
    slug: 'gpt-5-codex'
  },
  {
    id: 'gpt-5-codex-high',
    label: 'gpt-5-codex high',
    description: 'Codex automation with maximum reasoning depth.',
    color: '#a855f7',
    slug: 'gpt-5-codex',
    effort: 'high'
  },
  {
    id: 'gpt-5-minimal',
    label: 'gpt-5 minimal',
    description: 'Fastest responses with limited reasoning; good for lightweight tasks.',
    color: '#0ea5e9',
    slug: 'gpt-5',
    effort: 'minimal'
  },
  {
    id: 'gpt-5-low',
    label: 'gpt-5 low',
    description: 'Balances speed with some reasoning for straightforward prompts.',
    color: '#14b8a6',
    slug: 'gpt-5',
    effort: 'low'
  },
  {
    id: 'gpt-5-medium',
    label: 'gpt-5 medium',
    description: 'Default mix of reasoning depth and latency.',
    color: '#f97316',
    slug: 'gpt-5',
    effort: 'medium'
  },
  {
    id: 'gpt-5-high',
    label: 'gpt-5 high',
    description: 'Maximum reasoning depth for complex or ambiguous problems.',
    color: '#ef4444',
    slug: 'gpt-5',
    effort: 'high'
  }
]

const DEFAULT_MODEL_ID = 'gpt-5-medium'
const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'chat-plan',
    label: 'Chat or Plan',
    autoAccept: false,
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write'
  },
  {
    id: 'agent',
    label: 'Agent',
    autoAccept: false,
    approvalPolicy: 'on-failure',
    sandboxMode: 'workspace-write'
  },
  {
    id: 'agent-full',
    label: 'Agent (full access)',
    autoAccept: true,
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access'
  }
]
const DEFAULT_MODE_ID: ModeOptionId = 'agent-full'

export function Composer() {
  const [input, setInput] = useState('')
  const [showAgents, setShowAgents] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [attachedImages, setAttachedImages] = useState<Array<{ url: string; name: string }>>([])
  const [isDragging, setIsDragging] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const pushEvent = useSession((s) => s.pushEvent)
  const setShowTerminal = useSession((s) => s.setShowTerminal)
  const streamEnabledRef = useRef<boolean>(false)
  const autoAccept = useSession((s) => s.autoAccept)
  const setAutoAccept = useSession((s) => s.setAutoAccept)
  const contextUsage = useSession((s) => s.contextUsage)
  const messages = useSession((s) => s.messages)
  const isStreaming = useSession((s) => s.isStreaming)
  const setStreaming = useSession((s) => s.setStreaming)
  const projectDir = useSession((s) => s.projectDir)
  const appSettings = useSettings((s) => s.settings)

  const loadStoredModel = () => {
    const fallback = CODEX_MODELS.find((m) => m.id === DEFAULT_MODEL_ID)?.id ?? CODEX_MODELS[0].id
    if (typeof window === 'undefined') return fallback
    try {
      const stored = localStorage.getItem('codex:selected-model')
      if (stored && CODEX_MODELS.some((m) => m.id === stored)) {
        return stored
      }
    } catch {}
    return fallback
  }

  const [selectedModel, setSelectedModel] = useState<string>(loadStoredModel)

  const loadStoredMode = () => {
    if (typeof window === 'undefined') {
      return (
        MODE_OPTIONS.find((opt) => opt.autoAccept === autoAccept)?.id ?? DEFAULT_MODE_ID
      )
    }
    try {
      const stored = localStorage.getItem('codex:selected-mode') as ModeOptionId | null
      if (stored && MODE_OPTIONS.some((opt) => opt.id === stored)) {
        return stored
      }
    } catch {}
    return MODE_OPTIONS.find((opt) => opt.autoAccept === autoAccept)?.id ?? DEFAULT_MODE_ID
  }

  const [selectedMode, setSelectedMode] = useState<ModeOptionId>(loadStoredMode)

  const contextInfo = useMemo(() => {
    if (!contextUsage) return undefined
    const remainingPct = contextUsage.remainingPct ?? (contextUsage.usedPct != null ? 100 - contextUsage.usedPct : undefined)
    const usedPct = contextUsage.usedPct ?? (remainingPct != null ? 100 - remainingPct : undefined)
    const clamp = (value: number) => Math.min(100, Math.max(0, value))
    const percentUsed = usedPct != null ? clamp(usedPct) : undefined
    const percentLeft = remainingPct != null ? clamp(remainingPct) : undefined
    const radius = 9
    const circumference = 2 * Math.PI * radius
    const dashOffset = percentUsed != null ? circumference * (1 - percentUsed / 100) : undefined
    return {
      percentUsed,
      percentLeft,
      remainingTokens: contextUsage.remainingTokens,
      effectiveTokens: contextUsage.effective,
      window: contextUsage.window,
      tokenUsage: contextUsage.tokenUsage,
      circumference,
      radius,
      dashOffset,
    }
  }, [contextUsage])

  const formatTokens = (value?: number) => {
    if (value === undefined || value === null) return ''
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
    if (value >= 10_000) return `${Math.round(value / 1_000)}k`
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
    return String(Math.round(value))
  }

// -- helpers ----------------------------------------------------------------
  const adjustTextareaHeight = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(200, Math.max(36, el.scrollHeight))
    el.style.height = `${next}px`
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [input])

  useEffect(() => {
    try { localStorage.setItem('codex:selected-model', selectedModel) } catch {}
  }, [selectedModel])

  useEffect(() => {
    if (!showModelMenu) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (modelMenuRef.current?.contains(target) || modelButtonRef.current?.contains(target)) {
        return
      }
      setShowModelMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showModelMenu])

  useEffect(() => {
    if (!showModeMenu) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (modeMenuRef.current?.contains(target) || modeButtonRef.current?.contains(target)) {
        return
      }
      setShowModeMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showModeMenu])

  useEffect(() => {
    const option = MODE_OPTIONS.find((opt) => opt.id === selectedMode) ?? MODE_OPTIONS[0]
    try { localStorage.setItem('codex:selected-mode', option.id) } catch {}
    setAutoAccept(option.autoAccept)
  }, [selectedMode, setAutoAccept])

  // Handle image paste on the textarea
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    let handled = false
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        handled = true
        const file = item.getAsFile()
        if (file) {
          const reader = new FileReader()
          reader.onload = (event) => {
            const dataUrl = event.target?.result as string
            setAttachedImages(prev => [...prev, {
              url: dataUrl,
              name: `image-${Date.now()}.${file.type.split('/')[1]}`
            }])
          }
          reader.readAsDataURL(file)
        }
      }
    }
    if (handled) e.preventDefault()
  }

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string
          setAttachedImages(prev => [...prev, { url: dataUrl, name: file.name }])
        }
        reader.readAsDataURL(file)
      }
    })
  }

  // Listen for Codex stream events once on mount
  useEffect(() => {
    let mounted = true
    const unlisten: Array<() => void> = []

    const handleStreamPayload = (event: { payload: unknown }) => {
      if (!mounted) return
      const raw = event?.payload
      const events = Array.isArray(raw) ? raw : [raw]
      events.forEach((ev) => {
        const data = ev as SessionEvent
        if (!data) return
        if (data.type === 'assistant:delta') {
          if (!isStreaming) {
            setStreaming(true)
          }
          pushEvent(data)
        } else if (data.type === 'assistant:complete') {
          setStreaming(false)
          streamEnabledRef.current = false
          pushEvent(data)
        } else {
          pushEvent(data)
        }
      })
    }

    const handleError = (ev?: any) => {
      try {
        const raw = (ev && (ev.payload ?? ev)) || ''
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
        if (text && /error|invalid|missing|unauthorized|forbidden|denied|timed out|timeout/i.test(text)) {
          pushEvent({ id: String(Date.now()), type: 'message', role: 'assistant', text: `⚠️ ${text}`, ts: Date.now() } as any)
          setStreaming(false)
        }
      } catch {}
    }

    tauriListen('codex:stream', handleStreamPayload).then((fn) => {
      if (mounted) unlisten.push(fn)
    })
    tauriListen('codex:error', handleError).then((fn) => {
      if (mounted) unlisten.push(fn)
    })

    return () => {
      mounted = false
      unlisten.forEach((fn) => fn && fn())
    }
  }, [isStreaming, pushEvent, setStreaming])

  const handleInputChange = (value: string) => {
    setInput(value)
    adjustTextareaHeight()
    const inProgressMention = /@([a-z]*)$/i.test(value)
    if (inProgressMention) {
      setShowAgents(true)
    } else if (!value.includes('@') || value.match(/@codex\s/i)) {
      setShowAgents(false)
    }
  }

  const handleAddContext = () => {
    const needsSpace = input.length > 0 && !input.endsWith(' ') && !input.endsWith('@')
    const needsAt = !input.endsWith('@')
    const nextValue = `${input}${needsSpace ? ' ' : ''}${needsAt ? '@' : ''}`
    handleInputChange(nextValue)
    setShowAgents(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const toggleModelMenu = () => {
    setShowModelMenu((prev) => {
      const next = !prev
      if (next) setShowModeMenu(false)
      return next
    })
  }

  const toggleModeMenu = () => {
    setShowModeMenu((prev) => {
      const next = !prev
      if (next) setShowModelMenu(false)
      return next
    })
  }

  const handleSend = async () => {
    const rawText = input.trim()
    if ((!rawText && attachedImages.length === 0) || isStreaming) return

    const cleanText = rawText.replace(/^@codex(?=[\s:.,-]|$)[\s:.,-]*/i, '').trim()
    const content: any[] = []
    if (cleanText) {
      content.push({ type: 'text', text: cleanText })
    }
    attachedImages.forEach(img => {
      content.push({ type: 'image', url: img.url, name: img.name })
    })

    setInput('')
    setAttachedImages([])
    setShowAgents(false)
    setShowModelMenu(false)
    // no-op; popover closes

    const userEvent = {
      id: String(Date.now()),
      type: 'message',
      role: 'user',
      text: cleanText || '[Image]',
      content,
      ts: Date.now(),
      model: currentModel.slug
    } as any
    pushEvent(userEvent)

    streamEnabledRef.current = true
    setStreaming(true, currentModel.slug)

    const imagePaths: string[] = []
    for (const img of attachedImages) {
      try {
        const path = await tauriInvoke<string>('save_temp_image', {
          base64Data: img.url,
          filename: img.name
        })
        imagePaths.push(path)
      } catch (err) {
        console.error('Failed to save image:', err)
      }
    }

    let messageText = cleanText
    if (imagePaths.length > 0) {
      messageText = `${cleanText} ${imagePaths.join(' ')}`.trim()
    }

    let memoryText = ''
    if (projectDir) {
      const candidates = [
        `${projectDir}/GEMINI.md`,
        `${projectDir}/CLAUDE.md`,
        `${projectDir}/.gemini/GEMINI.md`,
        `${projectDir}/.claude/CLAUDE.md`
      ]
      for (const p of candidates) {
        try {
          const txt = await readTextFile(p)
          if (txt && txt.trim().length > 0) { memoryText = txt; break }
        } catch (_) {}
      }
    }

    const buildComposedPrompt = (recentMessages: typeof messages, userText: string, memory?: string) => {
      const MAX_TURNS = 10
      const history = recentMessages
        .slice(-MAX_TURNS)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n')
      const sections: string[] = [
        'System: You are an AI coding assistant. Continue the conversation based on the context below. Keep responses concise unless asked otherwise.'
      ]
      if (memory && memory.trim().length > 0) {
        sections.push('--- Project Memory ---')
        sections.push(memory.trim())
      }
      sections.push('--- Conversation (recent) ---')
      sections.push(history || '[No prior messages]')
      const header = sections.join('\n')
      return `${header}\n\nUser: ${userText}\nAssistant:`
    }

    const composedPrompt = buildComposedPrompt(messages, messageText, memoryText)
    const payload: any = {
      currentMessage: composedPrompt,
      images: imagePaths,
      model: currentModel.slug,
      approvalPolicy: currentMode.approvalPolicy,
      sandboxMode: currentMode.sandboxMode
    }
    if (currentModel.effort) {
      payload.effort = currentModel.effort
    }
    const codexCfg = appSettings?.agents?.codex || {}
    payload.codexOptions = {
      displayMode: (codexCfg as any).displayMode || 'clean',
      showReasoning: (codexCfg as any).showReasoning !== false
    }

    try {
      await tauriInvoke('send_to_codex', { input: JSON.stringify(payload) })
    } catch (err) {
      console.error('Failed to invoke Codex:', err)
      setStreaming(false)
      streamEnabledRef.current = false
    }
  }

  const handleStop = async () => {
    try {
      await tauriInvoke('interrupt_codex')
    } catch (err) {
      console.error('Failed to interrupt Codex:', err)
    } finally {
      setStreaming(false)
      streamEnabledRef.current = false
      useSession.getState().setStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSend()
  }

  const currentModel = CODEX_MODELS.find((m) => m.id === selectedModel) ?? CODEX_MODELS[0]
  const currentMode = MODE_OPTIONS.find((opt) => opt.id === selectedMode) ?? MODE_OPTIONS[0]

  return (
    <div className="input-container">
      <form id="chat-form" className="chat-form" onSubmit={handleSubmit}>
        <div
          ref={wrapperRef}
          className={`input-wrapper ${isFocused ? 'is-focused' : ''} ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="input-header">
            <div className="header-left">
              <button type="button" className="add-context-btn" onClick={handleAddContext}>
                <span>@</span> Add Context
              </button>
              {attachedImages.length > 0 && (
                <div className="attachment-pills" aria-label="Attached images">
                  {attachedImages.map((img, idx) => (
                    <div key={`${img.name}-${idx}`} className="attachment-pill">
                      <span
                        className="attachment-thumb"
                        style={{ backgroundImage: `url(${img.url})` }}
                        aria-hidden="true"
                      />
                      <span className="attachment-name" title={img.name}>{img.name}</span>
                      <button
                        type="button"
                        className="attachment-remove"
                        onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                        aria-label={`Remove ${img.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {showAgents && (
            <div className="agent-menu">
              {agents.map(agent => (
                <button
                  key={agent.id}
                  className="agent-option"
                  onClick={() => {
                    setShowAgents(false)
                    setTimeout(() => textareaRef.current?.focus(), 0)
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <span className="agent-dot" style={{ background: agent.color }} />
                  <div className="agent-info">
                    <div className="agent-name">@{agent.id}</div>
                    <div className="agent-desc">{agent.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="input-main">
            <textarea
              ref={textareaRef}
              placeholder="Ask Codex to help with your code, explain concepts, or solve problems..."
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 200)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>

          <div className="input-footer">
            <div className="footer-left">
              <div className="model-pill-wrapper">
                <button
                  type="button"
                  className="model-pill"
                  onClick={toggleModelMenu}
                  ref={modelButtonRef}
                  aria-haspopup="listbox"
                  aria-expanded={showModelMenu}
                >
                  <span>{currentModel.label}</span>
                  <ChevronDown size={14} />
                </button>
                {showModelMenu && (
                  <div className="model-popover" ref={modelMenuRef} role="listbox">
                    {CODEX_MODELS.map((model) => {
                      const isActive = model.id === selectedModel
                      return (
                        <button
                          key={model.id}
                          className={`model-option ${isActive ? 'active' : ''}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            setSelectedModel(model.id)
                            setShowModelMenu(false)
                          }}
                        >
                          {model.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="mode-pill-wrapper">
                <button
                  type="button"
                  className="mode-pill"
                  onClick={toggleModeMenu}
                  ref={modeButtonRef}
                  aria-haspopup="listbox"
                  aria-expanded={showModeMenu}
                >
                  <span>{currentMode.label}</span>
                  <ChevronDown size={14} />
                </button>
                {showModeMenu && (
                  <div className="mode-popover" ref={modeMenuRef} role="listbox">
                    {MODE_OPTIONS.map((option) => {
                      const isActive = option.id === selectedMode
                      return (
                        <button
                          key={option.id}
                          className={`mode-option ${isActive ? 'active' : ''}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            setSelectedMode(option.id)
                            setShowModeMenu(false)
                          }}
                        >
                          <span>{option.label}</span>
                          {isActive && <span className="mode-check">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              {contextInfo?.percentLeft !== undefined && contextInfo.dashOffset !== undefined && (
                <div
                  className="context-meter"
                  title={(() => {
                    const percent = `${Math.round(contextInfo.percentLeft)}% left`
                    const hasTokens = contextInfo.remainingTokens !== undefined && contextInfo.effectiveTokens !== undefined
                    const remaining = hasTokens
                      ? `${formatTokens(contextInfo.remainingTokens)} / ${formatTokens(contextInfo.effectiveTokens)} tokens`
                      : undefined
                    return remaining ? `${percent} · ${remaining}` : percent
                  })()}
                >
                  <svg
                    className="context-ring"
                    width={contextInfo.radius * 2 + 2}
                    height={contextInfo.radius * 2 + 2}
                    viewBox={`0 0 ${contextInfo.radius * 2 + 2} ${contextInfo.radius * 2 + 2}`}
                  >
                    <circle
                      className="context-ring-bg"
                      cx={contextInfo.radius + 1}
                      cy={contextInfo.radius + 1}
                      r={contextInfo.radius}
                    />
                    <circle
                      className="context-ring-progress"
                      cx={contextInfo.radius + 1}
                      cy={contextInfo.radius + 1}
                      r={contextInfo.radius}
                      strokeDasharray={contextInfo.circumference}
                      strokeDashoffset={contextInfo.dashOffset}
                    />
                  </svg>
                  <span>{Math.round(contextInfo.percentLeft)}%</span>
                </div>
              )}
            </div>

            <div className="footer-right">
              <button type="button" className="icon-btn" title="Attach files">
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
              >
                <ImageIcon size={16} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files || [])
                  files.forEach(file => {
                    const reader = new FileReader()
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string
                      setAttachedImages(prev => [...prev, { url: dataUrl, name: file.name }])
                    }
                    reader.readAsDataURL(file)
                  })
                  e.target.value = ''
                }}
              />
              <button type="button" className="icon-btn" title="Voice input">
                <Mic size={16} />
              </button>
              <button type="button" className="icon-btn" title="Toggle terminal" onClick={() => setShowTerminal(true)}>
                <TerminalIcon size={16} />
              </button>
              <button
                type="button"
                className={`stop-btn ${isStreaming ? '' : 'hidden'}`}
                onClick={handleStop}
                disabled={!isStreaming}
              >
                <StopCircle size={16} />
                Stop
              </button>
              <button
                type="submit"
                className="send-btn"
                disabled={!input.trim() && attachedImages.length === 0}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </form>

    </div>
  )
}

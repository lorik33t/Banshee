import { Paperclip, Image as ImageIcon, Mic, Terminal as TerminalIcon, StopCircle, Send, ChevronDown } from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useSession, queueSessionEvent } from '../state/session'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { useSettings } from '../state/settings'
import { useProjectFiles } from '../hooks/useProjectFiles'
import type { SessionEvent } from '../state/session'
import {
  CODEX_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_MODE_ID,
  MODE_OPTIONS,
  type ModeOptionId,
} from '../constants/codex'

const agents = [
  {
    id: 'codex',
    name: 'Codex',
    color: '#10b981',
    description: 'OpenAI Codex CLI • Streaming'
  }
]
const MAX_CONTEXT_RESULTS = 100

export function Composer() {
  const [input, setInput] = useState('')
  const [showAgents, setShowAgents] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [attachedImages, setAttachedImages] = useState<Array<{ url: string; name: string }>>([])
  const [isDragging, setIsDragging] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuManual, setContextMenuManual] = useState(false)
  const [contextQuery, setContextQuery] = useState('')
  const [contextHighlight, setContextHighlight] = useState(0)
  const [contextTokens, setContextTokens] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const contextButtonRef = useRef<HTMLButtonElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextSearchRef = useRef<HTMLInputElement>(null)
  const [activeMention, setActiveMention] = useState<{ start: number; end: number; query: string } | null>(null)
  const pushEvent = useSession((s) => s.pushEvent)
  const showTerminal = useSession((s) => s.showTerminal)
  const setShowTerminal = useSession((s) => s.setShowTerminal)
  const streamEnabledRef = useRef<boolean>(false)
  const setAutoAccept = useSession((s) => s.setAutoAccept)
  const setCodexSelection = useSession((s) => s.setCodexSelection)
  const contextUsage = useSession((s) => s.contextUsage)
  const messages = useSession((s) => s.messages)
  const isStreaming = useSession((s) => s.isStreaming)
  const sessionId = useSession((s) => s.sessionId)
  const setStreaming = useSession((s) => s.setStreaming)
  const projectDir = useSession((s) => s.projectDir)
  const appSettings = useSettings((s) => s.settings)
  const { files: projectFiles, loading: filesLoading, error: filesError, hasProject } = useProjectFiles()

  const loadStoredModel = () => {
    const preferred = appSettings.defaultModelId
    const fallback = CODEX_MODELS.find((m) => m.id === preferred)?.id
      ?? CODEX_MODELS.find((m) => m.id === DEFAULT_MODEL_ID)?.id
      ?? CODEX_MODELS[0].id
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
  const previousDefaultModelRef = useRef(appSettings.defaultModelId)

const loadStoredMode = () => {
    const preferred = appSettings.defaultModeId ?? DEFAULT_MODE_ID
    if (typeof window === 'undefined') {
      return preferred
    }
    try {
      const stored = localStorage.getItem('codex:selected-mode') as ModeOptionId | null
      if (stored && MODE_OPTIONS.some((opt) => opt.id === stored)) {
        return stored
      }
    } catch {}
    return preferred
  }

  const [selectedMode, setSelectedMode] = useState<ModeOptionId>(loadStoredMode)
  const previousDefaultModeRef = useRef(appSettings.defaultModeId)

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

  const contextTokenForPath = useCallback((relativePath: string) => {
    const normalized = relativePath.replace(/^\.\//, '')
    return /\s/.test(normalized) ? `@"${normalized}"` : `@${normalized}`
  }, [])

  const stripContextTokens = useCallback((value: string) => {
    return value
      .replace(/@"([^"\n]+)"/g, '')
      .replace(/@([^\s@]+)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trimStart()
  }, [])

  const findActiveMention = useCallback((value: string, cursor: number) => {
    let index = cursor - 1
    while (index >= 0 && !/\s/.test(value[index])) {
      index -= 1
    }
    const start = Math.max(0, index + 1)
    if (start < value.length && value[start] === '@') {
      const end = cursor
      const query = value.slice(start + 1, end)
      return { start, end, query }
    }
    return null
  }, [])

  const contextMatches = useMemo(() => {
    if (!contextMenuOpen) return []
    if (!contextQuery.trim()) {
      return projectFiles.slice(0, MAX_CONTEXT_RESULTS)
    }
    const needle = contextQuery.trim().toLowerCase()
    const filtered = projectFiles.filter((filePath) => filePath.toLowerCase().includes(needle))
    return filtered.slice(0, MAX_CONTEXT_RESULTS)
  }, [contextMenuOpen, projectFiles, contextQuery])

  const formatTokens = (value?: number) => {
    if (value === undefined || value === null) return ''
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
    if (value >= 10_000) return `${Math.round(value / 1_000)}k`
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
    return String(Math.round(value))
  }

// -- helpers ----------------------------------------------------------------
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(200, Math.max(36, el.scrollHeight))
    el.style.height = `${next}px`
  }, [])

  const updateMentionState = useCallback(
    (value: string, cursor?: number | null) => {
      if (cursor === null || cursor === undefined) {
        if (!contextMenuManual) {
          setActiveMention(null)
          setContextMenuOpen(false)
          setContextQuery('')
          setShowAgents(false)
        }
        return
      }

      const mention = findActiveMention(value, cursor)
      if (mention) {
        setActiveMention(mention)
        setContextQuery(mention.query)
        setContextMenuManual(false)
        setContextMenuOpen(true)
        setContextHighlight(0)

        const normalized = mention.query.toLowerCase()
        const shouldShowAgents =
          normalized.length > 0 && agents.some((agent) => agent.id.toLowerCase().startsWith(normalized))
        setShowAgents(shouldShowAgents)
      } else if (!contextMenuManual) {
        setActiveMention(null)
        setContextMenuOpen(false)
        setContextQuery('')
        setShowAgents(false)
      }
    },
    [contextMenuManual, findActiveMention, agents]
  )

  const updateInputValue = useCallback(
    (value: string, cursor?: number | null) => {
      setInput(value)
      adjustTextareaHeight()
      updateMentionState(value, cursor ?? value.length)
    },
    [adjustTextareaHeight, updateMentionState]
  )

  const applyContextToken = useCallback(
    (token: string, options?: { mention?: { start: number; end: number }; focus?: boolean }) => {
      const { mention, focus = true } = options ?? {}
      setContextTokens((prev) => (prev.includes(token) ? prev : [...prev, token]))

      let base = input
      if (mention) {
        base = input.slice(0, mention.start) + input.slice(mention.end)
      }
      base = stripContextTokens(base)
      base = base.replace(/\s{2,}/g, ' ').trim()
      const next = base.length ? `${base} ` : ''

      setActiveMention(null)
      setShowAgents(false)
      setContextMenuOpen(false)
      setContextMenuManual(false)
      updateInputValue(next, next.length)

      if (focus) {
        setTimeout(() => textareaRef.current?.focus(), 0)
      }
    },
    [input, stripContextTokens, updateInputValue]
  )


  useEffect(() => {
    adjustTextareaHeight()
  }, [adjustTextareaHeight, input])

useEffect(() => {
  try { localStorage.setItem('codex:selected-model', selectedModel) } catch {}
}, [selectedModel])

useEffect(() => {
  const preferred = appSettings.defaultModelId
  if (!preferred || previousDefaultModelRef.current === preferred) return
  previousDefaultModelRef.current = preferred
  if (CODEX_MODELS.some((model) => model.id === preferred)) {
    setSelectedModel(preferred)
    try { localStorage.setItem('codex:selected-model', preferred) } catch {}
  }
}, [appSettings.defaultModelId])

  useEffect(() => {
    setCodexSelection({ modelId: selectedModel })
  }, [selectedModel, setCodexSelection])

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
  setCodexSelection({ modeId: option.id })
}, [selectedMode, setAutoAccept, setCodexSelection])

useEffect(() => {
  const preferred = appSettings.defaultModeId
  if (!preferred || previousDefaultModeRef.current === preferred) return
  previousDefaultModeRef.current = preferred
  if (MODE_OPTIONS.some((opt) => opt.id === preferred)) {
    setSelectedMode(preferred)
    try { localStorage.setItem('codex:selected-mode', preferred) } catch {}
  }
}, [appSettings.defaultModeId])

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
        const payload = ev as any
        if (!payload) return
        const eventSessionId = typeof payload.sessionId === 'string' ? (payload.sessionId as string) : undefined
        const targetSessionId = eventSessionId || sessionId
        const data = { ...payload } as SessionEvent & { sessionId?: string }
        delete (data as any).sessionId
        if (targetSessionId !== sessionId) {
          queueSessionEvent(targetSessionId, data)
          return
        }
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
        const payload = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined
        const eventSessionId = typeof payload?.sessionId === 'string' ? (payload.sessionId as string) : undefined
        const targetSessionId = eventSessionId || sessionId
        const message = typeof payload?.message === 'string' ? (payload.message as string) : undefined
        const text = message || (typeof raw === 'string' ? raw : JSON.stringify(raw))
        if (!text) return

        if (targetSessionId !== sessionId) {
          queueSessionEvent(targetSessionId, { id: String(Date.now()), type: 'message', role: 'assistant', text, ts: Date.now() } as any)
          return
        }

        if (/submission queue closed/i.test(text)) {
          pushEvent({ id: String(Date.now()), type: 'message', role: 'assistant', text: '⚠️ Codex CLI closed the submission queue before responding.', ts: Date.now() } as any)
          setStreaming(false)
          streamEnabledRef.current = false
          return
        }

        if (/saving session/i.test(text) || /completed\.?$/i.test(text.trim())) {
          setStreaming(false)
          streamEnabledRef.current = false
          return
        }

        if (/error|invalid|missing|unauthorized|forbidden|denied|timed out|timeout|failed|not found/i.test(text)) {
          pushEvent({ id: String(Date.now()), type: 'message', role: 'assistant', text: `⚠️ ${text}`, ts: Date.now() } as any)
          setStreaming(false)
          streamEnabledRef.current = false
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
  }, [isStreaming, pushEvent, setStreaming, sessionId])

  const handleTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target
    updateInputValue(value, selectionStart ?? value.length)
  }

  const fallbackContextMention = () => {
    const needsSpace = input.length > 0 && !input.endsWith(' ') && !input.endsWith('@')
    const needsAt = !input.endsWith('@')
    const nextValue = `${input}${needsSpace ? ' ' : ''}${needsAt ? '@' : ''}`
    updateInputValue(nextValue, nextValue.length)
    setShowAgents(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleAddContext = () => {
    if (!(window as any).__TAURI__) {
      fallbackContextMention()
      return
    }

    if (!hasProject) {
      fallbackContextMention()
      return
    }

    setShowAgents(false)
    setContextMenuOpen((prev) => {
      const next = !prev
      if (next) {
        setContextMenuManual(true)
        setContextQuery('')
        setContextHighlight(0)
        setTimeout(() => contextSearchRef.current?.focus(), 0)
      } else {
        setContextMenuManual(false)
      }
      return next
    })
  }

  const handleSelectContext = (relativePath: string) => {
    const token = contextTokenForPath(relativePath)
    if (activeMention) {
      applyContextToken(token, { mention: activeMention })
    } else {
      applyContextToken(token)
    }
  }

  const handleContextKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!contextMenuOpen) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!contextMatches.length) return
      setContextHighlight((prev) => {
        const next = prev + 1
        return next >= contextMatches.length ? contextMatches.length - 1 : next
      })
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!contextMatches.length) return
      setContextHighlight((prev) => (prev <= 0 ? 0 : prev - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const targetPath = contextMatches[contextHighlight] ?? contextMatches[0]
      if (targetPath) {
        handleSelectContext(targetPath)
      }
    }
    if (event.key === 'Escape') {
      setContextMenuOpen(false)
      setContextMenuManual(false)
      contextButtonRef.current?.focus()
    }
  }

  const removeContextToken = useCallback(
    (token: string) => {
      setContextTokens((prev) => prev.filter((t) => t !== token))
      const cleaned = stripContextTokens(input).replace(/\s{2,}/g, ' ').trim()
      const next = cleaned.length ? `${cleaned} ` : ''
      updateInputValue(next, next.length)
    },
    [input, stripContextTokens, updateInputValue]
  )

  useEffect(() => {
    if (!contextMenuOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (contextMenuRef.current?.contains(target)) return
      if (contextButtonRef.current?.contains(target)) return
      setContextMenuOpen(false)
      setContextMenuManual(false)
      setActiveMention(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [contextMenuOpen])

  useEffect(() => {
    if (!contextMenuOpen) return
    if (!contextMatches.length) {
      setContextHighlight(-1)
      return
    }
    setContextHighlight((prev) => {
      if (prev < 0) return 0
      if (prev >= contextMatches.length) return contextMatches.length - 1
      return prev
    })
  }, [contextMenuOpen, contextMatches])

  useEffect(() => {
    if (!hasProject) {
      setContextMenuOpen(false)
      setContextMenuManual(false)
      setActiveMention(null)
    }
  }, [hasProject])

  useEffect(() => {
    if (activeMention) {
      setContextQuery(activeMention.query)
      setContextMenuManual(false)
      setContextMenuOpen(true)
      setContextHighlight(0)
    } else if (!contextMenuManual) {
      setContextMenuOpen(false)
      setContextQuery('')
    }
  }, [activeMention, contextMenuManual])

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
    if ((rawText.length === 0 && contextTokens.length === 0 && attachedImages.length === 0) || isStreaming) {
      return
    }

    const cleanText = rawText.replace(/^@codex(?=[\s:.,-]|$)[\s:.,-]*/i, '').trim()
    const tokensText = contextTokens.join(' ')
    const combinedText = [cleanText, tokensText].filter(Boolean).join(cleanText && tokensText ? ' ' : '')
    const content: any[] = []
    if (combinedText) {
      content.push({ type: 'text', text: combinedText })
    }
    attachedImages.forEach(img => {
      content.push({ type: 'image', url: img.url, name: img.name })
    })

    setInput('')
    setAttachedImages([])
    setContextTokens([])
    setShowAgents(false)
    setShowModelMenu(false)
    // no-op; popover closes

    const userEvent = {
      id: String(Date.now()),
      type: 'message',
      role: 'user',
      text: combinedText || tokensText || '[Image]',
      content,
      ts: Date.now(),
      model: currentModel.slug
    } as any
    pushEvent(userEvent)

    const streamMessageId = `assistant-${Date.now()}`
    streamEnabledRef.current = true
    setStreaming(true, currentModel.slug, streamMessageId)

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

    let messageText = combinedText
    if (imagePaths.length > 0) {
      messageText = `${combinedText} ${imagePaths.join(' ')}`.trim()
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
      if ((window as any).__TAURI__) {
        console.log('[Composer] invoking start_codex before send')
        await tauriInvoke('start_codex', { sessionId: sessionId, projectDir: projectDir || '' }).catch((err: unknown) => {
          console.error('Failed to start Codex:', err)
        })
      }
      await tauriInvoke('send_to_codex', { sessionId: sessionId, input: JSON.stringify(payload) })
    } catch (err) {
      console.error('Failed to invoke Codex:', err)
      setStreaming(false)
      streamEnabledRef.current = false
    }
  }

  const handleStop = async () => {
    try {
      await tauriInvoke('interrupt_codex', { sessionId: sessionId })
    } catch (err) {
      console.error('Failed to interrupt Codex:', err)
    } finally {
      setStreaming(false)
      streamEnabledRef.current = false
      useSession.getState().setStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (contextMenuOpen && activeMention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (!contextMatches.length) return
        setContextHighlight((prev) => {
          const next = prev + 1
          return next >= contextMatches.length ? contextMatches.length - 1 : next
        })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (!contextMatches.length) return
        setContextHighlight((prev) => (prev <= 0 ? 0 : prev - 1))
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const targetPath = contextMatches[contextHighlight] ?? contextMatches[0]
        if (targetPath) {
          handleSelectContext(targetPath)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setActiveMention(null)
        setContextMenuOpen(false)
        return
      }
    }

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
              <div className="add-context-wrapper">
                <button
                  type="button"
                  className="add-context-btn"
                  onClick={handleAddContext}
                  ref={contextButtonRef}
                  aria-expanded={contextMenuOpen}
                  aria-haspopup="dialog"
                >
                  <span>@</span> Add Context
                </button>
                {contextMenuOpen && (
                  <div className="context-picker" ref={contextMenuRef} role="dialog" aria-label="Add context files">
                    <div className="context-picker-search">
                      <input
                        ref={contextSearchRef}
                        value={contextQuery}
                        onChange={(event) => {
                          setContextQuery(event.target.value)
                          setContextHighlight(0)
                        }}
                        onFocus={() => setContextMenuManual(true)}
                        onKeyDown={handleContextKeyDown}
                        placeholder="Search project files…"
                        autoFocus={contextMenuManual}
                      />
                    </div>
                    <div className="context-picker-results">
                      {!hasProject && (
                        <div className="context-picker-empty">Open a project to attach context files.</div>
                      )}
                      {hasProject && filesLoading && (
                        <div className="context-picker-empty">Loading files…</div>
                      )}
                      {hasProject && !filesLoading && filesError && (
                        <div className="context-picker-empty">{filesError}</div>
                      )}
                      {hasProject && !filesLoading && !filesError && contextMatches.length === 0 && (
                        <div className="context-picker-empty">No matching files.</div>
                      )}
                      {hasProject && !filesLoading && !filesError && contextMatches.length > 0 && (
                        <div className="context-picker-list">
                          {contextMatches.map((path, index) => (
                            <button
                              key={path}
                              type="button"
                              className={`context-picker-item ${index === contextHighlight ? 'is-active' : ''}`}
                              onMouseEnter={() => setContextHighlight(index)}
                              onMouseDown={(event) => {
                                event.preventDefault()
                                handleSelectContext(path)
                              }}
                            >
                              <span className="context-picker-path">{path}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {contextTokens.length > 0 && (
                <div className="context-pills" aria-label="Context files">
                  {contextTokens.map((token) => {
                    const label = token.startsWith('@"') ? token.slice(2, -1) : token.slice(1)
                    return (
                      <div key={`${token}`} className="context-pill">
                        <span className="context-pill-icon">@</span>
                        <span className="context-pill-label" title={label}>{label}</span>
                        <button
                          type="button"
                          className="context-pill-remove"
                          onClick={() => removeContextToken(token)}
                          aria-label={`Remove ${label}`}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
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
              onChange={handleTextareaChange}
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
              <button
                type="button"
                className={`icon-btn ${showTerminal ? 'active' : ''}`}
                title="Toggle terminal"
                onClick={() => setShowTerminal(!showTerminal)}
                aria-pressed={showTerminal}
              >
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

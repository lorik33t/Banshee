import { Paperclip, Command, StopCircle, Sparkles, Zap, Bot, ArrowUp, Mic, Image, Terminal as TerminalIcon, BarChart3 } from 'lucide-react'
import React, { useState, useRef, useEffect } from 'react'
import * as monaco from 'monaco-editor'
import { createPortal } from 'react-dom'
import { useSession } from '../state/session'
import { ModelRouter } from '../utils/modelRouter'
import { parseClaudeEvents, clearDeduplicationCache } from '../utils/claudeParser'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { useSettings } from '../state/settings'
import { UsageStatsModal } from './UsageStatsModal'
import { Editor } from './Editor'

type AgentType = 'claude' | 'gemini' | 'qwen' | 'codex'

const agents = [
  { 
    id: 'claude', 
    name: 'Claude', 
    icon: Bot, 
    color: '#0891b2', 
    description: 'Advanced reasoning & coding'
  },
  { 
    id: 'gemini', 
    name: 'Gemini', 
    icon: Sparkles, 
    color: '#8b5cf6', 
    description: 'Fast & versatile • Free tier available'
  },
  { 
    id: 'qwen', 
    name: 'Qwen', 
    icon: Zap, 
    color: '#f59e0b', 
    description: 'Code specialist • Free tier available'
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: Bot,
    color: '#10b981',
    description: 'OpenAI Codex CLI • Streaming'
  }
]

export function Composer() {
  const [input, setInput] = useState('')
  const [showAgents, setShowAgents] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('claude')
  const [router] = useState(() => new ModelRouter())
  const [isFocused, setIsFocused] = useState(false)
  const [attachedImages, setAttachedImages] = useState<Array<{ url: string; name: string }>>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pushEvent = useSession((s) => s.pushEvent)
  // Only enable reacting to stream events after an explicit send
  const streamEnabledRef = useRef<boolean>(false)
  const setShowTerminal = useSession((s) => s.setShowTerminal)
  const showTerminal = useSession((s) => s.showTerminal)
  const [showStats, setShowStats] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [recentlyUsed, setRecentlyUsed] = useState<AgentType[]>([])
  const pickerBtnRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<HTMLButtonElement[]>([])
  const optionsRef = useRef<typeof agents[number][]>([])
  const [activeOption, setActiveOption] = useState(-1)
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const messages = useSession((s) => s.messages)
  const isStreaming = useSession((s) => s.isStreaming)
  const setStreaming = useSession((s) => s.setStreaming)
  const projectDir = useSession((s) => s.projectDir)
  // Track which model is currently answering and whether usage was recorded for this turn
  const [activeModel, setActiveModel] = useState<AgentType | null>(null)
  const [, setUsageCounted] = useState(false)
  // Autopilot orchestration removed in first ship; refs unused
  const appSettings = useSettings((s) => s.settings)

  // Auto-resize textarea removed for Monaco editor

  // Recalculate picker position when open/resize/scroll
  useEffect(() => {
    if (!showAgentPicker) return
    const calc = () => {
      const btn = pickerBtnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setPickerPos({ left: r.left, top: r.top, width: r.width })
    }
    calc()
    window.addEventListener('resize', calc)
    window.addEventListener('scroll', calc, true)
    return () => {
      window.removeEventListener('resize', calc)
      window.removeEventListener('scroll', calc, true)
    }
  }, [showAgentPicker])

  // Close picker on outside click
  useEffect(() => {
    if (!showAgentPicker) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (pickerBtnRef.current && pickerBtnRef.current.contains(target)) return
      const menu = document.getElementById('agent-picker-portal')
      if (menu && menu.contains(target)) return
      setShowAgentPicker(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [showAgentPicker])

  // Manage focus within agent picker
  useEffect(() => {
    if (showAgentPicker) {
      setActiveOption(-1)
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [showAgentPicker])

  useEffect(() => {
    setActiveOption(-1)
  }, [searchQuery])

  const q = searchQuery.trim().toLowerCase()
  const matches = (a: typeof agents[number]) =>
    !q || a.id.includes(q) || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
  const filteredAll = agents.filter(matches)
  const filteredRecent = recentlyUsed
    .map(id => agents.find(a => a.id === id)!)
    .filter(a => !!a && matches(a))
  const rest = filteredAll.filter(a => !filteredRecent.some(r => r.id === a.id))
  optionsRef.current = [...filteredRecent, ...rest]
  optionRefs.current = []
  const activeId = activeOption >= 0 && optionsRef.current[activeOption]
    ? `agent-option-${optionsRef.current[activeOption].id}`
    : undefined

  const renderOption = (agent: typeof agents[number], index: number) => (
    <button
      key={agent.id}
      id={`agent-option-${agent.id}`}
      role="option"
      tabIndex={-1}
      aria-selected={activeOption === index}
      ref={el => (optionRefs.current[index] = el)}
      className="agent-option"
      onClick={() => chooseAgentFromPicker(agent.id as AgentType)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 10px',
        borderRadius: 6,
        background: selectedAgent === agent.id ? 'var(--bg-tertiary)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--fg-primary)'
      }}
    >
      {React.createElement(agent.icon, { size: 18, style: { color: agent.color } })}
      <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>@{agent.id}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>{agent.description}</div>
      </div>
    </button>
  )

  // Handle image paste on the textarea
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
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

  // Listen for model stream events (claude, gemini, qwen) – only set up once on mount
  useEffect(() => {
    let mounted = true
    const models = ['claude', 'gemini', 'qwen', 'codex'] as const
    const unlistenFns: Array<() => void> = []

    const handleStreamPayload = (event: any, model: AgentType) => {
      try {
        const payload = event?.payload
        if (import.meta.env.DEV) {
          try { console.debug('[Composer] stream raw:', payload) } catch {}
        }
        const events = parseClaudeEvents(payload)
        if (import.meta.env.DEV) {
          try {
            console.debug(`[Composer] parsed ${events.length} events:`, events.map((e: any) => e.type))
            if (events.length === 0) {
              console.warn('[Composer] parse yielded 0 events for payload:', payload)
            }
          } catch {}
        }
        for (const ev of events) {
          // Tag events with their source model so tool tiles can indicate which agent ran them
          if ((ev as any) && typeof (ev as any) === 'object') {
            (ev as any).agent = model
          }
          if (ev.type === 'assistant:delta') {
            if (mounted && !isStreaming) {
              // Set streaming with the active model if we haven't already
              setStreaming(true, activeModel || undefined)
            }
            pushEvent(ev as any)
          } else if (ev.type === 'assistant:complete') {
            if (mounted) {
              setStreaming(false)
              streamEnabledRef.current = false
              setActiveModel(null)
              setUsageCounted(false)
            }
            pushEvent(ev as any)
          } else if (ev.type === 'message' && (ev as any).role === 'assistant') {
            if (mounted) {
              setStreaming(false)
              streamEnabledRef.current = false
              setActiveModel(null)
              setUsageCounted(false)
            }
            pushEvent(ev as any)
          } else if (ev.type === 'cost:update') {
            pushEvent(ev as any)
          } else {
            pushEvent(ev as any)
          }
        }
      } catch (err) {
        console.error('Error handling stream event:', err)
      }
    }

    // Do not toggle streaming off on stderr lines — many CLIs (Qwen/Gemini)
    // emit benign logs on stderr. We'll rely on assistant:complete or process
    // termination to end the loader. Keep this listener only to avoid leaking.
    const handleError = (ev?: any) => {
      try {
        const raw = (ev && (ev.payload ?? ev)) || ''
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
        if (text && /error|invalid|missing|unauthorized|forbidden|denied|timed out|timeout/i.test(text)) {
          // Surface as assistant message so user sees why model stalled
          pushEvent({ id: String(Date.now()), type: 'message', role: 'assistant', text: `⚠️ ${text}`, ts: Date.now() } as any)
          setStreaming(false)
        }
      } catch {}
    }

    models.forEach((model) => {
      // Stream listeners (pass model to handler)
      tauriListen(`${model}:stream`, (e: any) => handleStreamPayload(e, model as any)).then((u: any) => {
        if (mounted) unlistenFns.push(u)
      })
      // Error listeners
      tauriListen(`${model}:error`, handleError).then((u: any) => {
        if (mounted) unlistenFns.push(u)
      })
    })

    return () => {
      mounted = false
      unlistenFns.forEach((fn) => fn && fn())
    }
  }, []) // Empty dependency array – only run once on mount

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && attachedImages.length === 0) || isStreaming) return
    
    // Unified handling for /compress command
    if (text === '/compress') {
      try {
        const { model: chosenModel, reason } = router.selectModelWithReason(text, selectedAgent as any)
        if (import.meta.env.DEV) {
          try { console.debug('[Composer] /compress routing -> model:', chosenModel, 'reason:', reason) } catch {}
        }
        // Push a user message with routing badge fields
        pushEvent({
          id: String(Date.now()),
          type: 'message',
          role: 'user',
          text: '/compress',
          content: [{ type: 'text', text: '/compress' }],
          ts: Date.now(),
          model: chosenModel,
          routingReason: reason
        } as any)
        setStreaming(true, chosenModel as any)
        // Track active model for this turn; reset usage flag
        setActiveModel(chosenModel as AgentType)
        setUsageCounted(false)
        if (import.meta.env.DEV) {
          try { console.debug('[Composer] invoking send_to_model for /compress with model:', chosenModel) } catch {}
        }
        await tauriInvoke('send_to_model', {
          input: '/compress',
          model: chosenModel.toLowerCase()
        })
      } catch (err) {
        // Fallback to Claude
        if (import.meta.env.DEV) {
          try { console.warn('[Composer] /compress route failed, falling back to Claude. Error:', err) } catch {}
        }
        try {
          setStreaming(true, 'claude')
          streamEnabledRef.current = true
          await tauriInvoke('send_to_model', { input: '/compress', model: 'claude' })
        } catch (_e) {
          // ignore
        } finally {
          setStreaming(false)
          streamEnabledRef.current = false
        }
      }
      setInput('')
      return
    }

    // Special handling for /clear command
    if (text === '/clear') {
      // Send /clear directly to Claude to reset conversation
      try {
        setStreaming(true, 'claude')
        streamEnabledRef.current = true
        await tauriInvoke('send_to_model', { 
          input: '/clear', 
          model: 'claude' 
        })
        // Clear deduplication caches in the parser
        clearDeduplicationCache()
        // Clear UI state after sending /clear
        const sessionStore = useSession.getState()
        sessionStore.clearConversation()
        setInput('')
        return
      } catch (err) {
        console.error('Failed to send /clear command:', err)
      } finally {
        setStreaming(false)
        streamEnabledRef.current = false
      }
    }
    
    // Check for @agent mentions and extract agent
    let agent = selectedAgent
    let cleanText = text
    // Accept optional punctuation like ".", ":", ",", "-" after the model, then any spaces
    // Examples: "@qwen hello", "@qwen. hello", "@gemini: do x", "@codex- run"
    const mentionMatch = text.match(/^@(claude|gemini|qwen|codex)(?=[\s:.,-]|$)[\s:.,-]*/i)
    const mentionForced = !!mentionMatch
    if (mentionMatch) {
      agent = mentionMatch[1].toLowerCase() as AgentType
      cleanText = text.slice(mentionMatch[0].length)
    }
    
    // Build content array with text and images
    const content: any[] = []
    if (cleanText) {
      content.push({ type: 'text', text: cleanText })
    }
    attachedImages.forEach(img => {
      content.push({ type: 'image', url: img.url, name: img.name })
    })

    // We'll push the user message after routing is determined so we can attach a routing badge
    setInput('')
    setAttachedImages([])
    // Start streaming without locking in a model yet; we will set the
    // exact streaming model after routing decides below.
    setStreaming(true)
    // Show the top progress bar immediately while we route/prepare
    streamEnabledRef.current = true
    // Optimistically reflect the chosen agent (toolbar or @mention) in the UI glow/bar color
    // This will be corrected below if the router selects a different model
    if (agent) {
      setActiveModel(agent as AgentType)
    }
    setShowAgents(false)
    
    // Checkpointing disabled for first ship
    
    // Save images to temp files and get paths
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
    
    // Prepare message with image paths for Claude CLI
    let messageText = cleanText
    if (imagePaths.length > 0) {
      // Claude CLI expects image paths to be passed as arguments
      // Format: "message text" /path/to/image1 /path/to/image2
      messageText = `${cleanText} ${imagePaths.join(' ')}`
    }

    // Load optional project memory from common files (best-effort, non-blocking if fails)
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
          // eslint-disable-next-line no-await-in-loop
          const txt = await readTextFile(p)
          if (txt && txt.trim().length > 0) { memoryText = txt; break }
        } catch (_) { /* ignore */ }
      }
    }

    // Build composed prompt with memory + short recent history for cross-model context
    const buildComposedPrompt = (recentMessages: typeof messages, userText: string, memory?: string) => {
      const MAX_TURNS = 10 // ~last 10 message events
      const history = recentMessages
        .slice(-MAX_TURNS)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n')
      const sections: string[] = [
        'System: You are an AI coding assistant. Continue the conversation based on the context below. Keep responses concise unless asked otherwise.'
      ]
      // Autopilot mode removed
      if (memory && memory.trim().length > 0) {
        sections.push('--- Project Memory ---')
        sections.push(memory.trim())
      }
      sections.push('--- Conversation (recent) ---')
      sections.push(history || '[No prior messages]')
      const composed = `${sections.join('\n')}\n\nUser: ${userText}\nAssistant:`
      return composed
    }

    const composedPrompt = buildComposedPrompt(messages, messageText, memoryText)

    // Send only the current message - Claude -c flag maintains history
    try {
      // If the user explicitly typed an @mention, force that model without router checks
      if (mentionForced) {
        const chosenModel = agent
        const reason = `User-forced @${agent}`
        if (import.meta.env.DEV) {
          try { console.debug('[Composer] forcing model via @mention ->', chosenModel, 'reason:', reason) } catch {}
        }
        const userEvent = {
          id: String(Date.now()),
          type: 'message',
          role: 'user',
          text: cleanText || '[Image]',
          content: content,
          ts: Date.now(),
          model: chosenModel,
          routingReason: reason
        } as any
        pushEvent(userEvent)
        setStreaming(true, chosenModel as any)
        setActiveModel(chosenModel as AgentType)
        setUsageCounted(false)
        streamEnabledRef.current = true
        if (import.meta.env.DEV) {
          try { console.debug('[Composer] invoking send_to_model with model:', chosenModel, 'len(input):', messageText.length) } catch {}
        }
        {
          const payload: any = { currentMessage: composedPrompt }
          if (chosenModel === 'codex') {
            const codexCfg = appSettings?.agents?.codex || {}
            payload.codexOptions = {
              displayMode: (codexCfg as any).displayMode || 'clean',
              showReasoning: (codexCfg as any).showReasoning !== false
            }
          }
          await tauriInvoke('send_to_model', { input: JSON.stringify(payload), model: chosenModel.toLowerCase() })
        }
        return
      }

      // If no @mention, force the toolbar-selected agent directly
      if (agent) {
        const chosenModel = agent
        const reason = `User-selected model: ${agent}`
        if (import.meta.env.DEV) {
          try { console.debug('[Composer] forcing model via selector ->', chosenModel, 'reason:', reason) } catch {}
        }
        const userEvent = {
          id: String(Date.now()),
          type: 'message',
          role: 'user',
          text: cleanText || '[Image]',
          content: content,
          ts: Date.now(),
          model: chosenModel,
          routingReason: reason
        } as any
        pushEvent(userEvent)
        setStreaming(true, chosenModel as any)
        setActiveModel(chosenModel as AgentType)
        setUsageCounted(false)
        streamEnabledRef.current = true
        if (import.meta.env.DEV) {
          try { console.debug('[Composer] invoking send_to_model with model (selector):', chosenModel, 'len(input):', messageText.length) } catch {}
        }
        await tauriInvoke('send_to_model', {
          input: JSON.stringify({ currentMessage: composedPrompt }),
          model: chosenModel.toLowerCase()
        })
        return
      }

      // If Autopilot, proactively run a helpful subagent before Claude synthesizes
      if (agent === 'autopilot') {
        try {
          const text = (cleanText || '').toLowerCase()
          let subModel: any = null
          if (/(read|scan|summariz(e|e this)|sweep|overview)/.test(text) || /codebase|repo|files/.test(text)) subModel = 'gemini'
          else if (/(refactor|rename|bulk|migrate|apply patch|create tests|run (commands|script))/.test(text)) subModel = 'qwen'
          else if (/(plan|architecture|trade[-\s]?offs|deep (analysis|reason))/.test(text)) subModel = 'codex'
          if (subModel) {
            const subPayload: any = { currentMessage: cleanText || messageText }
            if (subModel === 'codex') {
              try {
                const settings = (window as any).useSettings?.getState?.().settings || {}
                const codexCfg = settings?.agents?.codex || {}
                subPayload.codexOptions = {
                  displayMode: codexCfg.displayMode || 'clean',
                  showReasoning: codexCfg.showReasoning !== false
                }
              } catch {}
            }
            tauriInvoke('send_to_model', { input: JSON.stringify(subPayload), model: subModel.toLowerCase() })
          }
        } catch {}
      }

      // Otherwise, let the router pick the model respecting enabled/auth flags, quotas, and reserves
      const { model: chosenModel, reason } = router.selectModelWithReason(messageText, undefined)
      if (import.meta.env.DEV) {
        try { console.debug('[Composer] routing -> model:', chosenModel, 'reason:', reason, 'agent requested:', agent) } catch {}
      }
      // Now add user message with routing badge fields (mark as Autopilot when selected)
      const userEvent = { 
        id: String(Date.now()), 
        type: 'message', 
        role: 'user', 
        text: cleanText || '[Image]',
        content: content,
        ts: Date.now(),
        model: chosenModel,
        routingReason: reason
      } as any
      pushEvent(userEvent)
      // Now that routing finalized the model, record it for streaming so
      // assistant messages get the correct badge and routing attribution.
      setStreaming(true, chosenModel as any)
      // Track active model for this turn; reset usage flag
      setActiveModel(chosenModel as AgentType)
      setUsageCounted(false)
      // Set streaming state so loader appears immediately
      setStreaming(true, chosenModel as any)
      // Enable stream handling for this turn and send to backend
      streamEnabledRef.current = true
      if (import.meta.env.DEV) {
        try { console.debug('[Composer] invoking send_to_model with model:', chosenModel, 'len(input):', messageText.length) } catch {}
      }
      {
        const payload: any = { currentMessage: composedPrompt }
        if (chosenModel === 'codex') {
          const codexCfg = appSettings?.agents?.codex || {}
          payload.codexOptions = {
            displayMode: (codexCfg as any).displayMode || 'clean',
            showReasoning: (codexCfg as any).showReasoning !== false
          }
        }
        await tauriInvoke('send_to_model', { input: JSON.stringify(payload), model: chosenModel.toLowerCase() })
      }
    } catch (err) {
      // Fallback to Claude if non-Claude route failed
      if (selectedAgent !== 'claude') {
        if (import.meta.env.DEV) {
          try { console.warn('[Composer] primary route failed, falling back to Claude. Error:', err) } catch {}
        }
        try {
          // Update streaming to show Claude is now processing
          setStreaming(true, 'claude')
          await tauriInvoke('send_to_model', { 
            input: JSON.stringify({ 
              currentMessage: buildComposedPrompt(messages, messageText)
            }), 
            model: 'claude' 
          })
        } catch (_fallbackErr) {
          if (import.meta.env.DEV) {
            try { console.error('[Composer] Claude fallback also failed:', _fallbackErr) } catch {}
          }
          setStreaming(false)
        }
      } else {
        setStreaming(false)
      }
    }
  }

  const handleStop = async () => {
    try {
      // Prefer stopping the active streaming model if known
      const state = useSession.getState()
      const model = (state.streamingModel as any) || (activeModel as any) || 'claude'
      if (model) {
        await tauriInvoke('stop_model', { model: String(model).toLowerCase() })
      } else {
        await tauriInvoke('stop_claude')
      }
      setStreaming(false)
      streamEnabledRef.current = false
      // Clear any stuck streaming state in the session
      const sessionStore = useSession.getState()
      sessionStore.setStreaming(false)
    } catch (_err) {
      // Even if stop fails, clear the UI state
      setStreaming(false)
      streamEnabledRef.current = false
      const sessionStore = useSession.getState()
      sessionStore.setStreaming(false)
    }
  }

  const handleKeyDown = (e: monaco.IKeyboardEvent) => {
    if (e.keyCode === monaco.KeyCode.Enter && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  const handleInputChange = (value: string) => {
    setInput(value)
    const inProgressMention = /@([a-z]*)$/i.test(value)
    if (inProgressMention) {
      setShowAgents(true)
    } else if (!value.includes('@') || value.match(/@(claude|gemini|qwen|codex)\s/i)) {
      setShowAgents(false)
    }
  }

  const selectAgent = (agentId: AgentType) => {
    setSelectedAgent(agentId)
    setShowAgents(false)
    setInput(`@${agentId} `)
  }

  // Picker in toolbar: only set default agent; do not modify input
  const chooseAgentFromPicker = (agentId: AgentType) => {
    setSelectedAgent(agentId)
    setRecentlyUsed((prev) => {
      const next = [agentId, ...prev.filter((id) => id !== agentId)]
      return next.slice(0, 5)
    })
    setShowAgentPicker(false)
    setSearchQuery('')
    setActiveOption(-1)
    setTimeout(() => pickerBtnRef.current?.focus(), 0)
  }

  const handlePickerKeyDown = (e: React.KeyboardEvent) => {
    const opts = optionsRef.current
    if (e.key === 'ArrowDown') {
      if (opts.length === 0) return
      e.preventDefault()
      const next = (activeOption + 1) % opts.length
      setActiveOption(next)
      optionRefs.current[next]?.focus()
    } else if (e.key === 'ArrowUp') {
      if (opts.length === 0) return
      e.preventDefault()
      const prev = (activeOption - 1 + opts.length) % opts.length
      setActiveOption(prev)
      optionRefs.current[prev]?.focus()
    } else if (e.key === 'Enter') {
      if (activeOption >= 0 && opts[activeOption]) {
        e.preventDefault()
        chooseAgentFromPicker(opts[activeOption].id as AgentType)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setShowAgentPicker(false)
      setSearchQuery('')
      setActiveOption(-1)
      setTimeout(() => pickerBtnRef.current?.focus(), 0)
    }
  }

  const currentAgent = agents.find(a => a.id === selectedAgent)!

  // Error boundary to avoid whole-app crash from modal
  class ModalErrorBoundary extends React.Component<{ onRecover: () => void; children: React.ReactNode }, { hasError: boolean; message?: string }> {
    constructor(props: any) {
      super(props)
      this.state = { hasError: false, message: undefined }
    }
    static getDerivedStateFromError(error: any) {
      return { hasError: true, message: error?.message || 'Modal error' }
    }
    componentDidCatch(error: any, info: any) {
      try { console.error('[UsageStatsModal] crashed:', error, info) } catch {}
    }
    render() {
      if (this.state.hasError) {
        return (
          <div role="dialog" aria-modal="true" onClick={this.props.onRecover} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: '92vw', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Usage stats</div>
              <div style={{ fontSize: 13, color: 'var(--fg-secondary)' }}>Failed to render usage stats modal.</div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="settings-btn primary" style={{ height: 32 }} onClick={this.props.onRecover}>Close</button>
              </div>
            </div>
          </div>
        )
      }
      return this.props.children as any
    }
  }

return (
<div className="composer">
  {/* Per-model streaming animations */}
  <style>{`
    @keyframes subtle-glow { 0%{box-shadow: 0 0 0 rgba(0,0,0,0)} 50%{box-shadow: 0 0 24px var(--glow-color)} 100%{box-shadow: 0 0 0 rgba(0,0,0,0)} }
    .composer-box.model-claude { --glow-color: rgba(8,145,178,0.25); animation: subtle-glow 2.4s ease-in-out infinite }
    .composer-box.model-gemini { --glow-color: rgba(139,92,246,0.25); animation: subtle-glow 2.4s ease-in-out infinite }
    .composer-box.model-qwen { --glow-color: rgba(245,158,11,0.25); animation: subtle-glow 2.4s ease-in-out infinite }
    .composer-box.model-codex { --glow-color: rgba(16,185,129,0.25); animation: subtle-glow 2.4s ease-in-out infinite }
  `}</style>
  <div className="composer-container">
    <div 
      className={`composer-box ${isFocused ? 'focused' : ''} ${input ? 'has-content' : ''} ${isDragging ? 'dragging' : ''} model-${(activeModel || selectedAgent)}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showAgents && (
        <div className="agent-menu">
          {agents.map(agent => {
            const Icon = agent.icon
            return (
              <button
                key={agent.id}
                className="agent-option"
                onClick={() => selectAgent(agent.id as AgentType)}
                onMouseDown={(e) => e.preventDefault()} // Prevent blur
              >
                <Icon size={20} style={{ color: agent.color }} />
                <div className="agent-info">
                  <div className="agent-name">@{agent.id}</div>
                  <div className="agent-desc">{agent.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
      
      <div className="composer-toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" title="Attach files">
            <Paperclip size={18} />
          </button>
          <button 
            className="toolbar-btn" 
            title="Add image"
            onClick={() => fileInputRef.current?.click()}
          >
            <Image size={18} />
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
          <button className="toolbar-btn" title="Voice input">
            <Mic size={18} />
          </button>
          <button 
            className={`toolbar-btn ${showTerminal ? 'active' : ''}`} 
            title="Toggle terminal (⌘T)"
            onClick={() => setShowTerminal(!showTerminal)}
          >
            <TerminalIcon size={18} />
          </button>
          <div className="toolbar-divider" />
          {/* Agent picker (persistent model selector) */}
          <div className="agent-picker" style={{ position: 'relative' }}>
            <button
              className={`toolbar-btn ${showAgentPicker ? 'active' : ''}`}
              title="Choose model"
              ref={pickerBtnRef}
              onClick={() => { setShowAgentPicker(v => !v); setSearchQuery('') }}
            >
              {React.createElement(currentAgent.icon, { size: 18, style: { color: currentAgent.color } })}
              <span className="toolbar-label" style={{ color: currentAgent.color, fontWeight: 600 }}>{currentAgent.name}</span>
            </button>
            {showAgentPicker && pickerPos && createPortal(
              (
                <div
                  id="agent-picker-portal"
                  style={{
                    position: 'fixed',
                    left: Math.round(pickerPos.left),
                    top: Math.round(pickerPos.top),
                    transform: 'translateY(-8px) translateY(-100%)',
                    zIndex: 10000
                  }}
                >
                  <div
                    className="agent-picker-menu"
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                      padding: 6,
                      minWidth: Math.max(260, Math.round(pickerPos.width)) ,
                      maxHeight: 360,
                      overflowY: 'auto'
                    }}
                    onKeyDown={handlePickerKeyDown}
                  >
                    {/* Search input */}
                    <div style={{ padding: 6 }}>
                      <input
                        type="text"
                        value={searchQuery}
                        ref={searchInputRef}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search models…"
                        style={{
                          width: '100%',
                          height: 30,
                          borderRadius: 6,
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--fg-primary)',
                          padding: '0 10px',
                          outline: 'none'
                        }}
                        aria-controls="agent-picker-listbox"
                        aria-activedescendant={activeId}
                      />
                    </div>
                    <div
                      id="agent-picker-listbox"
                      role="listbox"
                      aria-activedescendant={activeId}
                    >
                      {filteredRecent.length > 0 && (
                        <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--fg-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Recently Used</div>
                      )}
                      {filteredRecent.map((a, i) => renderOption(a, i))}
                      <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--fg-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>All Models</div>
                      {rest.map((a, i) => renderOption(a, i + filteredRecent.length))}
                    </div>
                  </div>
                </div>
              ),
              document.body
            )}
          </div>
          <div className="toolbar-divider" />
          <button className="toolbar-btn" title="Commands">
            <Command size={18} />
            <span className="toolbar-label">Commands</span>
          </button>
          <button 
            className={`toolbar-btn ${showStats ? 'active' : ''}`} 
            title="Usage stats"
            onClick={() => setShowStats(!showStats)}
          >
            <BarChart3 size={18} />
            <span className="toolbar-label">Stats</span>
          </button>
        </div>
      </div>

      <div className={`composer-input-area ${isDragging ? 'drag-over' : ''}`}>
        <Editor
          language="plaintext"
          value={input}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="composer-actions">
          {isStreaming ? (
            <button className="action-btn stop" onClick={handleStop}>
              <StopCircle size={20} />
              <span>Stop</span>
            </button>
          ) : (
            <button 
              className="action-btn send" 
              onClick={handleSend} 
              disabled={!input.trim() && attachedImages.length === 0}
            >
              <ArrowUp size={20} />
            </button>
          )}
        </div>
      </div>

      {attachedImages.length > 0 && (
        <div className="attached-images">
          {attachedImages.map((img, idx) => (
            <div key={idx} className="attached-image">
              <div className="image-preview">
                <img src={img.url} alt={img.name} />
                <button 
                  className="remove-image"
                  onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                  title="Remove image"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <span className="image-name">{img.name}</span>
            </div>
          ))}
        </div>
      )}
      {/* Usage stats modal */}
      {showStats && (
        <ModalErrorBoundary onRecover={() => setShowStats(false)}>
          <UsageStatsModal open={showStats} onClose={() => setShowStats(false)} router={router} />
        </ModalErrorBoundary>
      )}
    </div>
  </div>
</div>
)
}

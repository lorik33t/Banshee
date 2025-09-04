import { create } from 'zustand'
import { saveSession, loadSession, clearSession } from '../utils/sessionPersistence'
import { invoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { clearDeduplicationCache } from '../utils/claudeParser'

export type Role = 'user' | 'assistant'
export type ToolType = 'bash' | 'grep' | 'read' | 'write' | 'web' | 'mcp' | 'task'

export type MessageContent = 
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; name?: string }

export type MessageEvent = {
  id: string
  type: 'message'
  role: Role
  text: string  // Keep for backward compatibility
  content?: MessageContent[]  // New content array for mixed content
  model?: string  // Track which model/subagent was used
  routingReason?: string  // Why the router chose this model (copied from the preceding user message)
  tokens?: { input: number; output: number }  // Per-message token counts
  ts: number
}

export type ToolStartEvent = {
  id: string
  type: 'tool:start'
  tool: ToolType
  args: Record<string, any>
  ts: number
}
export type ToolOutputEvent = {
  id: string
  type: 'tool:output'
  chunk: string
  done?: boolean
  ts: number
}

export type EditProposedEvent = {
  id: string
  type: 'edit:proposed'
  file: string
  before: string
  after: string
  ts: number
}
export type EditStatusEvent = {
  id: string
  type: 'edit:applied' | 'edit:rejected'
  ts: number
}

export type PermissionRequestEvent = {
  id: string
  type: 'permission:request'
  tools: ToolType[]
  scope: 'once' | 'session' | 'project'
  ts: number
}
export type PermissionDecisionEvent = {
  id: string
  type: 'permission:decision'
  allow: boolean
  scope: 'once' | 'session' | 'project'
  ts: number
}

export type CostUpdateEvent = {
  type: 'cost:update'
  usd: number
  tokensIn: number
  tokensOut: number
  ts: number
}

export type ThinkingEvent = {
  id: string
  type: 'thinking'
  text: string
  done: boolean
  ts: number
}

// Checkpoint events from handlers
export type CheckpointCreateEvent = {
  type: 'checkpoint:create'
  trigger?: string
  fileSnapshots?: Array<{ path: string; originalContent?: string; currentContent?: string }>
  ts: number
}

export type CheckpointRecord = {
  id: string
  ts: number
  trigger?: string
  fileCount: number
}

// Telemetry token stats (from Gemini/Qwen handlers)
export type TelemetryTokensEvent = {
  type: 'telemetry:tokens'
  tokensIn: number
  tokensOut: number
  cachedTokens?: number
  thoughtsTokens?: number
  toolTokens?: number
  latencyMs?: number
  ts: number
}

export type SessionEvent =
  | MessageEvent
  | ToolStartEvent
  | ToolOutputEvent
  | EditProposedEvent
  | EditStatusEvent
  | PermissionRequestEvent
  | PermissionDecisionEvent
  | CostUpdateEvent
  | ThinkingEvent
  | CheckpointCreateEvent
  | TelemetryTokensEvent
  | { type: 'assistant:delta'; chunk: string; ts: number }
  | { type: 'assistant:complete'; text: string; ts: number; id?: string }  // allow optional id for source correlation
  | { type: 'model:update'; model?: string; ts: number }
  | { type: 'raw'; payload: any; ts: number }

export type ProposedEdit = {
  id: string
  file: string
  before: string
  after: string
  status: 'proposed' | 'applied' | 'rejected'
}

export type ToolRun = {
  id: string
  tool: ToolType
  args: Record<string, any>
  output: string
  done: boolean
  agent?: string
}

export type SessionState = {
  events: SessionEvent[]
  messages: MessageEvent[]
  tools: Record<string, ToolRun>
  edits: ProposedEdit[]
  checkpoints?: CheckpointRecord[]
  thinking?: { text: string; done: boolean }
  projectDir?: string
  permissions: {
    pending?: PermissionRequestEvent
    decisions: PermissionDecisionEvent[]
  }
  cost: { usd: number; tokensIn: number; tokensOut: number }
  autoAccept: boolean
  selectedEditId?: string
  showTerminal: boolean
  isStreaming: boolean
  streamingStartTime?: number
  streamingModel?: string
  streamingMessageId?: string
  pendingProjectDir?: string
  // File tracking for checkpoints
  fileTracker: {
    originalContents: Map<string, string> // Original file contents before AI changes
    modifiedFiles: Set<string> // Files modified in current AI interaction
    isTracking: boolean
  }
  ui: {
    workbenchTab: 'diffs' | 'checkpoints' | 'debug'
  }

  pushEvent: (e: SessionEvent) => void
  setProjectDir: (dir?: string) => void
  setAutoAccept: (v: boolean) => void
  acceptEdit: (id: string) => void
  rejectEdit: (id: string) => void
  selectEdit: (id?: string) => void
  resolvePermission: (allow: boolean, scope: 'once' | 'session' | 'project') => void
  setWorkbenchTab: (tab: 'diffs' | 'checkpoints' | 'debug') => void
  setShowTerminal: (show: boolean) => void
  setStreaming: (streaming: boolean, model?: string) => void
  clearConversation: () => void
  loadPersistedSession: () => void
  clearSession: () => void
}

export const useSession = create<SessionState>((set, get) => {
  // Don't load on initialization - wait for projectDir to be set
  return {
    events: [],
    messages: [],
    tools: {},
    edits: [],
    checkpoints: [],
    permissions: { decisions: [] },
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    autoAccept: false,
    showTerminal: false,
    isStreaming: false,
    streamingMessageId: undefined,
    pendingProjectDir: undefined,
    fileTracker: {
      originalContents: new Map(),
      modifiedFiles: new Set(),
      isTracking: false
    },
    ui: { workbenchTab: 'diffs' },

  pushEvent: (e) => {
    const state = get()
    const sanitizeOutput = (text: string | undefined, model?: string) => {
      if (!text) return text
      const m = (model || '').toLowerCase()
      // Only sanitize known benign Qwen CLI noise
      if (m.includes('qwen')) {
        const lines = text.split(/\r?\n/)
        const filtered = lines.filter(l => !/loaded cached qwen credentials\.?/i.test(l))
        return filtered.join('\n')
      }
      return text
    }
    if (e.type === 'checkpoint:create') {
      // Persist checkpoint to backend and track in memory
      const id = `cp_${Date.now()}`
      const snaps = (e.fileSnapshots || []).map(s => ({
        path: s.path,
        original_content: s.originalContent ?? '',
        current_content: s.currentContent ?? s.originalContent ?? ''
      }))
      // Fire and forget; do not block UI
      Promise.resolve().then(() => {
        try {
          // @ts-ignore invoke available in Tauri env
          return invoke('save_checkpoint_files', { checkpointId: id, files: snaps, trigger: e.trigger })
        } catch {}
      }).catch(() => {})

      const rec: CheckpointRecord = {
        id,
        ts: e.ts,
        trigger: e.trigger,
        fileCount: snaps.length
      }
      const existing = state.checkpoints || []
      const nextCheckpoints = [rec, ...existing].slice(0, 100)
      const nextEvents = [...state.events, e]
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        checkpoints: nextCheckpoints,
      })
      // Optionally surface the panel
      set((s) => ({ ui: { ...s.ui, workbenchTab: 'checkpoints' } }))
      return
    }
    if (e.type === 'model:update') {
      // Update streamingModel so UI can display the active subagent badge
      set({ streamingModel: e.model })
      const nextEvents = [...state.events, e]
      set({ events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents })
      return
    }
    if (e.type === 'assistant:complete') {
      // Finalize the assistant message for this stream id; create if missing
      const messages = [...state.messages]
      const incomingId = (e as any).id ? String((e as any).id) : undefined
      const streamId = state.streamingMessageId
      const targetId = streamId || incomingId
      let targetIndex = -1
      if (targetId) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant' && messages[i].id === targetId) { targetIndex = i; break }
        }
      }
      if (targetIndex >= 0) {
        const last = messages[targetIndex]
        // Prefer the final text from the completion event to avoid duplicating
        // partial/garbled streaming output (seen with some CLIs like Qwen).
        const finalText = e.text && e.text.length
          ? (sanitizeOutput(e.text, state.streamingModel) as string)
          : (sanitizeOutput(last.text, state.streamingModel) as string)
        const maxPrevTs = Math.max(
          ...state.events.map(ev => ev.ts || 0),
          ...state.messages.map(m => m.ts || 0)
        )
        const updatedTs = maxPrevTs + 1
        // If the final event carries a different id, migrate the message id to it
        const finalId = incomingId || last.id
        // Ensure routingReason is preserved or copied from the last user message
        let rr = last.routingReason
        if (!rr) {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const m = state.messages[i] as any
            if (m.role === 'user' && m.routingReason) { rr = m.routingReason; break }
          }
        }
        const updatedMsg = { ...last, id: finalId, text: finalText, ts: updatedTs, routingReason: rr, tokens: last.tokens }
        const previousId = last.id
        messages[targetIndex] = updatedMsg
        // Replace the last assistant message event in events array as well
        const eventsCopy = [...state.events]
        for (let i = eventsCopy.length - 1; i >= 0; i--) {
          const ev = eventsCopy[i] as any
          if (ev.type === 'message' && ev.role === 'assistant' && (ev.id === previousId || ev.id === updatedMsg.id)) {
            eventsCopy[i] = updatedMsg as any
            break
          }
        }
        const nextEvents = [...eventsCopy, e]
        set({
          events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          messages: messages.length > 10000 ? messages.slice(-10000) : messages,
          streamingMessageId: undefined,
        })
        return
      }
      // Fallback: If we didn't find an exact id match, try to update the most recent
      // assistant message from this turn (prevents duplicate replies when handlers
      // change ids between streaming and completion).
      let recentAssistantIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') { recentAssistantIndex = i; break }
      }
      if (recentAssistantIndex >= 0) {
        // Ensure this assistant message belongs to the current turn (after last user)
        let lastUserTs = 0
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'user') { lastUserTs = state.messages[i].ts; break }
        }
        if (messages[recentAssistantIndex].ts >= lastUserTs) {
          const last = messages[recentAssistantIndex]
          const finalText = e.text && e.text.length
            ? (sanitizeOutput(e.text, state.streamingModel) as string)
            : (sanitizeOutput(last.text, state.streamingModel) as string)
          const updatedTs = Math.max(
            ...state.events.map(ev => (ev as any).ts || 0),
            ...state.messages.map(m => (m as any).ts || 0)
          ) + 1
          const finalId = incomingId || last.id
          let rr = last.routingReason
          if (!rr) {
            for (let i = state.messages.length - 1; i >= 0; i--) {
              const m = state.messages[i] as any
              if (m.role === 'user' && m.routingReason) { rr = m.routingReason; break }
            }
          }
          const updatedMsg = { ...last, id: finalId, text: finalText, ts: updatedTs, routingReason: rr }
          const previousId = last.id
          messages[recentAssistantIndex] = updatedMsg
          const eventsCopy = [...state.events]
          for (let i = eventsCopy.length - 1; i >= 0; i--) {
            const ev = eventsCopy[i] as any
            if (ev.type === 'message' && ev.role === 'assistant' && (ev.id === previousId || ev.id === updatedMsg.id)) {
              eventsCopy[i] = updatedMsg as any
              break
            }
          }
          const nextEvents = [...eventsCopy, e]
          set({
            events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
            messages: messages.length > 10000 ? messages.slice(-10000) : messages,
            streamingMessageId: undefined,
          })
          return
        }
      }
      // No existing assistant message; create final assistant message directly
      const model = state.streamingModel
      // Ensure assistant ts > last user and last tool ts so it renders below all prior events
      let lastUserTs = 0
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'user') { lastUserTs = state.messages[i].ts; break }
      }
      let lastToolTs = 0
      for (const ev of state.events) {
        if (ev.type === 'tool:start' || ev.type === 'tool:output') {
          if (ev.ts > lastToolTs) lastToolTs = ev.ts
        }
      }
      const baseTs = e.ts || Date.now()
      const msgTs = Math.max(baseTs, lastUserTs, lastToolTs) + 1
      // Copy routingReason from the last user message, if any
      let lastUserReason: string | undefined = undefined
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const m = state.messages[i] as any
        if (m.role === 'user' && m.routingReason) { lastUserReason = m.routingReason; break }
      }
      const msg: MessageEvent = {
        id: (e as any).id || String(Date.now()),
        type: 'message',
        role: 'assistant',
        text: sanitizeOutput(e.text, state.streamingModel) as string,
        model,
        routingReason: lastUserReason,
        ts: msgTs
      }
      const nextEvents = [...state.events, e, msg]
      const nextMessages = [...state.messages, msg]
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        messages: nextMessages.length > 10000 ? nextMessages.slice(-10000) : nextMessages,
        streamingMessageId: undefined,
      })
      return
    }
    if (e.type === 'message') {
      // Removed expensive console logging - only log in development
      if (import.meta.env.DEV) {
        console.log('[session.pushEvent] Received message event:', {
          id: e.id,
          role: e.role,
          textLength: e.text?.length,
          textPreview: e.text?.substring(0, 50)
        })
      }
      
      // Check if this exact event already exists
      const existingEventIndex = state.events.findIndex(ev => 
        ev.type === 'message' && ev.id === e.id && ev.text === e.text
      )
      if (existingEventIndex >= 0) {
        console.log('[session.pushEvent] Skipping duplicate event')
        return
      }
      
      // For assistant messages, aggregate by ID if it's part of the same response
      if (e.role === 'assistant' && e.id) {
        const existingIndex = state.messages.findIndex(m => m.id === e.id && m.role === 'assistant')
        if (existingIndex >= 0) {
          const existing = state.messages[existingIndex]
          // If text is identical, skip duplicate
          if (e.text === existing.text) {
            console.log('[session.pushEvent] Skipping identical assistant message')
            return
          }
          // If new text contains old (streaming continuation), replace
          if (e.text.includes(existing.text)) {
            // Update text; ensure model populated
            // Ensure assistant ts after last tool event for correct rendering order
            let lastToolTs = 0
            for (const ev of state.events) {
              if (ev.type === 'tool:start' || ev.type === 'tool:output') {
                if (ev.ts > lastToolTs) lastToolTs = ev.ts
              }
            }
            const newTs = Math.max(Date.now(), lastToolTs + 1)
            // Preserve or adopt routingReason from the last user message for clarity
            let lastUserReason: string | undefined = existing.routingReason
            if (!lastUserReason) {
              for (let i = state.messages.length - 1; i >= 0; i--) {
                const m = state.messages[i] as any
                if (m.role === 'user' && m.routingReason) { lastUserReason = m.routingReason; break }
              }
            }
            const updated = { ...existing, text: sanitizeOutput(e.text, state.streamingModel) as string, model: existing.model || state.streamingModel, routingReason: lastUserReason, ts: newTs }
            const nextEvents = [...state.events]
            const nextMessages = [...state.messages]
            nextMessages[existingIndex] = updated
            // Update events array entry as well
            for (let i = nextEvents.length - 1; i >= 0; i--) {
              if ((nextEvents[i] as any).id === updated.id && nextEvents[i].type === 'message') {
                nextEvents[i] = updated as any
                break
              }
            }
            set({
              events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
              messages: nextMessages.length > 10000 ? nextMessages.slice(-10000) : nextMessages,
            })
            return
          }
          // If old text contains new (shouldn't happen), skip duplicate
          if (existing.text.includes(e.text)) {
            console.log('[session.pushEvent] Skipping subset assistant message')
            return 
          }
          // Otherwise append as separate paragraph
          let lastUserReason: string | undefined = existing.routingReason
          if (!lastUserReason) {
            for (let i = state.messages.length - 1; i >= 0; i--) {
              const m = state.messages[i] as any
              if (m.role === 'user' && m.routingReason) { lastUserReason = m.routingReason; break }
            }
          }
          const updated = { ...existing, text: existing.text + '\n\n' + (sanitizeOutput(e.text, state.streamingModel) as string), model: existing.model || state.streamingModel, routingReason: lastUserReason }
          const nextEvents = [...state.events, e]
          const nextMessages = [...state.messages.slice(0, existingIndex), updated, ...state.messages.slice(existingIndex + 1)]
          set({
            events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
            messages: nextMessages.length > 10000 ? nextMessages.slice(-10000) : nextMessages,
          })
          return
        }
      }
      
      // Check for duplicate assistant messages by content (within last 5 messages)
      if (e.role === 'assistant') {
        const recentMessages = state.messages.slice(-5)
        const duplicateFound = recentMessages.some(m => 
          m.role === 'assistant' && m.text === e.text
        )
        if (duplicateFound) {
          console.log('[session.pushEvent] Skipping duplicate assistant message by content')
          return
        }
      }
      
              // Add as new message - optimized array operations
      {
        const nextEvents = state.events.length > 50000
          ? [...state.events.slice(-49999), e]  // Keep last 49,999 + new
          : [...state.events, e]
        // Ensure assistant messages carry model information for UI badges
        let lastUserReason: string | undefined = undefined
        if (e.role === 'assistant') {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const m = state.messages[i] as any
            if (m.role === 'user' && m.routingReason) { lastUserReason = m.routingReason; break }
          }
        }
        const newMsg = e.role === 'assistant' ? { ...e, text: sanitizeOutput((e as any).text, state.streamingModel) as string, model: e.model || state.streamingModel, routingReason: (e as any).routingReason || lastUserReason } : e
        const nextMessages = state.messages.length > 10000
          ? [...state.messages.slice(-9999), newMsg]
          : [...state.messages, newMsg]

        set({
          events: nextEvents,
          messages: nextMessages,
        })

        // Save session after adding message - only save recent items
        if (state.projectDir) {
          saveSession({
            events: nextEvents,
            messages: nextMessages,
            tools: state.tools,
            edits: state.edits,
            cost: state.cost
          }, state.projectDir)
        }
      }
      return
    }
    if (e.type === 'assistant:delta') {
      // Append to the assistant message for this stream id; otherwise create one
      const messages = [...state.messages]
      const incomingId = (e as any).id ? String((e as any).id) : undefined
      const streamId = state.streamingMessageId
      const msgId = incomingId || streamId || String(Date.now())
      if (!streamId || streamId !== msgId) {
        set({ streamingMessageId: msgId })
      }

      // Find by exact id
      let targetIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].id === msgId) { targetIndex = i; break }
      }

      if (targetIndex >= 0) {
        // Update existing assistant message
        let lastUserTs = 0
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'user') { lastUserTs = state.messages[i].ts; break }
        }
        let lastToolTs = 0
        for (const ev of state.events) {
          if (ev.type === 'tool:start' || ev.type === 'tool:output') {
            if (ev.ts > lastToolTs) lastToolTs = ev.ts
          }
        }
        const newTs = Math.max(Date.now(), lastUserTs, lastToolTs, messages[targetIndex].ts) + 1
        // Preserve or adopt routingReason
        let lastUserReason: string | undefined = messages[targetIndex].routingReason
        if (!lastUserReason) {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const m = state.messages[i] as any
            if (m.role === 'user' && m.routingReason) { lastUserReason = m.routingReason; break }
          }
        }
        const updatedMsg = { ...messages[targetIndex], text: messages[targetIndex].text + (sanitizeOutput(e.chunk, state.streamingModel) as string), model: messages[targetIndex].model || state.streamingModel, routingReason: lastUserReason, ts: newTs }
        messages[targetIndex] = updatedMsg
        // Update events entry with same id
        const eventsCopy = [...state.events]
        for (let i = eventsCopy.length - 1; i >= 0; i--) {
          const ev = eventsCopy[i] as any
          if (ev.type === 'message' && ev.role === 'assistant' && ev.id === msgId) {
            eventsCopy[i] = updatedMsg as any
            break
          }
        }
        const nextEvents = [...eventsCopy, e]
        set({
          events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          messages: messages.length > 10000 ? messages.slice(-10000) : messages,
        })
      } else {
        // Create new assistant message for this stream id
        let lastUserTs = 0
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'user') { lastUserTs = state.messages[i].ts; break }
        }
        let lastToolTs = 0
        for (const ev of state.events) {
          if (ev.type === 'tool:start' || ev.type === 'tool:output') {
            if (ev.ts > lastToolTs) lastToolTs = ev.ts
          }
        }
        const baseTs = Date.now()
        const msgTs = Math.max(baseTs, lastUserTs, lastToolTs) + 1
        // Copy routingReason from the last user message, if any
        let lastUserReason: string | undefined = undefined
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const m = state.messages[i] as any
          if (m.role === 'user' && m.routingReason) { lastUserReason = m.routingReason; break }
        }
        const msg: MessageEvent = {
          id: msgId,
          type: 'message',
          role: 'assistant',
          text: sanitizeOutput(e.chunk, state.streamingModel) as string,
          model: state.streamingModel,
          routingReason: lastUserReason,
          ts: msgTs
        }
        const nextEvents = [...state.events, e, msg]
        const nextMessages = [...state.messages, msg]
        set({
          events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          messages: nextMessages.length > 10000 ? nextMessages.slice(-10000) : nextMessages
        })
      }
      return
    }
    if (e.type === 'thinking') {
      const nextEvents = [...state.events, e]
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        thinking: { text: e.text, done: e.done || false }
      })
      return
    }
    if (e.type === 'tool:start') {
      const run: ToolRun = { id: e.id, tool: e.tool, args: e.args, output: '', done: false, agent: (e as any).agent || (e as any).model || get().streamingModel }
      const nextEvents = [...state.events, e]
      const nextTools = { ...state.tools, [e.id]: run }
      // Fire a permission request if none has been made/decided yet for this session/project
      let pendingPerm = state.permissions.pending
      const hasDecision = state.permissions.decisions && state.permissions.decisions.length > 0
      let eventsWithPerm = nextEvents
      if (!pendingPerm && !hasDecision) {
        const req: PermissionRequestEvent = {
          id: `perm_${Date.now()}`,
          type: 'permission:request',
          tools: [e.tool],
          scope: 'session',
          ts: Date.now()
        }
        eventsWithPerm = [...nextEvents, req]
        set({ permissions: { ...state.permissions, pending: req } })
      }
      set({
        events: eventsWithPerm.length > 50000 ? eventsWithPerm.slice(-50000) : eventsWithPerm,
        tools: nextTools,
      })
      // Opportunistic checkpoint for Claude (which doesn't emit checkpoint events):
      // If a write/edit tool declares a file path, capture a one-file snapshot before modification.
      Promise.resolve().then(async () => {
        try {
          const tool = String(e.tool || '').toLowerCase()
          const args = (e as any).args || {}
          const filePath = args.path || args.file_path || args.file || args.filename
          const isWrite = tool === 'write'
          const isEdit = tool === 'edit'
          const isReplace = tool === 'replace'
          const isBash = tool === 'bash'
          const destructiveBash = isBash && typeof (args.command || args.raw) === 'string' && /\b(rm|mv|cp|git\s+(reset|revert|clean)|npm\s+(install|update|uninstall)|yarn\s+(add|remove|upgrade))\b/.test(args.command || args.raw)
          if ((isWrite || isEdit || isReplace) && filePath && (window as any).__TAURI__) {
            let original = ''
            try { original = await readTextFile(filePath) } catch {}
            const id = `cp_${Date.now()}`
            await invoke('save_checkpoint_files', { checkpointId: id, files: [{ path: filePath, original_content: original, current_content: original }], trigger: `${tool}:${filePath}` })
            const existing = get().checkpoints || []
            const rec = { id, ts: Date.now(), trigger: `${tool}:${filePath}`, fileCount: 1 }
            set({ checkpoints: [rec, ...existing].slice(0, 100) })
          } else if (destructiveBash && (window as any).__TAURI__) {
            const id = `cp_${Date.now()}`
            await invoke('save_checkpoint_files', { checkpointId: id, files: [], trigger: `bash:${args.command || args.raw}` })
            const existing = get().checkpoints || []
            const rec = { id, ts: Date.now(), trigger: `bash:${args.command || args.raw}`, fileCount: 0 }
            set({ checkpoints: [rec, ...existing].slice(0, 100) })
          }
        } catch {}
      })
      // Save session with tools
      saveSession({
        events: eventsWithPerm.slice(-50000),
        messages: state.messages.slice(-10000),
        tools: nextTools,
        edits: state.edits,
        cost: state.cost
      }, state.projectDir)
      return
    }
    if (e.type === 'tool:output') {
      const run = state.tools[e.id]
      if (!run) {
        const nextEvents = [...state.events, e]
        set({ events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents })
        return
      }
      const merged: ToolRun = { ...run, output: run.output + e.chunk, done: !!e.done }
      const nextEvents = [...state.events, e]
      const nextTools = { ...state.tools, [e.id]: merged }
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        tools: nextTools,
      })
      // Save session with updated tools when done
      if (e.done) {
        saveSession({
          events: nextEvents.slice(-50000),
          messages: state.messages.slice(-10000),
          tools: nextTools,
          edits: state.edits,
          cost: state.cost
        }, state.projectDir)
      }
      return
    }
    if (e.type === 'edit:proposed') {
      const edit: ProposedEdit = { id: e.id, file: e.file, before: e.before, after: e.after, status: 'proposed' }
      const nextEvents = [...state.events, e]
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        edits: [...state.edits, edit],
        selectedEditId: e.id,
        ui: { ...state.ui, workbenchTab: 'diffs' },
      })
      return
    }
    if (e.type === 'edit:applied' || e.type === 'edit:rejected') {
      const status = e.type === 'edit:applied' ? 'applied' : 'rejected'
      const nextEvents = [...state.events, e]
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        edits: state.edits.map((ed) => (ed.id === e.id ? { ...ed, status } : ed)),
      })
      return
    }
    if (e.type === 'permission:request') {
      const nextEvents = [...state.events, e]
      set({ events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents, permissions: { ...state.permissions, pending: e } })
      return
    }
    if (e.type === 'permission:decision') {
      const nextEvents = [...state.events, e]
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        permissions: { pending: undefined, decisions: [...state.permissions.decisions, e] },
      })
      return
    }
    if (e.type === 'cost:update') {
      // Update the last assistant message with token counts
      const messages = [...state.messages]
      let lastAssistantIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'assistant') { lastAssistantIndex = i; break }
      }
      if (lastAssistantIndex >= 0) {
        messages[lastAssistantIndex] = {
          ...messages[lastAssistantIndex],
          tokens: { input: e.tokensIn, output: e.tokensOut }
        }
      }
      const nextEvents = [...state.events, e]
      const newCost = { usd: e.usd, tokensIn: e.tokensIn, tokensOut: e.tokensOut }
      set({ 
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents, 
        messages: messages.length > 10000 ? messages.slice(-10000) : messages,
        cost: newCost
      })
      // Save session after cost update
      saveSession({
        events: nextEvents.slice(-50000),
        messages: messages.slice(-10000),
        tools: state.tools,
        edits: state.edits,
        cost: newCost
      }, state.projectDir)
      return
    }
    if (e.type === 'telemetry:tokens') {
      // Update last assistant message tokens without touching USD cost
      const messages = [...state.messages]
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'assistant') {
          messages[i] = { ...m, tokens: { input: (e as any).tokensIn || 0, output: (e as any).tokensOut || 0 } }
          break
        }
      }
      const nextEvents = [...state.events, e]
      set({
        events: nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        messages: messages.length > 10000 ? messages.slice(-10000) : messages
      })
      return
    }
  },

  setProjectDir: (dir) => {
    const currentDir = get().projectDir

    // INSTANT UI UPDATE - Don't block on file I/O
    set({ projectDir: dir })

    // If switching to a different project, handle clearing/loading
    if (currentDir !== dir) {
      const state = get()
      if (state.isStreaming) {
        // Defer full switch until streaming completes
        set({ pendingProjectDir: dir })
        return
      }

      // Clear current conversation state immediately for instant UI update
      set({
        events: [],
        messages: [],
        tools: {},
        edits: [],
        thinking: undefined,
        cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
        isStreaming: false,
        streamingStartTime: undefined,
        streamingModel: undefined
      })

      // Load the new project's session asynchronously (non-blocking)
      if (dir) {
        Promise.resolve().then(() => {
          const persisted = loadSession(dir)
          if (persisted.messages && persisted.messages.length > 0) {
            set({
              events: persisted.events || [],
              messages: persisted.messages || [],
              tools: persisted.tools || {},
              edits: persisted.edits || [],
              cost: persisted.cost || { usd: 0, tokensIn: 0, tokensOut: 0 }
            })
          }
        })
      }
    }
  },

  setAutoAccept: (v) => set({ autoAccept: v }),

  acceptEdit: (id) => {
    const now = Date.now()
    get().pushEvent({ id, type: 'edit:applied', ts: now })
  },

  rejectEdit: (id) => {
    const now = Date.now()
    get().pushEvent({ id, type: 'edit:rejected', ts: now })
  },

  selectEdit: (id) => set({ selectedEditId: id }),

  resolvePermission: (allow, scope) => {
    const pending = get().permissions.pending
    if (!pending) return
    get().pushEvent({ id: pending.id, type: 'permission:decision', allow, scope, ts: Date.now() })
  },

  setWorkbenchTab: (tab) => set((s) => ({ ui: { ...s.ui, workbenchTab: tab } })),
  
  setShowTerminal: (show) => set({ showTerminal: show }),
  
  setStreaming: (streaming, model) => {
    const wasStreaming = get().isStreaming
    set((state) => ({ 
      isStreaming: streaming, 
      streamingStartTime: streaming ? (state.isStreaming ? state.streamingStartTime : Date.now()) : undefined,
      streamingModel: model,
      streamingMessageId: streaming ? state.streamingMessageId : undefined
    }))

    // If a stream just ended and a project switch was queued, perform it now
    if (wasStreaming && !streaming) {
      const pending = get().pendingProjectDir
      const current = get().projectDir
      if (pending && pending !== current) {
        // Apply the pending project switch now
        set({ pendingProjectDir: undefined, projectDir: pending })

        // Clear current conversation state for the new project
        set({
          events: [],
          messages: [],
          tools: {},
          edits: [],
          thinking: undefined,
          cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
          isStreaming: false,
          streamingStartTime: undefined,
          streamingModel: undefined
        })

        // Load the new project's session asynchronously and restart Claude
        Promise.resolve().then(() => {
          const persisted = loadSession(pending)
          if (persisted.messages && persisted.messages.length > 0) {
            set({
              events: persisted.events || [],
              messages: persisted.messages || [],
              tools: persisted.tools || {},
              edits: persisted.edits || [],
              cost: persisted.cost || { usd: 0, tokensIn: 0, tokensOut: 0 }
            })
          }
          try { clearDeduplicationCache() } catch {}
          if (typeof window !== 'undefined' && (window as any).__TAURI__) {
            invoke('restart_claude', { projectDir: pending }).catch(() => {})
          }
        })
      }
    }
  },
  
  clearConversation: () => {
    const state = get()
    
    // Stop any streaming first
    set({ isStreaming: false })
    
    // Stop Claude backend and restart it
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      const projectDir = state.projectDir || ''
      
      // Stop Claude completely
      // Use atomic restart for better reliability
      if (projectDir) {
        invoke('restart_claude', { projectDir }).then(() => {
          // Clear all state after restart
          set({
            events: [],
            messages: [],
            tools: {},
            edits: [],
            thinking: undefined,
            cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
            isStreaming: false,
            streamingStartTime: undefined,
            streamingModel: undefined
          })

          // Clear persisted session
          clearSession(projectDir)
        }).catch((err) => {
          console.error('Failed to restart Claude:', err)
        })
      } else {
        invoke('stop_claude').then(() => {
          set({
            events: [],
            messages: [],
            tools: {},
            edits: [],
            thinking: undefined,
            cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
            isStreaming: false,
            streamingStartTime: undefined,
            streamingModel: undefined
          })
          clearSession(projectDir)
        }).catch((err) => {
          console.error('Failed to stop Claude:', err)
        })
      }
    } else {
      // No Tauri, just clear state
      set({
        events: [],
        messages: [],
        tools: {},
        edits: [],
        thinking: undefined,
        cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
        isStreaming: false,
        streamingStartTime: undefined,
        streamingModel: undefined
      })
      clearSession(state.projectDir)
    }
  },
  
  loadPersistedSession: () => {
    const state = get()
    const persisted = loadSession(state.projectDir)
    if (persisted.messages && persisted.messages.length > 0) {
      set({
        events: persisted.events || [],
        messages: persisted.messages || [],
        tools: persisted.tools || {},
        edits: persisted.edits || [],
        cost: persisted.cost || { usd: 0, tokensIn: 0, tokensOut: 0 }
      })
    }
  },
  
  clearSession: () => {
    const state = get()
    
    // Clear all state
    set({
      events: [],
      messages: [],
      tools: {},
      edits: [],
      thinking: undefined,
      permissions: { decisions: [] },
      cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
      autoAccept: false,
      isStreaming: false,
      streamingStartTime: undefined,
      streamingModel: undefined,
      selectedEditId: undefined,
      fileTracker: {
        originalContents: new Map(),
        modifiedFiles: new Set(),
        isTracking: false
      }
    })
    
    // Clear persisted session
    if (state.projectDir) {
      clearSession(state.projectDir)
    }
  }
  }
})

// Make session store globally accessible
export const useSessionStore = useSession
if (typeof window !== 'undefined') {
  (window as any).useSession = useSession
}

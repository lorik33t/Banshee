import { create } from 'zustand'

export type Role = 'user' | 'assistant'
export type ToolType = 'bash' | 'grep' | 'read' | 'write' | 'web' | 'mcp'

export type MessageEvent = {
  id: string
  type: 'message'
  role: Role
  text: string
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

export type SessionEvent =
  | MessageEvent
  | ToolStartEvent
  | ToolOutputEvent
  | EditProposedEvent
  | EditStatusEvent
  | PermissionRequestEvent
  | PermissionDecisionEvent
  | CostUpdateEvent
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
}

export type SessionState = {
  events: SessionEvent[]
  messages: MessageEvent[]
  tools: Record<string, ToolRun>
  edits: ProposedEdit[]
  projectDir?: string
  permissions: {
    pending?: PermissionRequestEvent
    decisions: PermissionDecisionEvent[]
  }
  cost: { usd: number; tokensIn: number; tokensOut: number }
  autoAccept: boolean
  selectedEditId?: string

  pushEvent: (e: SessionEvent) => void
  setProjectDir: (dir?: string) => void
  setAutoAccept: (v: boolean) => void
  acceptEdit: (id: string) => void
  rejectEdit: (id: string) => void
  selectEdit: (id?: string) => void
  resolvePermission: (allow: boolean, scope: 'once' | 'session' | 'project') => void
}

export const useSession = create<SessionState>((set, get) => ({
  events: [],
  messages: [],
  tools: {},
  edits: [],
  permissions: { decisions: [] },
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  autoAccept: false,

  pushEvent: (e) => {
    const state = get()
    if (e.type === 'message') {
      set({
        events: [...state.events, e],
        messages: [...state.messages, e],
      })
      return
    }
    if (e.type === 'tool:start') {
      const run: ToolRun = { id: e.id, tool: e.tool, args: e.args, output: '', done: false }
      set({
        events: [...state.events, e],
        tools: { ...state.tools, [e.id]: run },
      })
      return
    }
    if (e.type === 'tool:output') {
      const run = state.tools[e.id]
      if (!run) return
      const merged: ToolRun = { ...run, output: run.output + e.chunk, done: !!e.done }
      set({
        events: [...state.events, e],
        tools: { ...state.tools, [e.id]: merged },
      })
      return
    }
    if (e.type === 'edit:proposed') {
      const edit: ProposedEdit = { id: e.id, file: e.file, before: e.before, after: e.after, status: 'proposed' }
      set({
        events: [...state.events, e],
        edits: [...state.edits, edit],
        selectedEditId: e.id,
      })
      return
    }
    if (e.type === 'edit:applied' || e.type === 'edit:rejected') {
      const status = e.type === 'edit:applied' ? 'applied' : 'rejected'
      set({
        events: [...state.events, e],
        edits: state.edits.map((ed) => (ed.id === e.id ? { ...ed, status } : ed)),
      })
      return
    }
    if (e.type === 'permission:request') {
      set({ events: [...state.events, e], permissions: { ...state.permissions, pending: e } })
      return
    }
    if (e.type === 'permission:decision') {
      set({
        events: [...state.events, e],
        permissions: { pending: undefined, decisions: [...state.permissions.decisions, e] },
      })
      return
    }
    if (e.type === 'cost:update') {
      set({ events: [...state.events, e], cost: { usd: e.usd, tokensIn: e.tokensIn, tokensOut: e.tokensOut } })
      return
    }
  },

  setProjectDir: (dir) => set({ projectDir: dir }),

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
}))

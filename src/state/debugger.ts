import { create } from 'zustand'

export interface Breakpoint {
  id?: number
  verified?: boolean
  source?: { path?: string }
  line?: number
}

export interface StackFrame {
  id: number
  name: string
  line: number
  column?: number
  source?: { path?: string }
}

export interface DebugVariable {
  name: string
  value: string
  variablesReference?: number
}

interface DebugState {
  breakpoints: Breakpoint[]
  callStack: StackFrame[]
  variables: DebugVariable[]
  setBreakpoints: (b: Breakpoint[]) => void
  setCallStack: (s: StackFrame[]) => void
  setVariables: (v: DebugVariable[]) => void
}

export const useDebug = create<DebugState>(set => ({
  breakpoints: [],
  callStack: [],
  variables: [],
  setBreakpoints: b => set({ breakpoints: b }),
  setCallStack: s => set({ callStack: s }),
  setVariables: v => set({ variables: v }),
}))

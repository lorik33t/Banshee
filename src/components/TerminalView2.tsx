import { useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { useSession } from '../state/session'

// Minimal sanitization - only remove truly problematic sequences
// Let xterm.js handle ANSI escape codes properly
const sanitizeChunk = (chunk: string): string => {
  let result = chunk

  // Strip OSC sequences that change window title (causes issues in embedded terminals)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\u001B\]0;[^\u0007]*\u0007/g, '')

  // Filter out macOS Terminal session save/restore messages
  result = result.replace(/Restored session:.*?\r?\n/g, '')
  result = result.replace(/Saving session\.\.\.\r?\n/g, '')
  result = result.replace(/\.\.\.saving history\.\.\.\r?\n/g, '')
  result = result.replace(/\.\.\.truncating history files\.\.\.\r?\n/g, '')
  result = result.replace(/\.\.\.completed\.\r?\n/g, '')

  return result
}

const buildTheme = (): ITheme => {
  const root = document.documentElement
  const themeName = root.getAttribute('data-theme') ?? 'light'
  const styles = getComputedStyle(root)

  const backgroundToken = styles.getPropertyValue('--bg-primary').trim()
  const foregroundToken = styles.getPropertyValue('--text-primary').trim()
  const accentToken = styles.getPropertyValue('--accent').trim()

  if (themeName === 'dark') {
    return {
      background: backgroundToken || '#060606',
      foreground: foregroundToken || '#f8fafc',
      cursor: accentToken || '#34d399',
      cursorAccent: '#000000',
      selectionBackground: '#34d39933',
      black: '#0f172a',
      red: '#f87171',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e2e8f0',
      brightBlack: '#64748b',
      brightRed: '#f87171',
      brightGreen: '#4ade80',
      brightYellow: '#facc15',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#22d3ee',
      brightWhite: '#f8fafc'
    }
  }

  return {
    background: backgroundToken || '#f8fafc',
    foreground: foregroundToken || '#0f172a',
    cursor: accentToken || '#0f766e',
    cursorAccent: '#ffffff',
    selectionBackground: '#0ea5e933',
    black: '#1f2937',
    red: '#b91c1c',
    green: '#15803d',
    yellow: '#b45309',
    blue: '#1d4ed8',
    magenta: '#7c3aed',
    cyan: '#0e7490',
    white: '#334155',
    brightBlack: '#4b5563',
    brightRed: '#dc2626',
    brightGreen: '#16a34a',
    brightYellow: '#d97706',
    brightBlue: '#2563eb',
    brightMagenta: '#8b5cf6',
    brightCyan: '#0ea5e9',
    brightWhite: '#1f2937'
  }
}

const collapsePath = (path: string) => {
  if (!path) return '~'
  if (path.startsWith('/Users/')) {
    return path.replace(/\/Users\/[^/]+/, '~')
  }
  if (path.startsWith('/home/')) {
    return path.replace(/\/home\/[^/]+/, '~')
  }
  return path
}

// Store terminal instances per session to preserve state
const terminalInstancesMap = new Map<string, {
  terminal: Xterm
  fitAddon: FitAddon
  terminalId: string
}>()

export function TerminalView2() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const unlistenersRef = useRef<Array<() => void>>([])
  const currentTerminalRef = useRef<Xterm | null>(null)
  const currentFitAddonRef = useRef<FitAddon | null>(null)

  const projectDir = useSession((s) => s.projectDir)
  const showTerminal = useSession((s) => s.showTerminal)
  const sessionId = useSession((s) => s.sessionId)

  const applyTheme = useCallback(() => {
    const term = currentTerminalRef.current
    if (!term) return
    term.options = { theme: buildTheme() }
  }, [])

  // Get or create terminal instance for current session
  const getTerminalInstance = useCallback(() => {
    if (!sessionId) return null

    let instance = terminalInstancesMap.get(sessionId)

    if (!instance) {
      console.log('[Terminal] Creating NEW xterm instance for session:', sessionId)
      const term = new Xterm({
        allowTransparency: true,
        convertEol: true,
        cursorBlink: true,
        cursorStyle: 'block',
        drawBoldTextInBrightColors: true,
        fontFamily: `'SF Mono', 'JetBrains Mono', Monaco, monospace`,
        fontSize: 12,
        letterSpacing: 0,
        lineHeight: 1.25,
        scrollback: 10000,
        theme: buildTheme()
      })

      const fitAddon = new FitAddon()
      const webLinksAddon = new WebLinksAddon()

      term.loadAddon(fitAddon)
      term.loadAddon(webLinksAddon)

      instance = {
        terminal: term,
        fitAddon,
        terminalId: ''
      }

      terminalInstancesMap.set(sessionId, instance)
    } else {
      console.log('[Terminal] REUSING existing xterm instance for session:', sessionId)
    }

    return instance
  }, [sessionId])

  // Mount terminal to DOM when container or session changes
  useEffect(() => {
    if (!containerRef.current || !sessionId) return

    const instance = getTerminalInstance()
    if (!instance) return

    const { terminal, fitAddon } = instance

    currentTerminalRef.current = terminal
    currentFitAddonRef.current = fitAddon

    // Only open if not already opened
    if (!terminal.element) {
      console.log('[Terminal] Opening terminal in DOM')
      terminal.open(containerRef.current)
    } else if (terminal.element.parentElement !== containerRef.current) {
      console.log('[Terminal] Moving terminal to new container')
      containerRef.current.appendChild(terminal.element)
    }

    applyTheme()

    return () => {
      // Don't dispose terminal, just detach from DOM
      // Terminal stays in memory for session
    }
  }, [sessionId, getTerminalInstance, applyTheme])

  const fitAndResize = useCallback(() => {
    const term = currentTerminalRef.current
    const fit = currentFitAddonRef.current
    const instance = terminalInstancesMap.get(sessionId)

    if (!term || !fit || !instance || !instance.terminalId) return

    fit.fit()

    const cols = term.cols
    const rows = term.rows

    invoke('resize_terminal', { id: instance.terminalId, cols, rows }).catch((error) => {
      console.error('resize_terminal failed', error)
    })
  }, [sessionId])

  const scheduleResize = useCallback(() => {
    if (!showTerminal) return
    if (resizeRafRef.current) {
      cancelAnimationFrame(resizeRafRef.current)
    }
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null
      fitAndResize()
    })
  }, [fitAndResize, showTerminal])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver(() => scheduleResize())
    resizeObserver.observe(container)

    window.addEventListener('resize', scheduleResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleResize)
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
    }
  }, [scheduleResize])

  // Focus and resize when terminal becomes visible
  useEffect(() => {
    if (!showTerminal) return

    const raf = requestAnimationFrame(() => {
      const term = currentTerminalRef.current
      if (!term) return

      term.focus()

      setTimeout(() => {
        fitAndResize()
      }, 50)
    })

    return () => cancelAnimationFrame(raf)
  }, [showTerminal, fitAndResize])

  // Setup PTY connection for this session
  useEffect(() => {
    if (!sessionId) return

    const instance = terminalInstancesMap.get(sessionId)
    if (!instance) return

    // Don't create terminal until we have a projectDir (unless it's explicitly undefined/no project)
    // Wait a bit for projectDir to be set from session state
    if (projectDir === undefined) {
      console.log('[Terminal] Waiting for projectDir to be set...')
      return
    }

    const setupPTY = async () => {
      try {
        // Check if this session already has a PTY
        const existingId = await invoke<string | null>('get_session_terminal_id', { sessionId })

        let id: string

        if (existingId) {
          id = existingId
          console.log('[Terminal] Reusing existing PTY for session:', sessionId, id)
        } else {
          id = `term-${sessionId}-${Date.now()}`

          // Get the working directory - use projectDir from session state
          const workingDir = projectDir || ''
          console.log('[Terminal] Creating NEW PTY for session:', sessionId, id)
          console.log('[Terminal] Working directory:', workingDir || '(current directory)')

          await invoke('create_terminal', {
            sessionId,
            id,
            workingDir: workingDir || undefined
          })
        }

        // Store PTY ID in instance
        instance.terminalId = id

        // Clean up previous listeners
        unlistenersRef.current.forEach(fn => fn())
        unlistenersRef.current = []

        // Set up event listeners
        const outputUnlisten = await listen<string>(`terminal:output:${id}`, (event) => {
          const chunk = sanitizeChunk(event.payload)
          instance.terminal.write(chunk)
        })

        const exitUnlisten = await listen(`terminal:exit:${id}`, () => {
          instance.terminal.writeln('\r\n[process exited]\r\n')
        })

        unlistenersRef.current = [outputUnlisten, exitUnlisten]

        // Setup input handler
        const disposable = instance.terminal.onData((data) => {
          if (!instance.terminalId) return
          invoke('write_to_terminal', { id: instance.terminalId, data }).catch((error) => {
            console.error('write_to_terminal failed', error)
          })
        })

        unlistenersRef.current.push(() => disposable.dispose())

      } catch (error) {
        console.error('[Terminal] Setup failed:', error)
      }
    }

    setupPTY()

    return () => {
      unlistenersRef.current.forEach(fn => fn())
      unlistenersRef.current = []
    }
  }, [sessionId, projectDir])

  useEffect(() => {
    applyTheme()
    const observer = new MutationObserver(applyTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    return () => observer.disconnect()
  }, [applyTheme])

  const displayPath = collapsePath(projectDir || '')

  const handleClear = () => {
    currentTerminalRef.current?.clear()
  }

  return (
    <div className="terminal-view2">
      <div className="terminal2-header">
        <div className="terminal2-info">
          <span className="terminal2-label">Terminal</span>
          <span className="terminal2-path">{displayPath}</span>
          <span className="terminal2-session-info">Session-only history</span>
        </div>
        <div className="terminal2-controls">
          <button onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>

      <div className="terminal2-body">
        <div ref={containerRef} className="terminal2-surface" />
      </div>
    </div>
  )
}

#!/usr/bin/env node

import { Codex } from '@openai/codex-sdk'
import fs from 'fs'
import os from 'os'
import path from 'path'
import readline from 'readline'
import { execSync } from 'child_process'
loadEnvFiles()
process.env.NO_COLOR = process.env.NO_COLOR || '1'

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function locateCodexBinary() {
  const explicit = process.env.CODEX_BINARY_PATH
  if (explicit && fs.existsSync(explicit)) {
    return explicit
  }
  try {
    const which = execSync('which codex', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim()
    if (which) {
      return which
    }
  } catch {}

  const candidates = [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    `${process.env.HOME || ''}/.local/bin/codex`,
  ]

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate
      }
    } catch {}
  }
  return null
}

const apiKey = process.env.CODEX_API_KEY
let codex

if (apiKey) {
  codex = new Codex({
    apiKey,
    baseUrl: process.env.CODEX_BASE_URL,
  })
  console.log('[Codex SDK Handler] Using API key authentication via bundled SDK')
} else {
  const localBinary = locateCodexBinary()
  if (!localBinary) {
    console.error('[Codex SDK Handler] No CODEX_API_KEY configured and no local codex binary found. Codex requests will fail until credentials are provided.')
    process.exit(1)
  }
  console.log('[Codex SDK Handler] Using system codex binary at', localBinary)
  codex = new Codex({ codexPathOverride: localBinary })
}

const sessions = new Map()

class CodexSession {
  constructor(sessionId) {
    this.sessionId = sessionId
    this.queue = []
    this.running = false
    this.thread = null
    this.threadId = null
    this.threadOptions = null
    this.currentRun = null
    this.currentStream = null
  }

  resolveThreadOptions(options) {
    const base = this.threadOptions ? { ...this.threadOptions } : {}
    if (options && typeof options === 'object') {
      if (typeof options.workingDirectory === 'string' && options.workingDirectory.trim().length) {
        base.workingDirectory = options.workingDirectory.trim()
      }
      if (typeof options.sandboxMode === 'string' && options.sandboxMode.trim().length) {
        base.sandboxMode = options.sandboxMode
      }
      if (Object.prototype.hasOwnProperty.call(options, 'skipGitRepoCheck')) {
        base.skipGitRepoCheck = Boolean(options.skipGitRepoCheck)
      }
    }
    if (!base.workingDirectory) {
      base.workingDirectory = this.threadOptions?.workingDirectory || process.cwd()
    }
    if (base.skipGitRepoCheck === undefined) {
      base.skipGitRepoCheck = true
    }
    this.threadOptions = base
    return base
  }

  register(details) {
    const payload = details && typeof details === 'object' ? details : {}
    const options = this.resolveThreadOptions(payload.options)
    const incomingThreadId = typeof payload.threadId === 'string' && payload.threadId.trim().length
      ? payload.threadId.trim()
      : undefined

    if (incomingThreadId) {
      this.threadId = incomingThreadId
      try {
        this.thread = options ? codex.resumeThread(incomingThreadId, options) : codex.resumeThread(incomingThreadId)
        emit(this.sessionId, {
          type: 'thread:update',
          threadId: incomingThreadId,
          ts: Date.now(),
        })
      } catch (err) {
        console.warn('[CodexSession] Failed to resume thread', incomingThreadId, err)
        this.thread = null
      }
    }
  }

  enqueue(command) {
    this.queue.push(command)
    this.processQueue().catch(() => {})
  }

  async processQueue() {
    if (this.running) return
    const next = this.queue.shift()
    if (!next) {
      this.queue.length = 0
      return
    }
    this.running = true
    try {
      await this.execute(next)
    } finally {
      this.running = false
      if (this.queue.length > 0) {
        this.processQueue().catch(() => {})
      }
    }
  }

  ensureThread(desiredOptions, incomingThreadId) {
    const previousOptions = this.threadOptions
    const options = this.resolveThreadOptions(desiredOptions)
    const targetThreadId = typeof incomingThreadId === 'string' && incomingThreadId.trim().length
      ? incomingThreadId.trim()
      : this.threadId
    const optionsChanged = !previousOptions || !optionsEqual(previousOptions, options)
    const needsResume = Boolean(targetThreadId) && (!this.thread || targetThreadId !== this.threadId || optionsChanged)

    if (needsResume && targetThreadId) {
      try {
        this.thread = options ? codex.resumeThread(targetThreadId, options) : codex.resumeThread(targetThreadId)
        this.threadId = targetThreadId
        emit(this.sessionId, {
          type: 'thread:update',
          threadId: targetThreadId,
          ts: Date.now(),
        })
      } catch (err) {
        console.warn('[CodexSession] Failed to resume thread', targetThreadId, err)
        this.thread = null
      }
    }

    if (!this.thread) {
      this.thread = codex.startThread(options)
      this.threadId = null
    }

    return this.thread
  }

  updateThreadId(threadId) {
    if (!threadId || threadId === this.threadId) {
      return
    }
    this.threadId = threadId
    emit(this.sessionId, {
      type: 'thread:update',
      threadId,
      ts: Date.now(),
    })
  }

  async execute(command) {
    const rawPayload = command?.payload

    let payload
    if (typeof rawPayload === 'string') {
      try {
        payload = JSON.parse(rawPayload)
      } catch {
        payload = { currentMessage: rawPayload }
      }
    } else if (rawPayload && typeof rawPayload === 'object') {
      payload = rawPayload
    } else {
      payload = { currentMessage: String(rawPayload ?? '') }
    }

    const prompt = typeof payload.currentMessage === 'string' ? payload.currentMessage : ''
    if (!prompt.trim().length) {
      emit(this.sessionId, { type: 'assistant:complete', id: makeMessageId(), text: '' })
      return
    }

    const codexOptions = payload.codexOptions || {}
    const showReasoning = codexOptions.showReasoning !== false
    const displayMode = typeof codexOptions.displayMode === 'string' ? codexOptions.displayMode : 'clean'
    let sandboxMode = payload.sandboxMode
    if (!sandboxMode || typeof sandboxMode !== 'string') {
      sandboxMode = 'workspace-write'
    } else if (sandboxMode === 'danger-full-access') {
      sandboxMode = 'workspace-write'
    }
    const model = payload.model

    let outputSchema
    if (payload.outputSchema) {
      try {
        outputSchema = typeof payload.outputSchema === 'string'
          ? JSON.parse(payload.outputSchema)
          : payload.outputSchema
      } catch {
        outputSchema = undefined
      }
    }

    const workingDirectory = typeof payload.workingDirectory === 'string' && payload.workingDirectory.trim().length
      ? payload.workingDirectory.trim()
      : process.cwd()

    const desiredOptions = {
      workingDirectory,
      sandboxMode,
      skipGitRepoCheck: true,
    }

    const incomingThreadId = typeof payload.threadId === 'string' && payload.threadId.trim().length
      ? payload.threadId.trim()
      : undefined

    const thread = this.ensureThread(desiredOptions, incomingThreadId)

    const messageId = makeMessageId()
    emit(this.sessionId, { type: 'model:update', model, ts: Date.now() })

    const context = {
      session: this,
      sessionId: this.sessionId,
      messageId,
      showReasoning,
      displayMode,
      agentText: '',
      agentDone: false,
      reasoning: new Map(),
      commands: new Map(),
      mcp: new Map(),
      cancelled: false,
      structured: Boolean(outputSchema),
      structuredResult: null,
    }

    this.currentRun = context

    try {
      const turnOptions = outputSchema ? { outputSchema } : undefined
      const { events } = await thread.runStreamed(prompt, turnOptions)
      this.currentStream = events

      for await (const event of events) {
        handleThreadEvent(event, context)
      }

      if (context.cancelled) {
        emit(this.sessionId, {
          type: 'assistant:complete',
          id: messageId,
          text: '⚠️ Interrupted',
          ts: Date.now(),
        })
      } else if (!context.agentDone && context.agentText) {
        emit(this.sessionId, {
          type: 'assistant:complete',
          id: messageId,
          text: context.agentText,
          ts: Date.now(),
        })
        context.agentDone = true
      }
    } catch (error) {
      emit(this.sessionId, {
        type: 'assistant:complete',
        id: messageId,
        text: `⚠️ ${error?.message || error}`,
        ts: Date.now(),
      })
    } finally {
      this.currentStream = null
      this.currentRun = null
    }
  }

  async interrupt() {
    if (this.currentRun) {
      this.currentRun.cancelled = true
    }
    if (this.currentStream && typeof this.currentStream.return === 'function') {
      try {
        await this.currentStream.return()
      } catch {
        // ignore
      }
    }
  }

  resetThread() {
    this.thread = null
    this.threadId = null
    this.threadOptions = null
  }
}

function getSession(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  let session = sessions.get(sessionId)
  if (!session) {
    session = new CodexSession(sessionId)
    sessions.set(sessionId, session)
  }
  return session
}

function optionsEqual(a, b) {
  if (!a || !b) return false
  if ((a.sandboxMode || '') !== (b.sandboxMode || '')) return false
  if ((a.workingDirectory || '') !== (b.workingDirectory || '')) return false
  return true
}

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let command
  try {
    command = JSON.parse(trimmed)
  } catch {
    return
  }

  if (!command || typeof command !== 'object') {
    return
  }

  const type = command.type
  const sessionId = typeof command.sessionId === 'string' ? command.sessionId : undefined

  if (type === 'interrupt') {
    if (!sessionId) return
    interruptSession(sessionId).catch(() => {})
    return
  }

  if (type === 'restart') {
    if (!sessionId) return
    interruptSession(sessionId)
      .catch(() => {})
      .finally(() => {
        resetThread(sessionId)
      })
    return
  }

  if (type === 'permission') {
    // Permissions are auto-approved; nothing to do
    return
  }

  if (type === 'register') {
    if (!sessionId) return
    const session = getSession(sessionId)
    session.register({
      threadId: typeof command.threadId === 'string' ? command.threadId : undefined,
      options: command.options,
    })
    return
  }

  if (type === 'run') {
    if (!sessionId) return
    const session = getSession(sessionId)
    session.enqueue(command)
    return
  }

  console.warn('[Codex SDK Handler] Unknown command type:', type)
})

process.on('SIGTERM', () => {
  process.exit(0)
})

process.on('SIGINT', () => {
  process.exit(0)
})

async function interruptSession(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  await session.interrupt()
}

function resetThread(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  session.resetThread()
}

function handleThreadEvent(event, context) {
  const session = context.session
  switch (event.type) {
    case 'thread.started':
      if (session) {
        session.updateThreadId(event.thread_id)
      } else if (context.sessionId) {
        emit(context.sessionId, {
          type: 'thread:update',
          threadId: event.thread_id,
          ts: Date.now(),
        })
      }
      return
    case 'turn.started':
      return
    case 'turn.completed':
      emit(context.sessionId, {
        type: 'telemetry:tokens',
        tokensIn: event.usage?.input_tokens ?? 0,
        tokensOut: event.usage?.output_tokens ?? 0,
        cachedTokens: event.usage?.cached_input_tokens ?? 0,
        tokenUsage: {
          input: event.usage?.input_tokens ?? 0,
          cachedInput: event.usage?.cached_input_tokens ?? 0,
          output: event.usage?.output_tokens ?? 0,
          reasoning: 0,
          total: (event.usage?.input_tokens ?? 0) + (event.usage?.output_tokens ?? 0),
        },
        ts: Date.now(),
      })
      return
    case 'turn.failed':
      emit(context.sessionId, {
        type: 'assistant:complete',
        id: context.messageId,
        text: `⚠️ ${event.error?.message || 'Turn failed'}`,
        ts: Date.now(),
      })
      context.agentDone = true
      return
    case 'error':
      emit(context.sessionId, {
        type: 'assistant:complete',
        id: context.messageId,
        text: `⚠️ ${event.message}`,
        ts: Date.now(),
      })
      context.agentDone = true
      return
    case 'item.started':
      handleItemEvent('started', event.item, context)
      return
    case 'item.updated':
      handleItemEvent('updated', event.item, context)
      return
    case 'item.completed':
      handleItemEvent('completed', event.item, context)
      return
    default:
      return
  }
}

function handleItemEvent(phase, item, context) {
  if (!item || typeof item !== 'object') return

  switch (item.type) {
    case 'agent_message':
      handleAgentMessage(phase, item, context)
      break
    case 'reasoning':
      if (context.showReasoning) {
        handleReasoning(phase, item, context)
      }
      break
    case 'command_execution':
      handleCommandExecution(phase, item, context)
      break
    case 'mcp_tool_call':
      handleMcpToolCall(phase, item, context)
      break
    case 'file_change':
      if (phase === 'completed') {
        handleFileChange(item, context)
      }
      break
    case 'todo_list':
      if (phase !== 'started') {
        emit(context.sessionId, {
          type: 'thinking',
          id: `${item.id || 'todo'}`,
          parentId: context.messageId,
          sequence: 0,
          text: formatTodoList(item.items || []),
          fullText: formatTodoList(item.items || []),
          done: phase === 'completed',
          ts: Date.now(),
        })
      }
      break
    case 'error':
      if (phase === 'completed') {
        emit(context.sessionId, {
          type: 'assistant:delta',
          id: context.messageId,
          chunk: `\n⚠️ ${item.message}`,
          ts: Date.now(),
        })
      }
      break
    default:
      break
  }
}

function handleAgentMessage(phase, item, context) {
  const next = sanitize(item.text || '')
  const prev = context.agentText || ''
  let formatted = next
  if (context.structured || looksLikeJson(next)) {
    const parsed = safeParseJson(next)
    if (parsed !== undefined) {
      context.structuredResult = parsed
      formatted = JSON.stringify(parsed, null, 2)
    }
  }
  if (next.length > prev.length) {
    const delta = diffText(prev, formatted)
    if (delta.trim().length > 0) {
      emit(context.sessionId, {
        type: 'assistant:delta',
        id: context.messageId,
        chunk: delta,
        ts: Date.now(),
      })
    }
  }
  context.agentText = formatted
  if (phase === 'completed') {
    emit(context.sessionId, {
      type: 'assistant:complete',
      id: context.messageId,
      text: formatted,
      ts: Date.now(),
    })
    context.agentDone = true
  }
}

function handleReasoning(phase, item, context) {
  const id = item.id || `reasoning-${context.messageId}`
  const state = context.reasoning.get(id) || { sequence: 0, text: '' }
  const fullText = sanitize(item.text || '')
  const delta = diffText(state.text, fullText)
  state.sequence += 1
  state.text = fullText
  context.reasoning.set(id, state)

  if (delta || phase === 'completed') {
    emit(context.sessionId, {
      type: 'thinking',
      id: `${id}::${state.sequence}`,
      parentId: context.messageId,
      sequence: state.sequence,
      text: delta || fullText,
      fullText,
      done: phase === 'completed',
      ts: Date.now(),
    })
  }

  if (phase === 'completed') {
    context.reasoning.delete(id)
  }
}

function handleCommandExecution(phase, item, context) {
  const id = item.id || `cmd-${Date.now()}`
  const state = context.commands.get(id) || { output: '' }

  if (phase === 'started') {
    context.commands.set(id, state)
    emit(context.sessionId, {
      type: 'tool:start',
      id,
      tool: 'bash',
      args: {
        command: item.command,
        submissionId: context.messageId,
      },
      ts: Date.now(),
    })
  }

  const aggregated = sanitize(item.aggregated_output || '')
  if (aggregated && aggregated !== state.output) {
    const delta = diffText(state.output, aggregated)
    const allowStreaming = context.displayMode === 'verbose' || context.displayMode === 'compact'
    if (delta.trim().length > 0 && allowStreaming) {
      emit(context.sessionId, {
        type: 'tool:output',
        id,
        chunk: delta,
        stream: 'stdout',
        ts: Date.now(),
      })
    }
    state.output = aggregated
  }

  if (phase === 'completed') {
    const allowStreaming = context.displayMode === 'verbose' || context.displayMode === 'compact'
    emit(context.sessionId, {
      type: 'tool:output',
      id,
      chunk: allowStreaming ? '' : state.output,
      done: true,
      exitCode: item.exit_code,
      ts: Date.now(),
    })
    context.commands.delete(id)
  }
}

function handleMcpToolCall(phase, item, context) {
  const id = item.id || `mcp-${Date.now()}`
  if (phase === 'started') {
    context.mcp.set(id, true)
    emit(context.sessionId, {
      type: 'tool:start',
      id,
      tool: 'mcp',
      args: {
        server: item.server,
        tool: item.tool,
      },
      ts: Date.now(),
    })
  }
  if (phase === 'completed') {
    emit(context.sessionId, {
      type: 'tool:output',
      id,
      chunk: `MCP ${item.status || 'completed'}`,
      done: true,
      ts: Date.now(),
    })
    context.mcp.delete(id)
  }
}

function handleFileChange(item, context) {
  const id = item.id || `file-${Date.now()}`
  const changes = Array.isArray(item.changes) ? item.changes : []
  const summary = changes
    .map((change) => formatFileChange(change))
    .join('\n') || 'Files changed'

  emit(context.sessionId, {
    type: 'tool:start',
    id,
    tool: 'file-change',
    args: {
      status: item.status,
      changes,
    },
    ts: Date.now(),
  })

  emit(context.sessionId, {
    type: 'tool:output',
    id,
    chunk: summary,
    done: true,
    ts: Date.now(),
  })
}

function formatFileChange(change) {
  if (!change || typeof change !== 'object') return ''
  const kind = String(change.kind || '').toLowerCase()
  const path = change.path || change.file || ''
  const symbol = kind === 'add' ? '+' : kind === 'delete' ? '−' : kind === 'update' ? '~' : '*'
  return `${symbol} ${path}`
}

function emit(sessionId, event) {
  if (!event || typeof event !== 'object') return
  const payload = { ...event }
  payload.ts = payload.ts || Date.now()
  if (sessionId) {
    payload.sessionId = sessionId
  }
  process.stdout.write(JSON.stringify(payload) + '\n')
}

function diffText(prev, next) {
  if (!next) return ''
  if (!prev) return next
  if (next.startsWith(prev)) {
    return next.slice(prev.length)
  }
  let i = 0
  const max = Math.min(prev.length, next.length)
  while (i < max && prev[i] === next[i]) {
    i++
  }
  return next.slice(i)
}

function sanitize(text) {
  if (!text) return ''
  return text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\u001b\[K/g, '')
    .replace(/\r/g, '')
}

function makeMessageId() {
  return `codex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function loadEnvFiles() {
  const candidates = [
    process.env.CODEX_ENV_FILE,
    path.join(process.cwd(), 'repos', 'codex', '.env'),
    path.join(process.cwd(), '.env'),
    process.env.BANSHEE_REPOS_DIR ? path.join(process.env.BANSHEE_REPOS_DIR, 'codex', '.env') : null,
    path.join(os.homedir(), '.banshee', 'codex', '.env'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      if (!candidate) continue
      if (!fs.existsSync(candidate)) continue
      const raw = fs.readFileSync(candidate, 'utf8')
      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return
        const idx = trimmed.indexOf('=')
        if (idx === -1) return
        const key = trimmed.slice(0, idx).trim()
        const value = trimmed.slice(idx + 1).trim()
        if (key && !(key in process.env)) {
          process.env[key] = value
        }
      })
      break
    } catch (err) {
      console.warn('[Codex SDK Handler] Failed to read env file', candidate, err)
    }
  }
}

function formatTodoList(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  return items.map((item, idx) => {
    const marker = item.completed ? '✓' : '•'
    return `${marker} ${item.text || `Step ${idx + 1}`}`
  }).join('\n')
}

function looksLikeJson(text) {
  if (!text) return false
  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function safeParseJson(text) {
  if (!looksLikeJson(text)) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

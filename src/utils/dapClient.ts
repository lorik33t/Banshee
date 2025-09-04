import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useDebug } from '../state/debugger'

export type DAPMessage = Record<string, unknown>

export class DAPClient {
  private id: string
  private buffer = ''
  private seq = 1
  private unlisten: UnlistenFn[] = []

  constructor(id: string) {
    this.id = id
  }

  async start(adapter: string, args: string[] = []) {
    await invoke('debugger_start', { id: this.id, adapter, args })
    this.unlisten.push(
      await listen<string>(`debugger:output:${this.id}`, e => this.handleData(e.payload))
    )
    this.unlisten.push(
      await listen<string>(`debugger:error:${this.id}`, e => console.error('debugger error', e.payload))
    )
  }

  private handleData(chunk: string) {
    this.buffer += chunk
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break
      const header = this.buffer.slice(0, headerEnd)
      const match = /Content-Length: (\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const length = parseInt(match[1], 10)
      const total = headerEnd + 4 + length
      if (this.buffer.length < total) break
      const body = this.buffer.slice(headerEnd + 4, total)
      this.buffer = this.buffer.slice(total)
      try {
        const msg = JSON.parse(body) as DAPMessage
        this.routeMessage(msg)
      } catch (err) {
        console.error('Failed to parse DAP message', err, body)
      }
    }
  }

  private routeMessage(msg: DAPMessage) {
    const store = useDebug.getState()
    if (msg.type === 'event' && msg.event === 'stopped') {
      const body = (msg as { body?: { threadId?: number } }).body
      if (body?.threadId !== undefined) {
        this.sendRequest('stackTrace', { threadId: body.threadId })
      }
    } else if (msg.type === 'response') {
      if (msg.command === 'stackTrace') {
        const body = (msg as { body?: { stackFrames?: unknown[] } }).body
        store.setCallStack(body?.stackFrames || [])
      } else if (msg.command === 'variables') {
        const body = (msg as { body?: { variables?: unknown[] } }).body
        store.setVariables(body?.variables || [])
      } else if (msg.command === 'setBreakpoints') {
        const body = (msg as { body?: { breakpoints?: unknown[] } }).body
        store.setBreakpoints(body?.breakpoints || [])
      }
    }
  }

  async sendRequest(command: string, args: Record<string, unknown> = {}) {
    const req = {
      seq: this.seq++,
      type: 'request',
      command,
      arguments: args,
    }
    const json = JSON.stringify(req)
    const len = new TextEncoder().encode(json).length
    const payload = `Content-Length: ${len}\r\n\r\n${json}`
    await invoke('debugger_send', { id: this.id, message: payload })
  }

  async stop() {
    await invoke('debugger_stop', { id: this.id })
    for (const u of this.unlisten) await u()
    this.unlisten = []
  }
}

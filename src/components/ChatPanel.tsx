import { useEffect, useRef, useState } from 'react'
import { useSession } from '../state/session'

export function ChatPanel() {
  const pushEvent = useSession((s) => s.pushEvent)
  const [input, setInput] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const api = (window as any).__TAURI__?.event
    if (!api) return
    let unlisten: any
    api.listen('claude:stream', (e: any) => {
      // forward raw event to state; mapping handled later
      pushEvent({ type: 'raw', payload: e.payload, ts: Date.now() } as any)
    }).then((u: any) => { unlisten = u })
    return () => { if (unlisten) unlisten() }
  }, [pushEvent])

  useEffect(() => {
    // auto-scroll
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  async function send() {
    const text = input.trim()
    if (!text) return
    // emit user message to UI state
    pushEvent({ id: String(Date.now()), type: 'message', role: 'user', text, ts: Date.now() } as any)
    setInput('')
    // send to backend process stdin
    const invoke = (window as any).__TAURI__?.core?.invoke
    try {
      await invoke?.('send_to_claude', { input: text })
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr auto' }}>
      <div className="chat-stream" ref={streamRef}>
        {/* TODO: render actual messages from state; placeholder assistant welcome */}
        <div className="msg-row">
          <div className="avatar">C</div>
          <div className="bubble assistant">
            <div className="role">assistant</div>
            <div className="text">Hi! What do you want to do in this repo?</div>
          </div>
        </div>
      </div>
      <div className="composer-wrap">
        <div className="composer-box">
          <textarea
            className="composer-input"
            rows={1}
            placeholder="Chat with Claude… /commands and @files supported"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
          />
          <div className="composer-actions">
            <button className="icon-btn" title="Slash commands">/</button>
            <button className="icon-btn" title="Attach files">@</button>
            <button className="btn btn--accent" onClick={send}>Send</button>
          </div>
        </div>
      </div>
    </div>
  )
}

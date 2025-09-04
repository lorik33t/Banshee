import { useEffect, useRef, useState } from 'react'
import { useSession } from '../state/session'
import { ModelRouter } from '../utils/modelRouter'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export function ChatPanel() {
  const pushEvent = useSession((s) => s.pushEvent)
  const [input, setInput] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)
  const [router] = useState(() => new ModelRouter())

  // NOTE: Composer already listens to 'claude:stream' and updates state.
  // Avoid registering another listener here to prevent duplicate rendering.

  useEffect(() => {
    // auto-scroll
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  async function send() {
    const text = input.trim()
    if (!text) return
    // Route model using the unified router
    const { model, reason } = router.selectModelWithReason(text)
    // emit user message to UI state with routing badge metadata
    pushEvent({ id: String(Date.now()), type: 'message', role: 'user', text, ts: Date.now(), model, routingReason: reason } as any)
    setInput('')
    // send to backend unified command so non-Claude models use their own handlers
    try {
      await tauriInvoke('send_to_model', {
        input: JSON.stringify({ currentMessage: text }),
        model
      })
    } catch (e) {
      // Best-effort fallback to Claude on error
      try {
        await tauriInvoke('send_to_model', {
          input: JSON.stringify({ currentMessage: text }),
          model: 'claude'
        })
      } catch {}
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
            placeholder="Describe your goal… Press Enter to send"
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

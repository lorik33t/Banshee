import { useState } from 'react'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { useSession } from '../state/session'

export function Composer() {
  const [input, setInput] = useState('')
  const pushEvent = useSession(s => s.pushEvent)

  const send = async () => {
    const text = input.trim()
    if (!text) return
    const ts = Date.now()
    pushEvent({ id: `u_${ts}`, type: 'message', role: 'user', text, ts })
    try {
      const response = await tauriInvoke<string>('send_to_model', { input: text, model: 'codex' })
      pushEvent({ id: `a_${ts}`, type: 'message', role: 'assistant', text: String(response), ts: Date.now() })
    } catch (err) {
      console.error(err)
    }
    setInput('')
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="composer">
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Type a command"
      />
      <button onClick={send}>Send</button>
    </div>
  )
}

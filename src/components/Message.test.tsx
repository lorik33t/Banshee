import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Message } from './Message'
import type { MessageEvent } from '../state/session'

describe('Message sanitization', () => {
  const baseMessage: Omit<MessageEvent, 'text'> & { text: string } = {
    id: '1',
    type: 'message',
    role: 'assistant',
    text: '',
    ts: 0
  }

  it('removes script tags from rendered content', () => {
    const message = { ...baseMessage, text: 'Hello<script>alert(1)</script>' }
    const html = renderToString(<Message message={message} />)
    expect(html).not.toContain('<script')
  })

  it('removes event handler attributes', () => {
    const message = { ...baseMessage, text: '<img src="x" onerror="alert(1)" />' }
    const html = renderToString(<Message message={message} />)
    expect(html).not.toContain('onerror')
  })
})

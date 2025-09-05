import { Copy, Check } from 'lucide-react'
import { useState, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { MessageEvent } from '../state/session'
 
interface MessageProps {
  message: MessageEvent
}

export function Message({ message }: MessageProps) {
  const [copied, setCopied] = useState(false)
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Configure marked options
  useMemo(() => {
    marked.setOptions({
      breaks: true,
      gfm: true
    })
  }, [])

  // Parse message for code blocks and markdown
  const parseContent = (text: string) => {
    const parts = []
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
    let lastIndex = 0
    let match

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Add text before code block (with markdown parsing)
      if (match.index > lastIndex) {
        const textContent = text.slice(lastIndex, match.index)
        parts.push({
          type: 'markdown',
          content: textContent
        })
      }

      // Add code block
      parts.push({
        type: 'code',
        language: match[1] || 'plaintext',
        content: match[2]
      })

      lastIndex = match.index + match[0].length
    }

    // Add remaining text (with markdown parsing)
    if (lastIndex < text.length) {
      const textContent = text.slice(lastIndex)
      parts.push({
        type: 'markdown',
        content: textContent
      })
    }

    return parts.length > 0 ? parts : [{ type: 'markdown', content: text }]
  }

  const content = parseContent(message.text)
  const hasDiffFence = /```diff\n[\s\S]*?```/.test(message.text)
  
  // Check if message has images in content array
  const messageImages = message.content?.filter((item: any) => item.type === 'image') || []

  // const roleName = message.role === 'user' ? 'You' : 'Banshee'

  // Assistant: no avatar, clean content
  if (message.role === 'assistant') {
    return (
      <div className={`message ${message.role} no-avatar`}>
        <div className="assistant-body">
          {message.model && (
            <div className="model-indicator">
              
              <span className="model-badge">
                {message.model === 'gemini-context' ? 'USING GEMINI' :
                 message.model === 'codex-executor' ? 'USING CODEX' :
                 message.model === 'qwen-automation' ? 'USING QWEN' :
                 message.model === 'claude' ? 'CLAUDE' : message.model}
              </span>
              {message.routingReason && (
                <span className="route-badge" style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-secondary)' }}>
                  {message.routingReason}
                </span>
              )}
            </div>
          )}
          
          {content.map((part, i) => {
            if (part.type === 'markdown') {
              return (
                <div
                  key={i}
                  className="message-text markdown-content"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked(part.content)) }}
                />
              )
            } else if (part.type === 'code') {
              return (
                <div key={i} className="code-block">
                  <div className="code-header">
                    <span className="code-language">{part.language}</span>
                    <button 
                      className="code-copy"
                      onClick={() => copyToClipboard(part.content)}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <pre className="code-content">
                    <code>{part.content}</code>
                  </pre>
                </div>
              )
            }
          })}
          {hasDiffFence && (
            <button className="chip" style={{ marginTop: 8 }} onClick={() => {
              import('../state/session').then(({ useSession }) => {
                useSession.getState().setWorkbenchTab('diffs')
              })
            }}>Open in Diffs</button>
          )}
          {message.tokens && (
            <div className="message-tokens">
              <span className="token-count">
                {message.tokens.input.toLocaleString()} tokens in / {message.tokens.output.toLocaleString()} tokens out
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // User: minimalist card (no heavy header)
  return (
    <div className={`message ${message.role} no-avatar`}>
      <div className="user-message">
        <button className="msg-action" onClick={() => copyToClipboard(message.text)} title="Copy">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        {messageImages.length > 0 && (
          <div className="message-images">
            {messageImages.map((img: any, idx: number) => (
              <div key={idx} className="message-image">
                <img src={img.url} alt={img.name || 'Image'} />
              </div>
            ))}
          </div>
        )}
        {content.map((part, i) => {
          if (part.type === 'markdown') {
            return (
              <div
                key={i}
                className="message-text markdown-content"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked(part.content)) }}
              />
            )
          } else if (part.type === 'code') {
            return (
              <div key={i} className="code-block">
                <div className="code-header">
                  <span className="code-language">{part.language}</span>
                  <button 
                    className="code-copy"
                    onClick={() => copyToClipboard(part.content)}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="code-content">
                  <code>{part.content}</code>
                </pre>
              </div>
            )
          }
        })}
      </div>
    </div>
  )
}

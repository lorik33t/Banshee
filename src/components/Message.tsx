import { Copy, Check, FileDiff, RefreshCcw } from 'lucide-react'
import { useState, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { StructuredMessage } from './StructuredMessage'
import type { MessageEvent } from '../state/session'
import { useSession } from '../state/session'
import { useEditor } from '../state/editor'
 
interface MessageProps {
  message: MessageEvent
  isStreaming?: boolean
  checkpointId?: string
  turnIndex?: number
  onRestoreTurn?: (turnIndex: number) => void
}

export function Message({ message, isStreaming = false, checkpointId, turnIndex, onRestoreTurn }: MessageProps) {
  const isAssistant = message.role === 'assistant'
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

  // Strip ANSI escape sequences and clean text
  const cleanAnsiText = (text: string) => {
    // Remove ANSI escape sequences (colors, formatting, etc.)
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*m/g, '')
              // eslint-disable-next-line no-control-regex
              .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
              // eslint-disable-next-line no-control-regex
              .replace(/\u001b\[K/g, '')
              .replace(/\r/g, '')
  }

  // Parse message for code blocks and markdown
  const renderMarkdown = (source: string) => {
    const cleanedSource = cleanAnsiText(source)
    const html = marked.parse(cleanedSource, { async: false }) as string
    return DOMPurify.sanitize(html)
  }

  const parseContent = (text: string) => {
    // Clean ANSI sequences from the entire text first
    const cleanText = cleanAnsiText(text)

    const parts = []
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
    let lastIndex = 0
    let match

    while ((match = codeBlockRegex.exec(cleanText)) !== null) {
      // Add text before code block (with markdown parsing)
      if (match.index > lastIndex) {
        const textContent = cleanText.slice(lastIndex, match.index)
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
    if (lastIndex < cleanText.length) {
      const textContent = cleanText.slice(lastIndex)
      parts.push({
        type: 'markdown',
        content: textContent
      })
    }

    return parts.length > 0 ? parts : [{ type: 'markdown', content: cleanText }]
  }

  const content = parseContent(message.text)
  const hasDiffFence = /```diff\n[\s\S]*?```/.test(cleanAnsiText(message.text))
  
  // Check if message has images in content array
  const messageImages = message.content?.filter((item: any) => item.type === 'image') || []

  // const roleName = message.role === 'user' ? 'You' : 'Banshee'

  // Assistant: no avatar, clean content
  if (isAssistant) {
    // Check if this looks like structured Codex output
    const cleanText = cleanAnsiText(message.text)
    const isStructuredOutput = cleanText.includes('•') ||
                              cleanText.includes('└') ||
                              cleanText.includes('├') ||
                              (cleanText.includes('List ') && cleanText.includes('Read ')) ||
                              cleanText.includes('exec bash') ||
                              cleanText.includes('Updated Plan') ||
                              cleanText.includes('Explored') ||
                              cleanText.includes('tokens used:')
    
    return (
      <div className={`message ${message.role} no-avatar ${isStreaming && isAssistant ? 'streaming' : ''}`}>
        <div className="assistant-body">
          <AssistantActions />
          {isStructuredOutput ? (
            <StructuredMessage
              content={cleanAnsiText(message.text)}
              model={message.model}
              tokens={message.tokens}
            />
          ) : (
            <>
              {content.map((part, i) => {
                if (part.type === 'markdown') {
                  return (
                    <div
                      key={i}
                      className="message-text markdown-content"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(part.content) }}
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
              {checkpointId && typeof turnIndex === 'number' && onRestoreTurn && (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="message-restore-btn"
                    onClick={() => onRestoreTurn(turnIndex)}
                  >
                    Restore checkpoint
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // User: minimalist card (no heavy header)
  return (
    <div className={`message ${message.role} no-avatar ${isStreaming && isAssistant ? 'streaming' : ''}`}>
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
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(part.content) }}
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

function AssistantActions() {
  const hasEdits = useSession((s) => s.edits.length > 0)
  const setActiveFile = useEditor((s) => s.setActiveFile)
  return (
    <div className="assistant-actions">
      {hasEdits && (
        <button
          className="assistant-action-btn"
          type="button"
          title="View diffs"
          onClick={() => {
            import('../state/session').then(({ useSession }) => {
              const state = useSession.getState()
              state.setWorkbenchTab('diffs')
              if (state.edits.length) {
                state.selectEdit(state.edits[state.edits.length - 1].id)
              }
            })
          }}
        >
          <FileDiff size={14} />
          <span>View diff</span>
        </button>
      )}
      <button
        className="assistant-action-btn"
        type="button"
        title="Re-run with same prompt"
        onClick={() => {
          setActiveFile(undefined)
          import('../state/session').then(({ useSession }) => {
            const state = useSession.getState()
            const lastUser = [...state.messages].reverse().find((m) => m.role === 'user')
            if (lastUser) {
              const event = new CustomEvent('composer:rerun', { detail: { text: lastUser.text } })
              window.dispatchEvent(event)
            }
          })
        }}
      >
        <RefreshCcw size={14} />
        <span>Retry</span>
      </button>
    </div>
  )
}

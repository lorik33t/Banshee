import { useEffect, useRef } from 'react'
import { useSession } from '../state/session'
import { Message } from './Message'
import { ThinkingOutput } from './ThinkingOutput'
import { ToolExecution } from './ToolExecution'
import { TerminalView2 } from './TerminalView2'
import { StreamingLoader } from './StreamingLoader'
import type { MessageEvent, ThinkingEvent } from '../state/session'

type ConversationItem =
  | { type: 'message'; event: MessageEvent }
  | { type: 'thinking'; event: ThinkingEvent; toolIds: string[] }
  | { type: 'tool'; event: any; toolIds: string[] }

export function ChatView() {
  const events = useSession((s) => s.events)
  const messages = useSession((s) => s.messages)
  const tools = useSession((s) => s.tools)
  const showTerminal = useSession((s) => s.showTerminal)
  const setShowTerminal = useSession((s) => s.setShowTerminal)
  const isStreaming = useSession((s) => s.isStreaming)
  const setStreaming = useSession((s) => s.setStreaming)
  const streamingStartTime = useSession((s) => s.streamingStartTime)
  const scrollRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    setStreaming(false)
  }, [setStreaming])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showTerminal) {
          setShowTerminal(false)
        } else if (isStreaming) {
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('interrupt_codex').catch(() => {})
          })
        }
      }
      if (e.key === 't' && e.metaKey) {
        e.preventDefault()
        setShowTerminal(!showTerminal)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showTerminal, setShowTerminal, isStreaming])

  const items: ConversationItem[] = []
  
  const messageMap = new Map<string, MessageEvent>()
  messages.forEach(msg => {
    const existing = messageMap.get(msg.id)
    if (!existing || (msg.ts ?? 0) > (existing.ts ?? 0)) {
      messageMap.set(msg.id, msg)
    }
  })
  
  messageMap.forEach(msg => {
    items.push({ type: 'message', event: msg })
  })

  const thinkingEvents = events.filter(
    (event): event is ThinkingEvent => event.type === 'thinking'
  )

  const reasoningByHeading = new Map<string, ThinkingEvent>()

  for (const event of thinkingEvents) {
    const currentText = (event.fullText ?? event.text ?? '').trim()
    if (currentText.length < 20) {
      continue
    }

    const headingMatch = currentText.match(/\*\*([^*]+)\*\*/)
    const heading = headingMatch ? headingMatch[1].trim() : ''
    if (!heading.length) {
      continue
    }

    const words = heading
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    const baseKey = words.slice(0, 2).join(' ') || heading.toLowerCase()
    const existing = reasoningByHeading.get(baseKey)

    if (!existing) {
      reasoningByHeading.set(baseKey, event)
      continue
    }

    const existingText = (existing.fullText ?? existing.text ?? '').trim()

    if (event.done && !existing.done) {
      reasoningByHeading.set(baseKey, event)
      continue
    }

    if (currentText.length >= existingText.length) {
      reasoningByHeading.set(baseKey, event)
    }
  }

  reasoningByHeading.forEach((event) => {
    items.push({ type: 'thinking', event, toolIds: [] })
  })

  Object.values(tools).forEach(tool => {
    if (tool && (tool.output || !tool.done)) {
      const toolName = (tool.tool || '').toLowerCase()
      const shouldShowAsCard = toolName === 'task' ||
                              toolName === 'webfetch' ||
                              toolName === 'websearch' ||
                              toolName === 'todowrite'

      if (shouldShowAsCard) {
        items.push({ type: 'tool', event: tool as any, toolIds: [tool.id] })
      }
    }
  })
  
  items.sort((a, b) => (a.event?.ts ?? 0) - (b.event?.ts ?? 0))

  if (items.length === 0 && !showTerminal) {
    return (
      <div className="chat-view" ref={scrollRef}>
        <div className="chat-content">
        </div>
      </div>
    )
  }

  return (
    <div className="chat-view">
      <div style={{ display: showTerminal ? 'block' : 'none', height: '100%' }}>
        <TerminalView2 />
      </div>
      
      <div 
        ref={scrollRef} 
        style={{ display: showTerminal ? 'none' : 'block', height: '100%' }}
      >
        <div className="chat-content">
          {items.map((item, i) => {
            if (item.type === 'message') {
              return <Message key={item.event.id} message={item.event} isStreaming={isStreaming} />
            } else if (item.type === 'thinking') {
              const toolRuns = item.toolIds
                .map((id) => tools[id])
                .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool && tool.output && tool.output.trim().length))
              const thinkingKey = `thinking-${(item.event as any).id ?? i}`
              return <ThinkingOutput key={thinkingKey} thinking={item.event} tools={toolRuns} />
            } else if (item.type === 'tool') {
              const tool = tools[item.toolIds[0]]
              if (tool) {
                return <ToolExecution key={`tool-${tool.id}`} tool={tool} />
              }
            }
            return null
          })}
          <div className="message assistant no-avatar">
            <div className="assistant-body">
              <StreamingLoader 
                active={isStreaming}
                startTime={streamingStartTime}
                label={'Thinking…'}
                showTimer={true}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

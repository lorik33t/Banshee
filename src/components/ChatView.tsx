import { useEffect, useRef } from 'react'
import { useSession } from '../state/session'
import { Message } from './Message'
import { ToolExecution } from './ToolExecution'
import { ThinkingOutput } from './ThinkingOutput'
import { TerminalView2 } from './TerminalView2'
import { StreamingLoader } from './StreamingLoader'
import type { MessageEvent, ThinkingEvent } from '../state/session'

type ConversationItem = 
  | { type: 'message'; event: MessageEvent }
  | { type: 'tools'; ids: string[] }
  | { type: 'thinking'; event: ThinkingEvent }

export function ChatView() {
  const events = useSession((s) => s.events)
  const tools = useSession((s) => s.tools)
  const showTerminal = useSession((s) => s.showTerminal)
  const setShowTerminal = useSession((s) => s.setShowTerminal)
  const isStreaming = useSession((s) => s.isStreaming)
  const setStreaming = useSession((s) => s.setStreaming)
  const streamingStartTime = useSession((s) => s.streamingStartTime)
  // const streamingModel = useSession((s) => s.streamingModel)
  // const cost = useSession((s) => s.cost)
  const scrollRef = useRef<HTMLDivElement>(null)
  
  // On first mount, ensure streaming is off
  useEffect(() => {
    setStreaming(false)
  }, [])

  useEffect(() => {
    // Auto-scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])
  
  // Handle ESC key to close terminal or cancel operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showTerminal) {
          setShowTerminal(false)
        } else if (isStreaming) {
          // Cancel streaming operation
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('stop_claude')
          })
        }
      }
      // Handle Cmd+T to toggle terminal
      if (e.key === 't' && e.metaKey) {
        e.preventDefault()
        setShowTerminal(!showTerminal)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showTerminal, setShowTerminal, isStreaming])

  // Sort events chronologically by ts to avoid insertion-order glitches
  const orderedEvents = [...events].sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0))
  
  // Group messages and other events into conversation items
  const items: ConversationItem[] = []
  let currentTools: string[] = []
  
  // Process events in chronological order, maintaining tool/message relationships
  for (const event of orderedEvents) {
    if (event.type === 'message') {
      
      // Flush any pending tools before the message
      if (currentTools.length > 0) {
        items.push({ type: 'tools', ids: currentTools })
        currentTools = []
      }
      items.push({ type: 'message', event })
    } else if (event.type === 'tool:start') {
      currentTools.push(event.id)
    } else if (event.type === 'thinking') {
      // Flush any pending tools before thinking
      if (currentTools.length > 0) {
        items.push({ type: 'tools', ids: currentTools })
        currentTools = []
      }
      items.push({ type: 'thinking', event })
    }
  }
  
  // Flush remaining tools
  if (currentTools.length > 0) {
    items.push({ type: 'tools', ids: currentTools })
  }

  if (items.length === 0 && !showTerminal) {
    return (
      <div className="chat-view" ref={scrollRef}>
        <div className="chat-content">
          {/* Empty state - no welcome message */}
        </div>
      </div>
    )
  }

  return (
    <div className="chat-view">
      {/* Terminal view - always rendered but hidden when not active */}
      <div style={{ display: showTerminal ? 'block' : 'none', height: '100%' }}>
        <TerminalView2 />
      </div>
      
      {/* Chat view - hidden when terminal is active */}
      <div 
        ref={scrollRef} 
        style={{ display: showTerminal ? 'none' : 'block', height: '100%' }}
      >
        <div className="chat-content">
          {items.map((item, i) => {
            if (item.type === 'message') {
              return <Message key={item.event.id} message={item.event} />
            } else if (item.type === 'tools') {
              return (
                <div key={`tools-${i}`} className="tool-group">
                  {item.ids.map(id => {
                    const tool = tools[id]
                    if (!tool) return null
                    return <ToolExecution key={id} tool={tool} />
                  })}
                </div>
              )
            } else if (item.type === 'thinking') {
              return <ThinkingOutput key={`thinking-${i}`} thinking={item.event} />
            }
            return null
          })}
          {/* Always mount loader; internal cooldown manages visibility to prevent flicker */}
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

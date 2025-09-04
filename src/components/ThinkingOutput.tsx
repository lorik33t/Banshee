import { Brain, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ThinkingEvent } from '../state/session'

interface ThinkingOutputProps {
  thinking: ThinkingEvent
}

export function ThinkingOutput({ thinking }: ThinkingOutputProps) {
  const [expanded, setExpanded] = useState(false)
  const lines = thinking.text.split('\n').length
  
  return (
    <div className="tool-group">
      <div className="tool-compact">
        <button 
          className="tool-compact-header"
          onClick={() => setExpanded(!expanded)}
          style={{ cursor: 'pointer' }}
        >
          <Brain size={14} className="tool-compact-icon" style={{ color: '#9333ea' }} />
          <span className="tool-compact-text">
            Thinking
            <span className="tool-compact-detail"> {lines} lines</span>
          </span>
          <ChevronRight 
            size={12} 
            className="tool-compact-chevron"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          />
        </button>
        
        {expanded && (
          <div className="tool-compact-body">
            <pre className="tool-compact-output">{thinking.text}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
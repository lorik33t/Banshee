import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface ThinkingSectionProps {
  content: string
  metadata?: any
}

export function ThinkingSection({ content }: ThinkingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  
  const parsedContent = parseThinkingContent(content)
  
  return (
    <div className="thinking-section">
      <div 
        className="thinking-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="thinking-icon">
          <Brain size={16} />
        </div>
        <span className="thinking-title">Thinking</span>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      
      {isExpanded && (
        <div className="thinking-content">
          {parsedContent.map((item, index) => (
            <ThinkingItem key={index} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

interface ThinkingItem {
  type: 'bullet' | 'hierarchy' | 'text' | 'bold'
  content: string
  level: number
  children?: ThinkingItem[]
}

function ThinkingItem({ item }: { item: ThinkingItem }) {
  const [isExpanded, setIsExpanded] = useState(true)
  
  if (item.type === 'hierarchy' && item.children && item.children.length > 0) {
    return (
      <div className={`thinking-hierarchy level-${item.level}`}>
        <div 
          className="hierarchy-header"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="hierarchy-indicator">
            {isExpanded ? '└' : '├'}
          </span>
          <span className="hierarchy-content">{item.content}</span>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
        
        {isExpanded && (
          <div className="hierarchy-children">
            {item.children.map((child, index) => (
              <ThinkingItem key={index} item={child} />
            ))}
          </div>
        )}
      </div>
    )
  }
  
  if (item.type === 'bullet') {
    return (
      <div className={`thinking-bullet level-${item.level}`}>
        <span className="bullet-indicator">•</span>
        <span className="bullet-content">{item.content}</span>
      </div>
    )
  }
  
  if (item.type === 'bold') {
    return (
      <div className={`thinking-bold level-${item.level}`}>
        <strong>{item.content}</strong>
      </div>
    )
  }
  
  return (
    <div className={`thinking-text level-${item.level}`}>
      {item.content}
    </div>
  )
}

function parseThinkingContent(content: string): ThinkingItem[] {
  // Much simpler approach - just return the content as a single text item
  // This prevents the token-by-token card problem
  return [{
    type: 'text',
    content: content.trim(),
    level: 0
  }]
}

import { useState } from 'react'
import { CheckCircle, Circle, ChevronDown, ChevronRight, Target, Terminal } from 'lucide-react'

interface ProgressSectionProps {
  content: string
  metadata?: any
}

export function ProgressSection({ content }: ProgressSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const parsedContent = parseProgressContent(content)

  return (
    <div className="progress-section">
      <div
        className="progress-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="progress-icon">
          <Target size={16} />
        </div>
        <span className="progress-title">Progress</span>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isExpanded && (
        <div className="progress-content">
          {parsedContent.map((section, index) => (
            <ProgressSubsection key={index} section={section} />
          ))}
        </div>
      )}
    </div>
  )
}

// New Codex-style workflow section component
interface WorkflowSectionProps {
  title: string
  content: string
  isComplete?: boolean
  hasTools?: boolean
  defaultExpanded?: boolean
}

export function WorkflowSection({
  title,
  content,
  isComplete = false,
  hasTools = false,
  defaultExpanded = false
}: WorkflowSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const getIcon = () => {
    if (hasTools) return <Terminal size={14} />
    return <CheckCircle size={14} />
  }

  return (
    <div className="workflow-section">
      <button
        className={`workflow-section-header ${isComplete ? 'complete' : 'active'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="workflow-section-icon">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <div className="workflow-section-indicator">
          {getIcon()}
        </div>
        <div className="workflow-section-title">{title}</div>
      </button>

      {isExpanded && (
        <div className="workflow-section-content">
          <div className="workflow-content">
            {content}
          </div>
        </div>
      )}
    </div>
  )
}

interface ProgressSectionData {
  title: string
  items: ProgressItem[]
  type: 'plan' | 'explored' | 'other'
}

interface ProgressItem {
  text: string
  status: 'completed' | 'pending' | 'in_progress'
  level: number
}

function ProgressSubsection({ section }: { section: ProgressSectionData }) {
  const [isExpanded, setIsExpanded] = useState(true)
  
  const getSectionIcon = () => {
    switch (section.type) {
      case 'plan':
        return <Target size={14} />
      case 'explored':
        return <CheckCircle size={14} />
      default:
        return <Circle size={14} />
    }
  }
  
  const completedCount = section.items.filter(item => item.status === 'completed').length
  const totalCount = section.items.length
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0
  
  return (
    <div className="progress-subsection">
      <div 
        className="progress-subsection-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="progress-subsection-icon">
          {getSectionIcon()}
        </div>
        <span className="progress-subsection-title">{section.title}</span>
        <div className="progress-stats">
          {completedCount}/{totalCount} ({Math.round(progressPercent)}%)
        </div>
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>
      
      {isExpanded && (
        <div className="progress-items">
          {section.items.map((item, index) => (
            <ProgressItem key={index} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProgressItem({ item }: { item: ProgressItem }) {
  const getStatusIcon = () => {
    switch (item.status) {
      case 'completed':
        return <CheckCircle size={12} className="text-green-500" />
      case 'in_progress':
        return <Circle size={12} className="text-blue-500" />
      case 'pending':
        return <Circle size={12} className="text-gray-400" />
      default:
        return <Circle size={12} className="text-gray-400" />
    }
  }
  
  return (
    <div className={`progress-item level-${item.level}`}>
      <div className="progress-item-icon">
        {getStatusIcon()}
      </div>
      <span className="progress-item-text">{item.text}</span>
    </div>
  )
}

function parseProgressContent(content: string): ProgressSectionData[] {
  const lines = content.split('\n').filter(line => line.trim())
  const sections: ProgressSectionData[] = []
  let currentSection: ProgressSectionData | null = null
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    
    // Look for section headers
    if (trimmed.includes('Updated Plan') || trimmed.includes('Explored')) {
      // Save previous section
      if (currentSection) {
        sections.push(currentSection)
      }
      
      currentSection = {
        title: trimmed,
        items: [],
        type: trimmed.includes('Plan') ? 'plan' : 'explored'
      }
      continue
    }
    
    // Look for progress items
    if (currentSection) {
      const itemMatch = trimmed.match(/^(\s*)([└├│]?\s*)([✔□]?)\s*(.+)/)
      if (itemMatch) {
        const [, indent, , status, text] = itemMatch
        const level = Math.floor(indent.length / 2)
        
        let itemStatus: 'completed' | 'pending' | 'in_progress' = 'pending'
        if (status === '✔') {
          itemStatus = 'completed'
        } else if (status === '□') {
          itemStatus = 'pending'
        }
        
        currentSection.items.push({
          text: text.trim(),
          status: itemStatus,
          level
        })
      }
    }
  }
  
  // Add the last section
  if (currentSection) {
    sections.push(currentSection)
  }
  
  return sections
}

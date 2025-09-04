import { ChevronRight, Terminal, FileText, Search, Globe, FileEdit, Cpu, Sparkles, Zap, Code } from 'lucide-react'
import { useState } from 'react'
import type { ToolRun } from '../state/session'

interface ToolExecutionProps {
  tool: ToolRun
}

const toolIcons = {
  bash: Terminal,
  grep: Search,
  read: FileText,
  write: FileEdit,
  web: Globe,
  mcp: Terminal,
  task: Cpu
}

const subagentIcons = {
  'gemini-context': Sparkles,
  'qwen-automation': Zap,
  'codex-executor': Code
}

export function ToolExecution({ tool }: ToolExecutionProps) {
  const [expanded, setExpanded] = useState(false)
  const hasOutput = !!tool.output && tool.output.trim().length > 0
  
  // Check if this is a subagent task
  const subagentType = tool.tool === 'task' ? tool.args.subagent_type as string : null
  
  const Icon = subagentType && subagentIcons[subagentType as keyof typeof subagentIcons] 
    ? subagentIcons[subagentType as keyof typeof subagentIcons] 
    : (toolIcons[tool.tool as keyof typeof toolIcons] || Terminal)
  
  // Generate compact summary
  const getSummary = () => {
    const toolName = tool.tool.toLowerCase()
    
    if (toolName === 'task') {
      // Do not display model/subagent names in UI; keep neutral
      return 'Task'
    }
    
    // Simple tool names
    const simpleNames: Record<string, string> = {
      'bash': 'Bash',
      'read': 'Read',
      'write': 'Write',
      'edit': 'Edit',
      'multiedit': 'Edit',
      'grep': 'Grep',
      'glob': 'Glob',
      'ls': 'List',
      'webfetch': 'Web',
      'websearch': 'Search',
      'todowrite': 'Todo',
      'exitplanmode': 'Plan',
      'notebookedit': 'Notebook'
    }
    
    return simpleNames[toolName] || tool.tool
  }
  
  // Get file path or detail  
  const getDetail = () => {
    const toolName = tool.tool.toLowerCase()
    
    if (toolName === 'task') {
      const desc = tool.args.description || ''
      return desc.length > 25 ? desc.substring(0, 25) + '...' : desc
    }
    
    if (toolName === 'read' || toolName === 'write' || toolName === 'edit' || toolName === 'multiedit') {
      const path = tool.args.file_path || ''
      const parts = path.split('/')
      return parts[parts.length - 1] || ''
    }
    
    if (toolName === 'bash') {
      const cmd = tool.args.command || ''
      if (cmd.includes('npm')) return cmd.split(' ').slice(0, 3).join(' ')
      if (cmd.includes('git')) return cmd.split(' ').slice(0, 3).join(' ')
      return cmd.length > 30 ? cmd.substring(0, 30) + '...' : cmd
    }
    
    if (toolName === 'grep' || toolName === 'glob') {
      const pattern = tool.args.pattern || ''
      return pattern.length > 20 ? pattern.substring(0, 20) + '...' : pattern
    }
    
    if (toolName === 'websearch' || toolName === 'webfetch') {
      const query = tool.args.query || tool.args.url || ''
      return query.length > 25 ? query.substring(0, 25) + '...' : query
    }
    
    return ''
  }

  const summary = getSummary()
  const detail = getDetail()

  return (
    <>
      <div className={`tool-compact ${expanded ? 'expanded' : ''} ${subagentType ? 'is-subagent' : ''}`} data-tool={tool.tool}>
        <button 
          className="tool-compact-header"
          
          onClick={() => hasOutput ? setExpanded(!expanded) : undefined}
          style={{ cursor: hasOutput ? 'pointer' : 'default' }}
        >
          <Icon size={12} className="tool-compact-icon" />
          <span className="tool-compact-text">
            {summary}
            {detail && <span className="tool-compact-detail">{detail}</span>}
          </span>
          {hasOutput && (
            <ChevronRight 
              size={10} 
              className="tool-compact-chevron"
              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
            />
          )}
        </button>
      </div>
      {expanded && hasOutput && (
        <div className="tool-compact-output-wrapper">
          <pre className="tool-compact-output">{tool.output}</pre>
        </div>
      )}
    </>
  )
}
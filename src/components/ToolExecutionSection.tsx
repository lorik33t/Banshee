import { useState } from 'react'
import { Terminal, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock } from 'lucide-react'

interface ToolExecutionSectionProps {
  content: string
  metadata?: any
}

export function ToolExecutionSection({ content }: ToolExecutionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  
  const parsedContent = parseToolExecutionContent(content)
  
  return (
    <div className="tool-execution-section">
      <div 
        className="tool-execution-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="tool-execution-icon">
          <Terminal size={16} />
        </div>
        <span className="tool-execution-title">Tool Execution</span>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      
      {isExpanded && (
        <div className="tool-execution-content">
          {parsedContent.map((execution, index) => (
            <ToolExecution key={index} execution={execution} />
          ))}
        </div>
      )}
    </div>
  )
}

interface ToolExecution {
  command: string
  status: 'success' | 'failure' | 'running'
  duration?: string
  output?: string
  timestamp?: string
  workingDir?: string
}

function ToolExecution({ execution }: { execution: ToolExecution }) {
  const [showOutput, setShowOutput] = useState(false)
  
  const getStatusIcon = () => {
    switch (execution.status) {
      case 'success':
        return <CheckCircle size={14} className="text-green-500" />
      case 'failure':
        return <XCircle size={14} className="text-red-500" />
      case 'running':
        return <Clock size={14} className="text-blue-500" />
      default:
        return null
    }
  }
  
  const getStatusText = () => {
    switch (execution.status) {
      case 'success':
        return `succeeded in ${execution.duration}`
      case 'failure':
        return `failed in ${execution.duration}`
      case 'running':
        return 'running...'
      default:
        return ''
    }
  }
  
  return (
    <div className="tool-execution">
      <div className="execution-header">
        <div className="execution-status">
          {getStatusIcon()}
          <span className="execution-command">{execution.command}</span>
        </div>
        <div className="execution-meta">
          {execution.workingDir && (
            <span className="execution-dir">in {execution.workingDir}</span>
          )}
          {execution.timestamp && (
            <span className="execution-time">{execution.timestamp}</span>
          )}
        </div>
      </div>
      
      <div className="execution-status-text">
        {getStatusText()}
      </div>
      
      {execution.output && (
        <div className="execution-output">
          <button
            className="output-toggle"
            onClick={() => setShowOutput(!showOutput)}
          >
            {showOutput ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Output ({execution.output.length} chars)
          </button>
          
          {showOutput && (
            <pre className="output-content">
              {execution.output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function parseToolExecutionContent(content: string): ToolExecution[] {
  const lines = content.split('\n')
  const executions: ToolExecution[] = []
  let currentExecution: Partial<ToolExecution> | null = null
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    
    // Look for command execution patterns
    const execMatch = line.match(/\[([^\]]+)\]\s+exec\s+(.+)/)
    if (execMatch) {
      // Save previous execution
      if (currentExecution && currentExecution.command) {
        executions.push(currentExecution as ToolExecution)
      }
      
      currentExecution = {
        command: execMatch[2],
        timestamp: execMatch[1],
        status: 'running'
      }
      continue
    }
    
    // Look for success/failure status
    const successMatch = line.match(/succeeded in (\d+ms)/)
    if (successMatch && currentExecution) {
      currentExecution.status = 'success'
      currentExecution.duration = successMatch[1]
      continue
    }
    
    const failureMatch = line.match(/failed in (\d+ms)/)
    if (failureMatch && currentExecution) {
      currentExecution.status = 'failure'
      currentExecution.duration = failureMatch[1]
      continue
    }
    
    // Look for working directory
    const dirMatch = line.match(/in (.+)/)
    if (dirMatch && currentExecution) {
      currentExecution.workingDir = dirMatch[1]
      continue
    }
    
    // Look for output content
    if (currentExecution && !line.includes('[') && !line.includes('tokens used')) {
      if (!currentExecution.output) {
        currentExecution.output = line
      } else {
        currentExecution.output += '\n' + line
      }
    }
  }
  
  // Add the last execution
  if (currentExecution && currentExecution.command) {
    executions.push(currentExecution as ToolExecution)
  }
  
  return executions
}

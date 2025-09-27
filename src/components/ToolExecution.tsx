import { ChevronRight, Terminal, FileText, Search, Globe, FileEdit, Cpu, Sparkles, Zap, Code, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
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
} as const

const subagentIcons = {
  'gemini-context': Sparkles,
  'qwen-automation': Zap,
  'codex-executor': Code
} as const

function formatDuration(ms?: number) {
  if (ms === undefined) return undefined
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 100) / 10
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return `${minutes}m ${remaining}s`
}

export function ToolExecution({ tool }: ToolExecutionProps) {
  const [expanded, setExpanded] = useState(Boolean(tool.output?.trim()))
  const isRunning = !tool.done
  const hasOutput = Boolean(tool.output && tool.output.trim().length)
  const subagentType = tool.tool === 'task' ? (tool.args.subagent_type as string | undefined) : undefined

  const Icon = useMemo(() => {
    if (subagentType && subagentIcons[subagentType as keyof typeof subagentIcons]) {
      return subagentIcons[subagentType as keyof typeof subagentIcons]
    }
    return toolIcons[tool.tool as keyof typeof toolIcons] || Terminal
  }, [tool.tool, subagentType])

  const summary = useMemo(() => {
    const name = tool.tool.toLowerCase()
    if (name === 'task') return 'Task'
    const simple: Record<string, string> = {
      bash: 'Command',
      read: 'Read',
      write: 'Write',
      edit: 'Edit',
      multiedit: 'Edit',
      grep: 'Search',
      glob: 'Search',
      ls: 'List',
      webfetch: 'Web request',
      websearch: 'Search',
      todowrite: 'Todo',
      exitplanmode: 'Plan',
      notebookedit: 'Notebook'
    }
    return simple[name] || tool.tool
  }, [tool.tool])

  const detail = useMemo(() => {
    const name = tool.tool.toLowerCase()
    if (name === 'task') {
      const desc = (tool.args.description || '').toString()
      return desc.length > 48 ? `${desc.slice(0, 45)}…` : desc
    }
    if (name === 'bash') {
      const cmd = (tool.args.command || tool.args.raw || '').toString()
      return cmd.length > 48 ? `${cmd.slice(0, 45)}…` : cmd
    }
    if (name === 'read' || name === 'write' || name === 'edit' || name === 'multiedit') {
      const path = (tool.args.file_path || tool.args.path || tool.args.file || '').toString()
      return path
    }
    if (name === 'grep' || name === 'glob') {
      const pattern = (tool.args.pattern || tool.args.query || '').toString()
      return pattern
    }
    if (name === 'websearch' || name === 'webfetch') {
      const query = (tool.args.query || tool.args.url || '').toString()
      return query
    }
    return undefined
  }, [tool])

  const startTime = tool.startedAt ? new Date(tool.startedAt) : undefined
  const completedTime = tool.completedAt ? new Date(tool.completedAt) : undefined
  const duration = startTime && completedTime ? formatDuration(tool.completedAt! - tool.startedAt!) : undefined

  const StatusIcon = isRunning ? Clock : tool.exitCode === 0 || tool.exitCode === undefined ? CheckCircle2 : XCircle
  const statusColor = isRunning ? undefined : tool.exitCode === 0 || tool.exitCode === undefined ? '#10b981' : '#ef4444'
  const statusLabel = isRunning
    ? 'Running…'
    : tool.exitCode === 0 || tool.exitCode === undefined
      ? 'Completed'
      : `Exited ${tool.exitCode}`

  return (
    <div className={`tool-compact ${expanded ? 'expanded' : ''} ${subagentType ? 'is-subagent' : ''} ${isRunning ? 'is-running' : ''}`} data-tool={tool.tool}>
      <button
        className="tool-compact-header"
        onClick={() => setExpanded((prev) => !prev)}
        style={{ cursor: 'pointer' }}
      >
        <Icon size={12} className="tool-compact-icon" />
        <span className="tool-compact-text">
          {summary}
          {detail && <span className="tool-compact-detail">{detail}</span>}
        </span>
        <span className="tool-status-chip" style={{ color: statusColor }}>
          <StatusIcon size={12} />
          {statusLabel}
        </span>
        <ChevronRight
          size={10}
          className="tool-compact-chevron"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
        />
      </button>
      <div className="tool-compact-meta">
        {startTime && <span>{startTime.toLocaleTimeString()}</span>}
        {duration && <span>· {duration}</span>}
      </div>
      {expanded && (
        <div className="tool-compact-output-wrapper">
          {hasOutput ? (
            <pre className="tool-compact-output">{tool.output}</pre>
          ) : (
            <div className="tool-compact-output tool-compact-output--empty">No output captured</div>
          )}
        </div>
      )}
    </div>
  )
}

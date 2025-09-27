import { Brain, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ThinkingEvent, ToolRun } from '../state/session'

marked.setOptions({ breaks: true, gfm: true })

interface ThinkingOutputProps {
  thinking: ThinkingEvent
  tools?: ToolRun[]
}

type ThinkingSection = {
  title: string
  body?: string
}

export function ThinkingOutput({ thinking, tools = [] }: ThinkingOutputProps) {
  const section = useMemo(() => extractThinkingSection(thinking), [thinking.id, thinking.text, thinking.fullText])
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    setIsExpanded(false)
  }, [thinking.id])

  if (!section) return null

  const visibleTools = useMemo(
    () => tools.filter((tool) => tool.output && tool.output.trim().length > 0),
    [tools]
  )

  const interactive = Boolean((section.body && section.body.trim().length > 0) || visibleTools.length > 0)

  return (
    <div className="tool-group thinking-stack">
      <div className={`tool-compact ${!thinking.done ? 'thinking-active' : ''}`} key={thinking.id}>
        <button
          className="tool-compact-header"
          onClick={() => interactive && setIsExpanded((prev) => !prev)}
          disabled={!interactive}
          style={{ cursor: interactive ? 'pointer' : 'default' }}
        >
          <Brain size={14} className="tool-compact-icon" style={{ color: '#9333ea' }} />
          <span className="tool-compact-text">{section.title}</span>
          <ChevronRight
            size={12}
            className="tool-compact-chevron"
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', opacity: interactive ? 1 : 0.25 }}
          />
        </button>

        {isExpanded && (
          <div className="tool-compact-body">
            {section.body && section.body.trim().length > 0 && (
              <div
                className="thinking-body markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.body) }}
              />
            )}
            {visibleTools.length > 0 && (
              <div className="thinking-tool-list">
                {visibleTools.map((tool) => (
                  <div key={tool.id} className="thinking-tool-block">
                    <div className="thinking-tool-meta">
                      <code>{summarizeTool(tool)}</code>
                    </div>
                    <pre className="tool-compact-output">{stripAnsi(tool.output)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function extractThinkingSection(thinking: ThinkingEvent): ThinkingSection | null {
  const chunk = typeof thinking.text === 'string' ? thinking.text : ''
  const accumulated = typeof thinking.fullText === 'string' ? thinking.fullText : ''
  const source = accumulated.trim().length > 0 ? accumulated : chunk
  const cleaned = stripAnsi(source)
  if (!cleaned.trim().length) {
    return null
  }

  const lines = cleaned.split(/\r?\n/)
  let title = ''
  const bodyLines: string[] = []
  let pendingRemainder: string | null = null

  for (const line of lines) {
    if (!title) {
      const heading = extractHeadingFromLine(line)
      if (heading) {
        title = heading.title
        if (heading.remainder && heading.remainder.trim().length) {
          pendingRemainder = heading.remainder
        }
        continue
      }

      const trimmed = line.trim()
      if (!trimmed.length) {
        continue
      }
      title = trimmed
      continue
    }

    const lineClean = line.trim()
    const titleClean = title.replace(/\(\d+\)$/, '').trim()
    if (
      lineClean === title ||
      lineClean === `**${title}**` ||
      lineClean === titleClean ||
      lineClean === `**${titleClean}**`
    ) {
      continue
    }

    if (pendingRemainder) {
      bodyLines.push(pendingRemainder)
      pendingRemainder = null
    }

    bodyLines.push(line)
  }

  if (!title.length) {
    title = 'Thinking'
  }

  if (pendingRemainder) {
    bodyLines.unshift(pendingRemainder)
  }

  const body = bodyLines.join('\n').trim()
  return { title, body }
}

function extractHeadingFromLine(line: string): { title: string; remainder?: string } | null {
  const hashMatch = line.match(/^\s*#{1,6}\s+(.*)$/)
  if (hashMatch) {
    return { title: hashMatch[1].trim() }
  }

  const boldMatch = line.match(/^\s*\*\*(.+?)\*\*\s*(.*)$/)
  if (boldMatch) {
    return { title: boldMatch[1].trim(), remainder: boldMatch[2] }
  }

  return null
}

function renderMarkdown(source: string): string {
  const cleaned = stripAnsi(source).trim()
  const html = marked.parse(cleaned, { async: false }) as string
  return DOMPurify.sanitize(html)
}

function summarizeTool(tool: ToolRun): string {
  const name = (tool.tool || '').toString().toLowerCase()
  if (name === 'bash') {
    const cmd = (tool.args?.command || tool.args?.raw || '').toString()
    return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd
  }
  if (name === 'read' || name === 'write' || name === 'edit' || name === 'multiedit') {
    const path = (tool.args?.file_path || tool.args?.path || tool.args?.file || '').toString()
    return `${tool.tool}: ${path}`
  }
  if (name === 'grep' || name === 'rg') {
    const pattern = (tool.args?.pattern || tool.args?.query || '').toString()
    return `${tool.tool}: ${pattern}`
  }
  if (name === 'task') {
    const desc = (tool.args?.description || '').toString()
    return desc.length ? `${tool.tool}: ${desc}` : tool.tool
  }
  return tool.tool
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\u001b\[K/g, '')
    .replace(/\r/g, '')
    .replace(/[\u001b\x1b]\[[0-9;]*[A-Za-z]/g, '')
}

import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

function renderTreeStructure(content: string) {
  const lines = content.split('\n')

  return lines.map((line, index) => {
    // Main sections (• Explored)
    if (line.startsWith('• ')) {
      return (
        <div key={index} className="tree-main-section">
          {line}
        </div>
      )
    }

    // Sub-sections with tree characters
    if (line.includes('└') || line.includes('├') || line.includes('│')) {
      const indent = line.search(/[^\s]/)
      return (
        <div key={index} className="tree-sub-section" style={{ paddingLeft: `${indent * 8}px` }}>
          {line}
        </div>
      )
    }

    // Progress indicators
    if (line.includes('(') && (line.includes('m ') || line.includes('s ')) && line.includes('Esc to interrupt')) {
      return (
        <div key={index} className="tree-progress">
          {line}
        </div>
      )
    }

    // Regular indented content
    const indent = line.search(/[^\s]/)
    if (indent > 0) {
      return (
        <div key={index} className="tree-content" style={{ paddingLeft: `${indent * 8}px` }}>
          {line}
        </div>
      )
    }

    return (
      <div key={index} className="tree-line">
        {line}
      </div>
    )
  })
}

interface StructuredMessageProps {
  content: string
  model?: string
  tokens?: { input: number; output: number }
}

interface CodexSection {
  type: 'thinking' | 'command' | 'response' | 'tokens'
  content: string
  metadata?: any
}

export function StructuredMessage({ content }: StructuredMessageProps) {
  const sections = useMemo(() => parseCodexOutput(content), [content])

  const renderMarkdown = (source: string) => {
    const html = marked.parse(source, { async: false }) as string
    return DOMPurify.sanitize(html)
  }

  const cleanAnsi = (text: string) => {
    return text
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*m/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\u001b\[K/g, '')
      .replace(/\r/g, '')
  }

  return (
    <div className="structured-message">
      {sections.map((section, index) => (
        <div key={index} className={`codex-section ${section.type}`}>
          {section.type === 'thinking' && (
            <div className="thinking-header">
              <span className="thinking-icon">🧠</span>
              <span className="thinking-title">Thinking</span>
            </div>
          )}
          {section.type === 'command' && (
            <div className="command-header">
              <span className="command-icon">⚡</span>
              <span className="command-title">Command</span>
            </div>
          )}
          {section.type === 'tokens' && (
            <div className="tokens-header">
              <span className="tokens-icon">📊</span>
              <span className="tokens-title">Token Usage</span>
            </div>
          )}
          <div className="codex-content">
            {section.metadata?.isTreeFormat ? (
              <div className="tree-structure">
                {renderTreeStructure(section.content)}
              </div>
            ) : (
              <div
                className="codex-markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(cleanAnsi(section.content)) }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function parseCodexOutput(content: string): CodexSection[] {
  // Check if this is the tree structure format
  if (content.includes('• ') ||
      content.includes('└') ||
      content.includes('├') ||
      (content.includes('List ') && content.includes('Read ')) ||
      /^\s*(List|Read)\s+/.test(content.trim())) {
    return [{ type: 'response', content: content, metadata: { isTreeFormat: true } }]
  }

  const lines = content.split('\n')
  const sections: CodexSection[] = []
  let currentSection: CodexSection | null = null
  let currentContent: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect thinking sections
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      if (currentSection) {
        currentSection.content = currentContent.join('\n')
        sections.push(currentSection)
      }
      currentSection = { type: 'thinking', content: '', metadata: {} }
      currentContent = [line]
      continue
    }

    // Detect command execution
    if (trimmed.includes('exec bash') || trimmed.includes('succeeded in') || trimmed.includes('failed in')) {
      if (currentSection) {
        currentSection.content = currentContent.join('\n')
        sections.push(currentSection)
      }
      currentSection = { type: 'command', content: '', metadata: {} }
      currentContent = [line]
      continue
    }

    // Detect token usage
    if (trimmed.includes('tokens used:')) {
      if (currentSection) {
        currentSection.content = currentContent.join('\n')
        sections.push(currentSection)
      }
      currentSection = { type: 'tokens', content: '', metadata: {} }
      currentContent = [line]
      continue
    }

    // Detect final response (codex section)
    if (trimmed === 'codex' || (trimmed.startsWith('**') && !trimmed.endsWith('**'))) {
      if (currentSection) {
        currentSection.content = currentContent.join('\n')
        sections.push(currentSection)
      }
      currentSection = { type: 'response', content: '', metadata: {} }
      currentContent = [line]
      continue
    }

    // Continue current section
    if (currentSection) {
      currentContent.push(line)
    } else {
      // Start a new response section
      currentSection = { type: 'response', content: '', metadata: {} }
      currentContent = [line]
    }
  }

  // Add the last section
  if (currentSection) {
    currentSection.content = currentContent.join('\n')
    sections.push(currentSection)
  }

  return sections
}

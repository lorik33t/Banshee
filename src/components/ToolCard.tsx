import { useMemo } from 'react'
import { useSession } from '../state/session'
import type { ToolRun } from '../state/session'

export function ToolCard({ run }: { run: ToolRun }) {
  const title = useMemo(() => run.tool.toUpperCase(), [run.tool])
  return (
    <div className="panel" style={{ padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="chip">{run.done ? 'Done' : 'Running'}</div>
      </div>
      <pre style={{
        margin: 0, whiteSpace: 'pre-wrap', color: 'var(--muted)',
        fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12
      }}>{run.output || '…'}</pre>
    </div>
  )
}

export function ToolStack() {
  const tools = useSession((s) => s.tools)
  const items = Object.values(tools)
  if (items.length === 0) return null
  return (
    <div style={{ marginTop: 8 }}>
      {items.map((run) => (
        <ToolCard key={run.id} run={run} />
      ))}
    </div>
  )
}

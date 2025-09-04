import { DiffEditor } from '@monaco-editor/react'
import { useSession } from '../state/session'

export function DiffPanel() {
  const edits = useSession((s) => s.edits)
  const selectedId = useSession((s) => s.selectedEditId)
  const select = useSession((s) => s.selectEdit)
  const accept = useSession((s) => s.acceptEdit)
  const reject = useSession((s) => s.rejectEdit)

  if (edits.length === 0) {
    return (
      <div className="scroll" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>Proposed edits</div>
          <div className="pill">No edits</div>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, color: 'var(--text-muted)' }}>
          No edits yet. Ask Claude to make a change.
        </div>
      </div>
    )
  }

  const current = edits.find((e) => e.id === selectedId) || edits[0]

  return (
    <div className="scroll" style={{ padding: 16, display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, flex: 1 }}>{current.file}</div>
        <button className="btn btn--accent" onClick={() => accept(current.id)}>Accept</button>
        <button className="btn btn--ghost" onClick={() => reject(current.id)}>Reject</button>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <DiffEditor
          original={current.before}
          modified={current.after}
          height="100%"
          theme="vs-dark"
          options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false } }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, overflowX: 'auto' }}>
        {edits.map((e) => (
          <button
            key={e.id}
            className="chip"
            onClick={() => select(e.id)}
            style={{ borderColor: selectedId === e.id ? 'var(--accent)' : 'var(--border)', color: selectedId === e.id ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {e.file} — {e.status}
          </button>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useMemo } from 'react'
import { useSession } from '../state/session'

export function DiffsPanel() {
  const edits = useSession((s) => s.edits)
  const selectedEditId = useSession((s) => s.selectedEditId)
  const selectEdit = useSession((s) => s.selectEdit)
  const acceptEdit = useSession((s) => s.acceptEdit)
  const rejectEdit = useSession((s) => s.rejectEdit)

  const selected = useMemo(() => {
    if (!edits.length) return undefined
    const current = edits.find((e) => e.id === selectedEditId)
    return current || edits[0]
  }, [edits, selectedEditId])

  useEffect(() => {
    if (edits.length === 0) return
    if (!selectedEditId) {
      selectEdit(edits[0].id)
    }
  }, [edits, selectedEditId, selectEdit])

  if (edits.length === 0) {
    return (
      <div className="scroll" style={{ padding: 16, color: 'var(--text-muted)' }}>
        No proposed edits yet. They will appear here when an agent suggests file changes.
      </div>
    )
  }

  if (!selected) return null

  const disableActions = selected.status !== 'proposed'

  return (
    <div className="scroll" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, display: 'flex', gap: 8, overflowX: 'auto', borderBottom: '1px solid var(--border-light)' }}>
        {edits.map((edit) => {
          const isActive = edit.id === selected.id
          return (
            <button
              key={edit.id}
              className="chip"
              style={{
                borderColor: isActive ? 'var(--accent)' : 'var(--border-light)',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                background: isActive ? 'var(--accent-light)' : 'var(--bg-primary)'
              }}
              onClick={() => selectEdit(edit.id)}
            >
              {edit.file.split('/').pop() || edit.file}
            </button>
          )
        })}
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-light)'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>{selected.file}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Status: {selected.status}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn--accent"
            disabled={disableActions}
            onClick={() => acceptEdit(selected.id)}
          >
            Accept
          </button>
          <button
            className="btn btn--ghost"
            disabled={disableActions}
            onClick={() => rejectEdit(selected.id)}
          >
            Reject
          </button>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        padding: 16,
        overflow: 'auto',
        alignItems: 'start'
      }}>
        <div style={{ border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-primary)' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border-light)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Before</div>
          <pre style={{ margin: 0, padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5 }}>
            {selected.before || ''}
          </pre>
        </div>
        <div style={{ border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-primary)' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border-light)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>After</div>
          <pre style={{ margin: 0, padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5 }}>
            {selected.after || ''}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default DiffsPanel

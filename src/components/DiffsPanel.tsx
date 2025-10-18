import { useEffect, useMemo, useState } from 'react'
import { diffLines, type Change } from 'diff'
import { useSession } from '../state/session'
import { useEditor } from '../state/editor'
import { readTextFile } from '@tauri-apps/plugin-fs'

export function DiffsPanel() {
  const edits = useSession((s) => s.edits)
  const selectedEditId = useSession((s) => s.selectedEditId)
  const selectEdit = useSession((s) => s.selectEdit)
  const acceptEdit = useSession((s) => s.acceptEdit)
  const rejectEdit = useSession((s) => s.rejectEdit)
  const pushEvent = useSession((s) => s.pushEvent)
  const projectDir = useSession((s) => s.projectDir)
  const openFileInEditor = useEditor((s) => s.openFile)
  const [error, setError] = useState<string | null>(null)

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

  const proposedEdits = useMemo(() => edits.filter((e) => e.status === 'proposed'), [edits])

  const handleAcceptAll = async () => {
    setError(null)
    try {
      if ((window as any).__TAURI__ && proposedEdits.length) {
        const snapshots: Array<{ path: string; originalContent?: string; currentContent?: string }> = []
        for (const ed of proposedEdits) {
          const abs = resolvePath(ed.file, projectDir)
          let current = ''
          try { current = await readTextFile(abs) } catch {}
          snapshots.push({ path: abs, originalContent: ed.before ?? '', currentContent: current })
        }
        pushEvent({ type: 'checkpoint:create', ts: Date.now(), trigger: 'accept_all', fileSnapshots: snapshots } as any)
      }
      proposedEdits.forEach((e) => acceptEdit(e.id))
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  const handleRejectAll = () => {
    setError(null)
    try {
      proposedEdits.forEach((e) => rejectEdit(e.id))
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  const diffChunks = useMemo<Array<{ type: 'add' | 'remove' | 'context'; text: string }>>(() => {
    const before = selected.before ?? ''
    const after = selected.after ?? ''
    const changes: Change[] = diffLines(before, after, { newlineIsToken: true })
    const lines: Array<{ type: 'add' | 'remove' | 'context'; text: string }> = []
    changes.forEach((change) => {
      const type: 'add' | 'remove' | 'context' = change.added ? 'add' : change.removed ? 'remove' : 'context'
      const raw = change.value.replace(/\n$/, '')
      if (!raw.length && type === 'context') {
        lines.push({ type: 'context', text: '' })
        return
      }
      raw.split('\n').forEach((line) => {
        lines.push({ type, text: line })
      })
    })
    return lines
  }, [selected.before, selected.after])

  return (
    <div className="diffs-panel">
      <div className="diffs-file-strip">
        {edits.map((edit) => {
      return (
        <button
          key={edit.id}
          className={`chip ${edit.id === selected.id ? 'active' : ''}`}
          onClick={() => selectEdit(edit.id)}
        >
          {edit.file.split('/').pop() || edit.file}
        </button>
      )
        })}
      </div>

      <div className="diffs-header">
        <div className="diffs-meta">
          <span className="diffs-file">{selected.file}</span>
          <span className={`diffs-status status-${selected.status}`}>{selected.status}</span>
        </div>
        <div className="diffs-actions">
          {proposedEdits.length > 1 && (
            <>
              <button className="btn btn--ghost" onClick={handleAcceptAll}>
                Accept all
              </button>
              <button className="btn btn--ghost" onClick={handleRejectAll}>
                Reject all
              </button>
            </>
          )}
          <button
            className="btn btn--ghost"
            onClick={() => {
              const absolute = resolvePath(selected.file, projectDir)
              if (!absolute) return
              openFileInEditor(absolute).catch((err) => {
                console.error('Failed to open file in editor', err)
              })
            }}
          >
            Open in editor
          </button>
          <button
            className="btn btn--accent"
            disabled={disableActions}
            onClick={() => acceptEdit(selected.id)}
          >
            Accept change
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

      <div className="diff-viewer">
        {error && (
          <div className="diffs-error" style={{ color: 'var(--danger)', padding: '8px 12px' }}>{error}</div>
        )}
        <div className="diff-content">
          <pre className="diff-pre">
            {diffChunks.map((line, index) => {
              const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
              return (
                <span key={index} className={`diff-line diff-${line.type}`}>
                  <span className="diff-prefix">{prefix}</span>
                  {line.text}
                </span>
              )
            })}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default DiffsPanel

function resolvePath(file: string, projectDir?: string | null): string {
  if (!file) return ''
  const normalizedProject = projectDir ? projectDir.replace(/\\/g, '/') : ''
  const normalizedFile = file.replace(/\\/g, '/')
  if (/^\/?[A-Za-z]:\//.test(normalizedFile) || normalizedFile.startsWith('/')) {
    return normalizedFile
  }
  if (normalizedProject) {
    return `${normalizedProject.replace(/\/+$/, '')}/${normalizedFile.replace(/^\/+/, '')}`
  }
  return normalizedFile
}

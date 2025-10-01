import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSession } from '../state/session'

type CheckpointMeta = {
  id: string
  timestamp: string
  name?: string | null
  checkpoint_type: string
  trigger?: string | null
  file_count: number
  git_branch?: string | null
  git_commit?: string | null
}

export function CheckpointsPanel() {
  const projectDir = useSession(s => s.projectDir)
  const sessionId = useSession(s => s.sessionId)
  const [items, setItems] = useState<CheckpointMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const refresh = async () => {
    if (!(window as any).__TAURI__) return
    if (!sessionId) return
    setLoading(true)
    setError(undefined)
    try {
      const list = await invoke<CheckpointMeta[]>('list_checkpoints', { sessionId: sessionId })
      setItems(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (sessionId) { refresh() } }, [projectDir, sessionId])

  const restore = async (id: string) => {
    try {
      await invoke('restore_checkpoint', { sessionId: sessionId, checkpointId: id })
    } catch (e) {
      console.error('Failed to restore checkpoint', e)
    }
  }

  const remove = async (id: string) => {
    try {
      await invoke('delete_checkpoint', { sessionId: sessionId, checkpointId: id })
      setItems(prev => prev.filter(x => x.id !== id))
    } catch (e) {
      console.error('Failed to delete checkpoint', e)
    }
  }

  return (
    <div className="scroll" style={{ padding: 16, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Checkpoints</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost" onClick={refresh} disabled={loading}>Refresh</button>
        </div>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
        {error && (
          <div style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>
        )}
        {loading ? (
          <div>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>No checkpoints yet. They are created automatically before destructive edits/tools.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(cp => (
              <div key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{cp.trigger || cp.name || cp.id}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(cp.timestamp).toLocaleString()} • {cp.file_count} file{cp.file_count === 1 ? '' : 's'}
                    {cp.git_branch ? ` • ${cp.git_branch}@${(cp.git_commit || '').slice(0,7)}` : ''}
                  </div>
                </div>
                <button className="btn btn--accent" onClick={() => restore(cp.id)}>Restore</button>
                <button className="btn btn--ghost" onClick={() => remove(cp.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


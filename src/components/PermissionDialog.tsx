import * as Dialog from '@radix-ui/react-dialog'
import { useMemo, useState } from 'react'
import { useSession } from '../state/session'

const toolLabels: Record<string, string> = {
  bash: 'Run Commands',
  read: 'Read Files',
  write: 'Write Files',
  grep: 'Search',
  web: 'Web',
  mcp: 'MCP',
  task: 'Task'
}

export function PermissionDialog() {
  const pending = useSession((s) => s.permissions.pending)
  const resolve = useSession((s) => s.resolvePermission)
  const [scope, setScope] = useState<'once' | 'session' | 'project'>('session')

  const open = !!pending
  const tools = useMemo(() => (pending?.tools || []).map(t => String(t)), [pending])
  const details = pending?.details || {}
  const command = typeof details.command === 'string' ? details.command : undefined
  const cwd = typeof details.cwd === 'string' ? details.cwd : undefined
  const reason = typeof details.reason === 'string' ? details.reason : undefined
  const files: string[] = Array.isArray(details.files) ? details.files : []
  if (!open || !pending) return null

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }} />
        <Dialog.Content className="settings-dialog" style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 560, maxWidth: '92vw', borderRadius: 12,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.45)', padding: 16
        }}>
          <Dialog.Title style={{ fontWeight: 700, fontSize: 16, margin: '4px 0 8px 0', color: 'var(--text-primary)' }}>
            Allow Tool Access
          </Dialog.Title>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            This request applies to:
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {tools.map((t, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 999,
                background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
                color: 'var(--text-primary)', fontSize: 12, fontWeight: 500
              }}>
                {toolLabels[t] || t}
              </span>
            ))}
          </div>

          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Scope</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`settings-btn ${scope === 'once' ? 'primary' : 'secondary'}`} onClick={() => setScope('once')}>Once</button>
              <button className={`settings-btn ${scope === 'session' ? 'primary' : 'secondary'}`} onClick={() => setScope('session')}>This Session</button>
              <button className={`settings-btn ${scope === 'project' ? 'primary' : 'secondary'}`} onClick={() => setScope('project')}>This Project</button>
            </div>
          </div>

          {(reason || command || cwd || files.length > 0) && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-secondary)' }}>
              {reason && (
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ fontWeight: 600 }}>Reason:</strong> {reason}
                </div>
              )}
              {command && (
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ fontWeight: 600 }}>Command:</strong> <code style={{ background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: 4 }}>{command}</code>
                </div>
              )}
              {cwd && (
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ fontWeight: 600 }}>Directory:</strong> {cwd}
                </div>
              )}
              {files.length > 0 && (
                <div>
                  <strong style={{ fontWeight: 600 }}>Files:</strong>
                  <ul style={{ marginTop: 4, marginLeft: 16 }}>
                    {files.map((file, idx) => (
                      <li key={idx}>{file}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="settings-btn secondary" onClick={() => resolve(false, scope)}>Deny</button>
            <button className="settings-btn primary" onClick={() => resolve(true, scope)}>Allow</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

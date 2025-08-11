import * as Dialog from '@radix-ui/react-dialog'
import { useSession } from '../state/session'

export function PermissionDialog() {
  const pending = useSession((s) => s.permissions.pending)
  const resolve = useSession((s) => s.resolvePermission)

  const open = !!pending
  if (!open || !pending) return null

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }} />
        <Dialog.Content style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          background: 'linear-gradient(180deg, rgba(21,24,36,0.95), rgba(11,13,18,0.95))',
          border: '1px solid var(--border)', borderRadius: 16, padding: 16, width: 520
        }}>
          <Dialog.Title style={{ fontWeight: 600, marginBottom: 8 }}>Allow tools</Dialog.Title>
          <div style={{ color: 'var(--muted)', marginBottom: 12 }}>
            Claude requests access to: {pending.tools.join(', ')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="pill" onClick={() => resolve(true, 'once')}>Allow once</button>
            <button className="pill" onClick={() => resolve(true, 'session')}>Allow for session</button>
            <button className="pill" onClick={() => resolve(true, 'project')}>Always allow (project)</button>
            <div style={{ flex: 1 }} />
            <button className="pill" onClick={() => resolve(false, 'once')}>Deny</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

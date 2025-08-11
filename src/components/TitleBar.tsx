import { useSession } from '../state/session'

export function TitleBar() {
  const dir = useSession((s) => s.projectDir)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
      borderBottom: '1px solid var(--border)', background: 'rgba(12,14,20,0.6)', backdropFilter: 'var(--blur)'
    }}>
      <div style={{ fontWeight: 700 }}>Claude Code UI</div>
      <div style={{ opacity: 0.6 }}>›</div>
      <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir || 'No project selected'}</div>
    </div>
  )
}

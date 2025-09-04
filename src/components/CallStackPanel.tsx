import { useDebug } from '../state/debugger'

export function CallStackPanel() {
  const frames = useDebug(s => s.callStack)
  return (
    <div className="debug-section">
      <h3>Call Stack</h3>
      <ul>
        {frames.map(f => (
          <li key={f.id}>
            {f.name} — {f.source?.path}:{f.line}
          </li>
        ))}
      </ul>
    </div>
  )
}

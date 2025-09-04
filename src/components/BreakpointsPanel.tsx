import { useDebug } from '../state/debugger'

export function BreakpointsPanel() {
  const breakpoints = useDebug(s => s.breakpoints)
  return (
    <div className="debug-section">
      <h3>Breakpoints</h3>
      <ul>
        {breakpoints.map((bp, i) => (
          <li key={bp.id ?? i}>
            {bp.source?.path}:{bp.line} {bp.verified ? '✓' : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

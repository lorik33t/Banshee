import { useDebug } from '../state/debugger'

export function VariablesPanel() {
  const vars = useDebug(s => s.variables)
  return (
    <div className="debug-section">
      <h3>Variables</h3>
      <ul>
        {vars.map(v => (
          <li key={v.name}>
            {v.name}: {v.value}
          </li>
        ))}
      </ul>
    </div>
  )
}

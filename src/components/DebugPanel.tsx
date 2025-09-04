import { BreakpointsPanel } from './BreakpointsPanel'
import { CallStackPanel } from './CallStackPanel'
import { VariablesPanel } from './VariablesPanel'

export function DebugPanel() {
  return (
    <div className="debug-panel">
      <BreakpointsPanel />
      <CallStackPanel />
      <VariablesPanel />
    </div>
  )
}

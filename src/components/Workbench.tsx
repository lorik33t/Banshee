import { DiffPanel } from './DiffPanel'
import { CheckpointsPanel } from './CheckpointsPanel'
import { DebugPanel } from './DebugPanel'
import { useSession } from '../state/session'

export function Workbench() {
  const tab = useSession(s => s.ui.workbenchTab)
  const setTab = useSession(s => s.setWorkbenchTab)
  return (
    <aside className="workbench">
      <div className="workbench-tabs">
        <button
          className={`wb-tab ${tab === 'diffs' ? 'active' : ''}`}
          onClick={() => setTab('diffs')}
        >Diffs</button>
        <button
          className={`wb-tab ${tab === 'checkpoints' ? 'active' : ''}`}
          onClick={() => setTab('checkpoints')}
        >Checkpoints</button>
        <button
          className={`wb-tab ${tab === 'debug' ? 'active' : ''}`}
          onClick={() => setTab('debug')}
        >Debug</button>
      </div>
      <div className="workbench-body">
        {tab === 'diffs' ? <DiffPanel /> : tab === 'checkpoints' ? <CheckpointsPanel /> : <DebugPanel />}
      </div>
    </aside>
  )
}

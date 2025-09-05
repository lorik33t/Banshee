import { DiffPanel } from './DiffPanel'
import { CheckpointsPanel } from './CheckpointsPanel'
import { CodexPanel } from './CodexPanel'
import { useSession } from '../state/session'

interface WorkbenchProps {}

export function Workbench({}: WorkbenchProps = {}) {
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
          className={`wb-tab ${tab === 'codex' ? 'active' : ''}`}
          onClick={() => setTab('codex')}
        >Codex</button>
      </div>
      <div className="workbench-body">
        {tab === 'diffs' ? <DiffPanel /> : tab === 'checkpoints' ? <CheckpointsPanel /> : <CodexPanel />}
      </div>
    </aside>
  )
}

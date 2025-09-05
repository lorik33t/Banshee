import { DiffPanel } from './DiffPanel'
import { CheckpointsPanel } from './CheckpointsPanel'
import { Editor } from './Editor'
import { useSession } from '../state/session'

export function Workbench() {
  const tab = useSession(s => s.ui.workbenchTab)
  const setTab = useSession(s => s.setWorkbenchTab)
  const openFile = useSession(s => s.openFile)
  const setOpenFile = useSession(s => s.setOpenFile)
  if (openFile) {
    return (
      <aside className="workbench">
        <div className="workbench-tabs">
          <button className="wb-tab active">{openFile}</button>
          <button className="wb-tab" onClick={() => setOpenFile(undefined)}>Close</button>
        </div>
        <div className="workbench-body">
          <Editor path={openFile} />
        </div>
      </aside>
    )
  }

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
      </div>
      <div className="workbench-body">
        {tab === 'diffs' ? <DiffPanel /> : <CheckpointsPanel />}
      </div>
    </aside>
  )
}

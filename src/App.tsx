// VS Code-like layout (no React state needed yet)
import './index.css'
import { ToolStack } from './components/ToolCard'
import { DiffPanel } from './components/DiffPanel'
import { PermissionDialog } from './components/PermissionDialog'
import { useSession } from './state/session'
// import { open } from '@tauri-apps/plugin-dialog'
// import { invoke } from '@tauri-apps/api/core'
// TitleBar removed from render for VSCode layout
import { FileExplorer } from './components/FileExplorer'
import { Tabs } from './components/Tabs'
import { ChatPanel } from './components/ChatPanel'

// center tabs will show Activity and Diffs

export default function App() {
  return (
    <div className="app-shell">
      <div className="titlebar">
        <div style={{ fontWeight: 600 }}>Claude Code</div>
        <div style={{ opacity: 0.6, fontSize: 12 }}>| VS Code Layout</div>
      </div>
      <div className="activity">
        <button className="icon-btn" title="Explorer" onClick={() => {}} aria-label="Explorer">≡</button>
        <button className="icon-btn" title="Search" onClick={() => {}} aria-label="Search">🔎</button>
        <button className="icon-btn" title="Git" onClick={() => {}} aria-label="Git">⎇</button>
      </div>
      <div className="sidebar">
        <FileExplorer />
      </div>
      <div className="editor">
        <div className="scroll" style={{ padding: 12 }}>
          <Tabs
            tabs={[
              { key: 'activity', label: 'Activity', content: <div><ToolStack /></div> },
              { key: 'diffs', label: 'Diffs', content: <DiffPanel /> },
            ]}
          />
        </div>
      </div>
      <div className="panel">
        <div className="scroll" style={{ padding: 10 }}>
          <div className="chip">Terminal / Logs</div>
        </div>
      </div>
      <div className="chatbar">
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>Claude</div>
        <ChatPanel />
      </div>
      <div className="statusbar">
        <div>Ln 1, Col 1  Spaces: 2  UTF-8  LF  TypeScript React</div>
        <div>Claude: Sonnet 4 • Project: {useSession.getState().projectDir || 'none'}</div>
      </div>
      <PermissionDialog />
    </div>
  )
}

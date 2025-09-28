import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'
import { PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose, RefreshCw, Settings as SettingsIcon, FolderOpen } from 'lucide-react'
import './index.css'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { FileTree } from './components/FileTree'
import { CodexPanel } from './components/CodexPanel'
import { CheckpointsPanel } from './components/CheckpointsPanel'
import { WelcomeView } from './components/WelcomeView'
import { PermissionDialog } from './components/PermissionDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TauriInitDiagnostics } from './components/TauriInitDiagnostics'
import { DiffsPanel } from './components/DiffsPanel'
import { useSession } from './state/session'
import { useProjectLifecycle } from './hooks/useProjectLifecycle'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { SettingsView } from './components/SettingsView'
import { useSettings } from './state/settings'
import { normalizeDialogSelection } from './utils/dialog'

function useCssWidth(key: string, fallback: number) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return fallback
    const stored = Number(window.localStorage.getItem(key))
    return Number.isFinite(stored) && stored > 0 ? stored : fallback
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty(`--${key}`, `${width}px`)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, String(Math.round(width)))
    }
  }, [key, width])

  return [width, setWidth] as const
}

export default function App() {
  const { activeProject, openProject, closeProject } = useProjectLifecycle()
  const projectDir = useSession((s) => s.projectDir)
  const workbenchTab = useSession((s) => s.ui.workbenchTab)
  const setWorkbenchTab = useSession((s) => s.setWorkbenchTab)
  const openSettings = useSettings((s) => s.openSettings)
  const loadSettings = useSettings((s) => s.loadSettings)

  const [leftSidebarWidth, setLeftSidebarWidth] = useCssWidth('ls-width', 320)
  const [workbenchWidth, setWorkbenchWidth] = useCssWidth('wb-width', 420)

  const [showLeftSidebar, setShowLeftSidebar] = useState(true)
  const [showWorkbench, setShowWorkbench] = useState(true)
  const [resizing, setResizing] = useState<'left' | 'right' | null>(null)

  const toggleLeftSidebar = useCallback(() => {
    setShowLeftSidebar((prev) => !prev)
  }, [])

  const toggleWorkbench = useCallback(() => {
    setShowWorkbench((prev) => !prev)
  }, [])

  const openFolder = useCallback(async () => {
    if (!(window as any).__TAURI__) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Project Folder'
      })

      const folderPath = normalizeDialogSelection(selected)
      if (folderPath) {
        await openProject(folderPath)
      }
    } catch (err) {
      console.error('Failed to open folder:', err)
    }
  }, [openProject])

  useGlobalShortcuts({ activeProject, toggleLeftSidebar, toggleRightSidebar: toggleWorkbench })

  useEffect(() => {
    if (!activeProject) {
      setShowLeftSidebar(false)
      setShowWorkbench(false)
    } else {
      setShowLeftSidebar(true)
      setShowWorkbench(true)
    }
  }, [activeProject])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (!resizing) return
    const onMove = (event: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in event ? event.touches[0]?.clientX ?? 0 : event.clientX
      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
      if (resizing === 'left') {
        const next = clamp(clientX, 200, 600)
        setLeftSidebarWidth(next)
      } else if (resizing === 'right') {
        const viewportWidth = window.innerWidth
        const next = clamp(viewportWidth - clientX, 280, 640)
        setWorkbenchWidth(next)
      }
    }
    const stop = () => setResizing(null)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', stop)
    window.addEventListener('mouseleave', stop)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', stop)
      window.removeEventListener('mouseleave', stop)
    }
  }, [resizing, setLeftSidebarWidth, setWorkbenchWidth])

  const leftResizeStart = useCallback((event: ReactMouseEvent | ReactTouchEvent) => {
    event.preventDefault()
    setResizing('left')
  }, [])

  const rightResizeStart = useCallback((event: ReactMouseEvent | ReactTouchEvent) => {
    event.preventDefault()
    setResizing('right')
  }, [])

  const projectName = useMemo(() => {
    if (!activeProject) return 'Banshee'
    return activeProject.name || activeProject.path.split('/').pop() || 'Project'
  }, [activeProject])

  if (!activeProject) {
    return (
      <div className="app">
        <WelcomeView onProjectOpen={openProject} />
        <PermissionDialog />
        <TauriInitDiagnostics />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">⚡︎</span>
            <span>{projectName}</span>
          </div>
          {projectDir && (
            <div className="project-info">
              <span className="project-path" title={projectDir}>{projectDir}</span>
            </div>
          )}
        </div>
        <div className="header-right">
          <button className="header-btn" onClick={openFolder} title="Open Different Repository">
            <FolderOpen size={16} />
          </button>
          <button className="header-btn" onClick={toggleLeftSidebar} title={showLeftSidebar ? 'Hide File Tree' : 'Show File Tree'}>
            {showLeftSidebar ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button className="header-btn" onClick={toggleWorkbench} title={showWorkbench ? 'Hide Workbench' : 'Show Workbench'}>
            {showWorkbench ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button className="header-btn" onClick={closeProject} title="Close Project">
            <RefreshCw size={16} />
          </button>
          <button className="header-btn" onClick={openSettings} title="Settings">
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      <div className="main-content">
        {showLeftSidebar && (
          <>
            <div className="left-sidebar" style={{ width: leftSidebarWidth }}>
              <FileTree />
            </div>
            <div className="resizer" onMouseDown={leftResizeStart} onTouchStart={leftResizeStart} />
          </>
        )}

        <div className="chat-container">
          <ErrorBoundary>
            <ChatView />
          </ErrorBoundary>
          <Composer />
        </div>

        {showWorkbench && (
          <>
            <div className="resizer" onMouseDown={rightResizeStart} onTouchStart={rightResizeStart} />
            <div className="workbench" style={{ width: workbenchWidth }}>
              <div className="workbench-tabs">
                <button
                  className={`wb-tab ${workbenchTab === 'diffs' ? 'active' : ''}`}
                  onClick={() => setWorkbenchTab('diffs')}
                >
                  Diffs
                </button>
                <button
                  className={`wb-tab ${workbenchTab === 'checkpoints' ? 'active' : ''}`}
                  onClick={() => setWorkbenchTab('checkpoints')}
                >
                  Checkpoints
                </button>
                <button
                  className={`wb-tab ${workbenchTab === 'codex' ? 'active' : ''}`}
                  onClick={() => setWorkbenchTab('codex')}
                >
                  Codex
                </button>
              </div>
              <div className="workbench-body">
                {workbenchTab === 'diffs' && <DiffsPanel />}
                {workbenchTab === 'checkpoints' && <CheckpointsPanel />}
                {workbenchTab === 'codex' && <CodexPanel />}
              </div>
            </div>
          </>
        )}
      </div>

      <PermissionDialog />
      <TauriInitDiagnostics />
      <SettingsView />
    </div>
  )
}

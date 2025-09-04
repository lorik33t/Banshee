import './index.css'
import { useState, useEffect, useCallback } from 'react'
import { Header } from './components/Header'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { SidePanel } from './components/SidePanel'
import { FileTree } from './components/FileTree'
import { Workbench } from './components/Workbench'
import { PermissionDialog } from './components/PermissionDialog'
import { SettingsDialogV2 } from './components/SettingsDialogV2'
import { LightningLoader } from './components/LightningLoader'
import { WelcomeView } from './components/WelcomeView'
import { useProjectLifecycle } from './hooks/useProjectLifecycle'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { TauriInitDiagnostics } from './components/TauriInitDiagnostics'
// Checkpointing temporarily disabled

export default function App() {
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [sidePanelContent, setSidePanelContent] = useState<'files' | 'diff'>('diff')
  const [settingsView, setSettingsView] = useState(false)
  const { activeProject, claudeReady, openProject, closeProject } = useProjectLifecycle()
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('leftSidebarOpen')
    return saved !== 'false'
  })
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('rightSidebarOpen')
    return saved !== 'false'
  })

  const toggleLeftSidebar = useCallback(() => setLeftSidebarOpen(prev => !prev), [setLeftSidebarOpen])
  const toggleRightSidebar = useCallback(() => setRightSidebarOpen(prev => !prev), [setRightSidebarOpen])

  useGlobalShortcuts({ activeProject, toggleLeftSidebar, toggleRightSidebar })
  
  // Save sidebar states
  useEffect(() => {
    localStorage.setItem('leftSidebarOpen', String(leftSidebarOpen))
  }, [leftSidebarOpen])

  useEffect(() => {
    localStorage.setItem('rightSidebarOpen', String(rightSidebarOpen))
  }, [rightSidebarOpen])

  const openSidePanel = (content: 'files' | 'diff') => {
    setSidePanelContent(content)
    setSidePanelOpen(true)
  }

  // Show welcome screen if no project is open
  if (!activeProject) {
    return (
      <div className="app">
        <WelcomeView onProjectOpen={openProject} />
      </div>
    )
  }

  // If settings view is open, show only settings (regardless of Claude status)
  if (settingsView) {
    return (
      <div className="app settings-view">
        <SettingsDialogV2 onClose={() => setSettingsView(false)} />
      </div>
    )
  }

  // Show loading screen while Claude is starting
  if (!claudeReady) {
    return (
      <div className="app" style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'var(--bg-primary)'
      }}>
        <LightningLoader />
      </div>
    )
  }

  return (
    <div className="app">
      <Header
        onOpenDiff={() => openSidePanel('diff')}
        leftSidebarOpen={leftSidebarOpen}
        rightSidebarOpen={rightSidebarOpen}
        onToggleLeftSidebar={toggleLeftSidebar}
        onToggleRightSidebar={toggleRightSidebar}
        onOpenSettings={() => setSettingsView(true)}
        onOpenFolder={closeProject}
      />
      
      <div className="main-content">
        {leftSidebarOpen && (
          <>
            <aside className="left-sidebar" id="left-sidebar">
              <FileTree />
            </aside>
            <div className="resizer" onMouseDown={(e) => {
              const startX = e.clientX
              const start = document.documentElement.style.getPropertyValue('--ls-width') || '280px'
              const startPx = parseInt(start)
              function onMove(ev: MouseEvent) {
                const next = Math.max(220, Math.min(480, startPx + (ev.clientX - startX)))
                document.documentElement.style.setProperty('--ls-width', next + 'px')
                localStorage.setItem('ls-width', String(next))
              }
              function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }} />
          </>
        )}
        <div className="chat-container">
          <ChatView />
          <Composer />
        </div>
        {rightSidebarOpen && (
          <>
            <div className="resizer" onMouseDown={(e) => {
              const startX = e.clientX
              const start = document.documentElement.style.getPropertyValue('--wb-width') || '420px'
              const startPx = parseInt(start)
              function onMove(ev: MouseEvent) {
                const delta = startX - ev.clientX
                const next = Math.max(360, Math.min(640, startPx + delta))
                document.documentElement.style.setProperty('--wb-width', next + 'px')
                localStorage.setItem('wb-width', String(next))
              }
              function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }} />
            <Workbench />
          </>
        )}
        
        {sidePanelOpen && (
          <SidePanel 
            content={sidePanelContent}
            onClose={() => setSidePanelOpen(false)}
          />
        )}
      </div>
      
      <PermissionDialog />
      {process.env.NODE_ENV === 'development' && <TauriInitDiagnostics />}
    </div>
  )
}

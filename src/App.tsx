import './index.css'
import { useState, useEffect } from 'react'
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
import { invoke } from '@tauri-apps/api/core'
import { useSession } from './state/session'
import { useWorkspaceStore } from './state/workspace'
import { TauriInitDiagnostics } from './components/TauriInitDiagnostics'
// Checkpointing temporarily disabled

export default function App() {
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [sidePanelContent, setSidePanelContent] = useState<'files' | 'diff'>('diff')
  const [claudeReady, setClaudeReady] = useState(false)
  const [settingsView, setSettingsView] = useState(false)
  const sessionStore = useSession()
  const { projects, activeProjectId, getProject } = useWorkspaceStore()
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('leftSidebarOpen')
    return saved !== 'false'
  })
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('rightSidebarOpen')
    return saved !== 'false'
  })
  
  // Get active project
  const activeProject = activeProjectId ? getProject(activeProjectId) : null
  
  // Initialize projectDir in session store if we have an active project
  useEffect(() => {
    console.log('[App] Project init effect - activeProject:', activeProject, 'sessionStore.projectDir:', sessionStore.projectDir)
    if (activeProject && !sessionStore.projectDir) {
      console.log('[App] Setting project directory to:', activeProject.path)
      // Set project directory immediately so FileTree can load
      sessionStore.setProjectDir(activeProject.path)
    }
  }, [activeProject?.path, sessionStore.projectDir])

  // Checkpoint clearing on startup removed for first shipping
  
  // Removed: background auth checks on app startup to prevent UI stalls.
  // Auth checks will run only on-demand when the user opens the settings/auth UI.
  
  // If we have an active project but Claude isn't ready, we need to either start Claude or clear the project
  useEffect(() => {
    if (activeProject && !claudeReady) {
      // Set ready immediately for instant UI, Claude will catch up in background
      setClaudeReady(true)
      openProject(activeProject.path)
    }
  }, [activeProject?.id])
  
  // Save sidebar states
  useEffect(() => {
    localStorage.setItem('leftSidebarOpen', String(leftSidebarOpen))
  }, [leftSidebarOpen])

  useEffect(() => {
    localStorage.setItem('rightSidebarOpen', String(rightSidebarOpen))
  }, [rightSidebarOpen])

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Only enable shortcuts when a project is open
      if (!activeProject) return
      
      // Cmd+B toggle left sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setLeftSidebarOpen(prev => !prev)
      }
      // Cmd+K toggle right sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setRightSidebarOpen(prev => !prev)
      }
      // Cmd+] cycle workbench tabs
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault()
        // Only one tab ('diffs') in first ship; no cycling
        sessionStore.setWorkbenchTab('diffs')
      }
    }
    window.addEventListener('keydown', onKey)
    
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [activeProject, sessionStore])

  // Initialize Claude when project is opened
  const openProject = async (path: string) => {
    // Set UI ready immediately for instant feedback
    setClaudeReady(true)
    
    // Add to workspace store
    const projectName = path.split('/').pop() || path
    const { addProject, setActiveProject } = useWorkspaceStore.getState()
    
    // Check if project already exists
    const existingProject = projects.find(p => p.path === path)
    if (existingProject) {
      setActiveProject(existingProject.id)
    } else {
      const projectId = addProject({ name: projectName, path })
      setActiveProject(projectId)
    }
    
    // Set project directory in session store immediately
    sessionStore.setProjectDir(path)
    
    // Start Claude in background without blocking UI
    Promise.resolve().then(async () => {
      try {
        await invoke('start_claude', { projectDir: path })
      } catch (err) {
        console.error('Failed to start Claude:', err)
      }
    })
  }
  
  // Cleanup Claude on unmount or project change
  useEffect(() => {
    return () => {
      if (claudeReady && (window as any).__TAURI__) {
        invoke('stop_claude').catch(console.error)
      }
    }
  }, [claudeReady])

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
        onToggleLeftSidebar={() => setLeftSidebarOpen(!leftSidebarOpen)}
        onToggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
        onOpenSettings={() => setSettingsView(true)}
        onOpenFolder={async () => {
          // Allow changing project - stop current Claude instance
          if (claudeReady) {
            await invoke('stop_claude').catch(console.error)
          }
          setClaudeReady(false)
          // Clear active project
          const { setActiveProject } = useWorkspaceStore.getState()
          setActiveProject(null)
        }}
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

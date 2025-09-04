import { Settings, Moon, Sun, PanelLeft, PanelRight, X, Plus } from 'lucide-react'
import { useSettings } from '../state/settings'
import React, { useState, useEffect, useCallback } from 'react'
import { clearDeduplicationCache } from '../utils/claudeParser'
import { useWorkspaceStore, type Project } from '../state/workspace'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useSessionStore } from '../state/session'

interface HeaderProps {
  onOpenDiff: () => void
  onOpenSettings?: () => void
  leftSidebarOpen?: boolean
  rightSidebarOpen?: boolean
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
  onOpenFolder?: () => void
}

export function Header({ 
  onOpenSettings,
  leftSidebarOpen = true,
  rightSidebarOpen = true,
  onToggleLeftSidebar,
  onToggleRightSidebar
}: HeaderProps) {
  // const projectDir = useSession((s) => s.projectDir) // Not needed anymore with tabs
  const openSettingsFromStore = useSettings((s) => s.openSettings)
  const [darkMode, setDarkMode] = useState(() => {
    // Check localStorage and system preference
    const saved = localStorage.getItem('theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    // Apply theme to document
    if (darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.setAttribute('data-theme', 'light')
    }
    // Save preference
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <span className="logo-text">Banshee</span>
        </div>
      </div>

      <div className="header-center">
        <ProjectTabs />
      </div>

      <div className="header-right">
        {onToggleLeftSidebar && (
          <button 
            className="header-btn" 
            onClick={onToggleLeftSidebar} 
            title={leftSidebarOpen ? "Hide sidebar (⌘B)" : "Show sidebar (⌘B)"}
          >
            <PanelLeft size={18} />
          </button>
        )}
        
        {onToggleRightSidebar && (
          <button 
            className="header-btn" 
            onClick={onToggleRightSidebar}
            title={rightSidebarOpen ? "Hide workbench (⌘K)" : "Show workbench (⌘K)"}
          >
            <PanelRight size={18} />
          </button>
        )}
        
        
        <button 
          className="header-btn" 
          onClick={() => setDarkMode(!darkMode)}
          title="Toggle theme"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        
        <button className="header-btn" onClick={onOpenSettings || openSettingsFromStore} title="Settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}

const TabItem = React.memo(({ project, isActive, onClick, onClose }: {
  project: Project,
  isActive: boolean,
  onClick: () => void,
  onClose: (projectId: string, e: React.MouseEvent) => void
}) => {
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose(project.id, e)
  }, [project.id, onClose])

  return (
    <div
      className={`header-tab ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <span className="tab-name">{project.name}</span>
      <button
        className="tab-close"
        onClick={handleClose}
      >
        <X size={14} />
      </button>
    </div>
  )
})

const ProjectTabs = React.memo(() => {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    addProject,
    removeProject
  } = useWorkspaceStore()

  const { setProjectDir } = useSessionStore()
  const [isAddingProject, setIsAddingProject] = useState(false)
  
  const handleAddProject = async () => {
    setIsAddingProject(true)
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Directory'
      })
      
      if (selected && typeof selected === 'string') {
        // Extract project name from path
        const name = selected.split('/').pop() || 'Untitled Project'
        
        // Check if project already exists
        const existingProject = projects.find(p => p.path === selected)
        if (existingProject) {
          setActiveProject(existingProject.id)
          await switchToProject(existingProject.id)
        } else {
          const projectId = addProject({
            name,
            path: selected
          })
          setActiveProject(projectId)
          await switchToProject(projectId)
        }
      }
    } catch (error) {
      console.error('Failed to add project:', error)
    } finally {
      setIsAddingProject(false)
    }
  }
  
  const switchToProject = useCallback((projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return

    // INSTANT UI UPDATE - No blocking operations
    setActiveProject(projectId)
    setProjectDir(project.path)

    // If a stream is active, do NOT restart Claude here.
    // The session store will defer and perform restart after the stream ends.
    const isStreaming = useSessionStore.getState().isStreaming
    if (isStreaming) return

    // Defer expensive operations to background (non-blocking)
    Promise.resolve().then(async () => {
      try {
        clearDeduplicationCache()
        await invoke('restart_claude', { projectDir: project.path })
      } catch (error) {
        console.error('Failed to switch Claude context:', error)
      }
    })
  }, [projects, setActiveProject, setProjectDir])
  
  const handleCloseProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    // If closing active project, switch to another or clear
    if (activeProjectId === projectId) {
      const remainingProjects = projects.filter(p => p.id !== projectId)
      if (remainingProjects.length > 0) {
        await switchToProject(remainingProjects[0].id)
      } else {
        // Stop Claude and clear everything
        await invoke('stop_claude').catch(() => {})
        setProjectDir(undefined)
        useSessionStore.getState().clearSession()
        setActiveProject(null)
      }
    }

    removeProject(projectId)
  }

  if (projects.length === 0) {
    return null
  }

  return (
    <div className="header-tabs">
      {projects.map(project => (
        <TabItem
          key={project.id}
          project={project}
          isActive={activeProjectId === project.id}
          onClick={() => switchToProject(project.id)}
          onClose={handleCloseProject}
        />
      ))}

      <button
        className="tab-add"
        onClick={handleAddProject}
        disabled={isAddingProject}
        title="Add new project"
      >
        <Plus size={14} />
      </button>
    </div>
  )
})

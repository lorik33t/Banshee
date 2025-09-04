import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSession } from '../state/session'
import { useWorkspaceStore } from '../state/workspace'

export function useProjectLifecycle() {
  const [claudeReady, setClaudeReady] = useState(false)
  const sessionStore = useSession()
  const { activeProjectId, getProject } = useWorkspaceStore()
  const activeProject = activeProjectId ? getProject(activeProjectId) : null

  useEffect(() => {
    if (activeProject && !sessionStore.projectDir) {
      sessionStore.setProjectDir(activeProject.path)
    }
  }, [activeProject?.path, sessionStore.projectDir])

  const openProject = useCallback(async (path: string) => {
    setClaudeReady(true)

    const { addProject, setActiveProject, projects } = useWorkspaceStore.getState()
    const projectName = path.split('/').pop() || path

    const existingProject = projects.find(p => p.path === path)
    if (existingProject) {
      setActiveProject(existingProject.id)
    } else {
      const projectId = addProject({ name: projectName, path })
      setActiveProject(projectId)
    }

    sessionStore.setProjectDir(path)

    Promise.resolve().then(async () => {
      try {
        await invoke('start_claude', { projectDir: path })
      } catch (err) {
        console.error('Failed to start Claude:', err)
      }
    })
  }, [sessionStore])

  const closeProject = useCallback(async () => {
    if (claudeReady) {
      await invoke('stop_claude').catch(console.error)
    }
    setClaudeReady(false)
    sessionStore.setProjectDir(undefined)
    const { setActiveProject } = useWorkspaceStore.getState()
    setActiveProject(null)
  }, [claudeReady, sessionStore])

  useEffect(() => {
    if (activeProject && !claudeReady) {
      openProject(activeProject.path)
    }
  }, [activeProject?.id, claudeReady, openProject])

  useEffect(() => {
    return () => {
      if (claudeReady && (window as any).__TAURI__) {
        invoke('stop_claude').catch(console.error)
      }
    }
  }, [claudeReady])

  return { activeProject, claudeReady, openProject, closeProject }
}


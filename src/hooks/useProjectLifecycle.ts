import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSession } from '../state/session'
import { useWorkspaceStore } from '../state/workspace'

export function useProjectLifecycle() {
  const [codexReady, setCodexReady] = useState(false)
  const sessionStore = useSession()
  const { activeProjectId, getProject } = useWorkspaceStore()
  const activeProject = activeProjectId ? getProject(activeProjectId) : null

  useEffect(() => {
    if (activeProject && !sessionStore.projectDir) {
      sessionStore.setProjectDir(activeProject.path)
    }
  }, [activeProject?.path, sessionStore.projectDir])

  const openProject = useCallback(async (path: string) => {
    setCodexReady(true)

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
        await invoke('start_codex', { projectDir: path })
      } catch (err) {
        console.error('Failed to start Codex:', err)
      }
    })
  }, [sessionStore])

  const closeProject = useCallback(async () => {
    if (codexReady) {
      await invoke('stop_codex').catch(console.error)
    }
    setCodexReady(false)
    sessionStore.setProjectDir(undefined)
    const { setActiveProject } = useWorkspaceStore.getState()
    setActiveProject(null)
  }, [codexReady, sessionStore])

  useEffect(() => {
    if (activeProject && !codexReady) {
      openProject(activeProject.path)
    }
  }, [activeProject?.id, codexReady, openProject])

  useEffect(() => {
    return () => {
      if (codexReady && (window as any).__TAURI__) {
        invoke('stop_codex').catch(console.error)
      }
    }
  }, [codexReady])

  return { activeProject, codexReady, openProject, closeProject }
}


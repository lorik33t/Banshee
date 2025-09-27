import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSession } from '../state/session'
import { useWorkspaceStore } from '../state/workspace'

export function useProjectLifecycle() {
  const [codexReady, setCodexReady] = useState(false)
  const sessionStore = useSession()
  const { activeProjectId, getProject } = useWorkspaceStore()
  const activeProject = activeProjectId ? getProject(activeProjectId) : null
  const lastOpenedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (activeProject && !sessionStore.projectDir) {
      sessionStore.setProjectDir(activeProject.path)
    }
  }, [activeProject?.path, sessionStore.projectDir, sessionStore])

  const openProject = useCallback(async (path: string) => {
    lastOpenedPathRef.current = path
    setCodexReady(false)

    sessionStore.setProjectDir(path)

    try {
      const { addProject, setActiveProject, projects } = useWorkspaceStore.getState()
      const projectName = path.split('/').pop() || path

      const existingProject = projects.find(p => p.path === path)
      if (existingProject) {
        setActiveProject(existingProject.id)
      } else {
        const projectId = addProject({ name: projectName, path })
        setActiveProject(projectId)
      }
    } catch (error) {
      // Workspace persistence failed (likely permissions); continue with session only
    }

    try {
      await invoke('restart_codex', { projectDir: path })
      setCodexReady(true)
    } catch (err) {
      console.error('Failed to restart Codex:', err)
      setCodexReady(false)
    }
  }, [sessionStore])

  const closeProject = useCallback(async () => {
    lastOpenedPathRef.current = null
    setCodexReady(false)
    sessionStore.setProjectDir(undefined)
    const { setActiveProject } = useWorkspaceStore.getState()
    setActiveProject(null)
    await invoke('stop_codex').catch(console.error)
  }, [sessionStore])

  useEffect(() => {
    if (activeProject?.path) {
      if (lastOpenedPathRef.current !== activeProject.path) {
        openProject(activeProject.path)
      }
    } else {
      lastOpenedPathRef.current = null
      setCodexReady(false)
    }
  }, [activeProject?.path, openProject])

  useEffect(() => {
    return () => {
      if ((window as any).__TAURI__) {
        invoke('stop_codex').catch(console.error)
      }
    }
  }, [])

  return { activeProject, codexReady, openProject, closeProject }
}

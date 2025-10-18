import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSession } from '../state/session'
import { useWorkspaceStore } from '../state/workspace'

export function useProjectLifecycle() {
  const [codexReady, setCodexReady] = useState(true)
  const sessionId = useSession((s) => s.sessionId)
  const sessionMeta = useSession((s) => s.sessionMeta)
  const projectDir = useSession((s) => s.projectDir)
  const codexThreadId = useSession((s) => s.codexThreadId)
  const createSession = useSession((s) => s.createSession)
  const switchSession = useSession((s) => s.switchSession)
  const closeSession = useSession((s) => s.closeSession)
  const setProjectDir = useSession((s) => s.setProjectDir)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const getProject = useWorkspaceStore((s) => s.getProject)
  const activeProject = activeProjectId ? getProject(activeProjectId) : null
  const lastOpenedPathRef = useRef<string | null>(null)

  const openProject = useCallback((path: string) => {
    lastOpenedPathRef.current = path

    const existing = Object.values(sessionMeta).find((meta) => meta.projectDir === path)
    let targetSessionId = sessionId

    if (existing) {
      if (existing.id !== sessionId) {
        switchSession(existing.id)
      }
      targetSessionId = existing.id
    } else {
      targetSessionId = createSession(path)
    }

    setProjectDir(path)
    try {
      useSession.getState().loadPersistedSession(path)
    } catch (err) {
      console.warn('[Lifecycle] Failed to load persisted session', err)
    }

    try {
      const { addProject, setActiveProject, projects } = useWorkspaceStore.getState()
      const projectName = path.split('/').pop() || path

      const existingProject = projects.find((p) => p.path === path)
      if (existingProject) {
        setActiveProject(existingProject.id)
      } else {
        const projectId = addProject({ name: projectName, path })
        setActiveProject(projectId)
      }
    } catch (error) {
      // Workspace persistence failed (likely permissions); continue with session only
    }

    if ((window as any).__TAURI__) {
      console.log('[Lifecycle] prepared Codex session', targetSessionId, 'for', path)
    }
    setCodexReady(true)
  }, [createSession, sessionId, sessionMeta, setProjectDir, switchSession])

  const closeProject = useCallback(() => {
    const currentSessionId = useSession.getState().sessionId
    lastOpenedPathRef.current = null
    setCodexReady(false)
    setProjectDir(undefined)
    const { setActiveProject } = useWorkspaceStore.getState()
    setActiveProject(null)
    if ((window as any).__TAURI__) {
      invoke('stop_codex', { sessionId: currentSessionId }).catch(console.error)
    }
    closeSession(currentSessionId)
  }, [closeSession, setProjectDir])

  useEffect(() => {
    const workspace = useWorkspaceStore.getState()
    if (projectDir) {
      lastOpenedPathRef.current = projectDir
      const existing = workspace.projects.find((p) => p.path === projectDir)
      if (existing) {
        if (workspace.activeProjectId !== existing.id) {
          workspace.setActiveProject(existing.id)
        }
      } else {
        const name = projectDir.split('/').pop() || projectDir
        const id = workspace.addProject({ name, path: projectDir })
        workspace.setActiveProject(id)
      }
      // Auto start/resume Codex handler for this project
      if ((window as any).__TAURI__) {
        invoke('start_codex', {
          sessionId,
          projectDir,
          threadId: codexThreadId ?? null,
          model: null,
          sandboxMode: 'workspace-write',
        }).catch(() => {})
      }
    } else if (!projectDir && activeProject?.path) {
      // No session project yet; fall back to opening the workspace selection once.
      openProject(activeProject.path)
    } else if (!projectDir) {
      lastOpenedPathRef.current = null
      setCodexReady(false)
    }
  }, [projectDir, activeProject?.path, openProject, sessionId, codexThreadId])

  useEffect(() => {
    return () => {
      if ((window as any).__TAURI__) {
        const currentSessionId = useSession.getState().sessionId
        invoke('stop_codex', { sessionId: currentSessionId }).catch(console.error)
      }
    }
  }, [])

  return { activeProject, codexReady, openProject, closeProject }
}

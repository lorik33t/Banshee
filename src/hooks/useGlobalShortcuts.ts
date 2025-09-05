import { useEffect } from 'react'
import { useSession } from '../state/session'

interface GlobalShortcutsProps {
  activeProject: any
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
}

export function useGlobalShortcuts({ activeProject, toggleLeftSidebar, toggleRightSidebar }: GlobalShortcutsProps) {
  const sessionStore = useSession()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!activeProject) return

      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        toggleLeftSidebar()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleRightSidebar()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault()
        sessionStore.setWorkbenchTab('codex')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeProject, toggleLeftSidebar, toggleRightSidebar, sessionStore])
}

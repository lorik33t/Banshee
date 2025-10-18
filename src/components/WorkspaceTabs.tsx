import { useCallback, useEffect, useMemo } from 'react'
import { useEditor } from '../state/editor'
import { useSession } from '../state/session'
import { Editor } from './Editor'
import { ChatView } from './ChatView'
import { Composer } from './Composer'
import { BrowserTab } from './BrowserTab'

export function WorkspaceTabs() {
  const openFiles = useEditor((s) => s.openFiles)
  const activePath = useEditor((s) => s.activePath)
  const updateContent = useEditor((s) => s.updateContent)
  const saveFile = useEditor((s) => s.saveFile)
  const projectDir = useSession((s) => s.projectDir)
  const workspaceView = useSession((s) => s.ui.workspaceView)
  const setWorkspaceView = useSession((s) => s.setWorkspaceView)

  const activeFile = openFiles.find((file) => file.path === activePath)

  useEffect(() => {
    if (activeFile && workspaceView === 'chat') {
      setWorkspaceView('editor')
    }
  }, [activeFile, workspaceView, setWorkspaceView])

  const displayPath = useMemo(() => {
    if (!activeFile) return ''
    return formatDisplayPath(activeFile.path, projectDir)
  }, [activeFile, projectDir])

  const handleSave = useCallback(() => {
    if (activeFile) {
      saveFile(activeFile.path).catch(() => {})
    }
  }, [activeFile, saveFile])

  const view = activeFile && workspaceView === 'editor' ? 'editor' : workspaceView ?? 'chat'

  return (
    <div className="workspace-root">
      {view === 'browser' ? (
        <BrowserTab />
      ) : view === 'editor' && activeFile ? (
        <div className="editor-view">
          <div className="editor-header">
            <div className="editor-path" title={activeFile.path}>{displayPath}</div>
            <div className="editor-actions">
              <button
                className="btn btn--accent"
                onClick={handleSave}
                disabled={!activeFile.dirty || activeFile.isSaving}
              >
                {activeFile.isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <div className="editor-canvas">
            <Editor
              language={detectLanguage(activeFile.path)}
              value={activeFile.content}
              onChange={(next) => updateContent(activeFile.path, next)}
            />
          </div>
        </div>
      ) : (
        <div className="workspace-chat">
          <div className="workspace-chat-scroll">
            <ChatView />
          </div>
          <Composer />
        </div>
      )}
    </div>
  )
}

function detectLanguage(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.rs')) return 'rust'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.sh')) return 'shell'
  return 'plaintext'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function formatDisplayPath(filePath: string, projectDir?: string | null): string {
  const normalizedFile = normalizePath(filePath)
  if (!projectDir) return normalizedFile
  const normalizedProject = normalizePath(projectDir)
  if (normalizedFile.toLowerCase().startsWith(normalizedProject.toLowerCase())) {
    const relative = normalizedFile.slice(normalizedProject.length).replace(/^\/+/, '')
    return relative || normalizedFile
  }
  return normalizedFile
}

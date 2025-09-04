import { FolderOpen, GitBranch, Clock, Sparkles, Play } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceStore } from '../state/workspace'
import { useState, useEffect } from 'react'

export function WelcomeView({ onProjectOpen }: { onProjectOpen: (path: string) => void }) {
  const { recentProjects } = useWorkspaceStore()
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [showClonePanel, setShowClonePanel] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [destParent, setDestParent] = useState('')
  const [elapsed, setElapsed] = useState('')

  // Set global cursor to progress while cloning
  useEffect(() => {
    if (!cloning) return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'progress'
    return () => {
      document.body.style.cursor = prev
    }
  }, [cloning])

  // No omnibar; actions are presented as simple tiles

  const openFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Project Folder'
      })
      
      if (selected) {
        onProjectOpen(selected as string)
      }
    } catch (err) {
      console.error('Failed to open folder:', err)
    }
  }

  const openRecent = (path: string) => {
    onProjectOpen(path)
  }

  const browseDest = async () => {
    try {
      const parent = await open({ directory: true, multiple: false, title: 'Choose destination folder' })
      if (parent && typeof parent === 'string') setDestParent(parent)
    } catch (e) { /* ignore */ }
  }

  const startClone = async () => {
    let timer: ReturnType<typeof setInterval> | null = null
    try {
      setCloneError(null)
      const trimmed = repoUrl.trim()
      if (!trimmed) { setCloneError('Please enter a repository URL'); return }
      if (!destParent) { setCloneError('Please choose a destination folder'); return }
      const last = trimmed.split('/')?.pop() || 'repo'
      const repoName = last.replace(/\.git$/i, '') || 'repo'
      const destDir = `${destParent}/${repoName}`
      setCloning(true)
      const started = Date.now()
      timer = setInterval(() => {
        const secs = Math.floor((Date.now() - started) / 1000)
        const m = Math.floor(secs / 60)
        const s = secs % 60
        setElapsed(m > 0 ? `${m}m ${s}s` : `${s}s`)
      }, 250)
      console.log('Invoking clone_repo with', { args: { url: trimmed, dest_dir: destDir } })
      await invoke<string>('clone_repo', { args: { url: trimmed, dest_dir: destDir } })
      onProjectOpen(destDir)
    } catch (err) {
      console.error('Clone failed:', err)
      setCloneError(String(err))
    } finally {
      setCloning(false)
      // clear timer and reset elapsed label
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      setElapsed('')
    }
  }

  return (
    <div className="welcome-view">
      <div className="welcome-content">
        <div className="welcome-header">
          <Sparkles size={48} className="welcome-icon" />
          <h1>Welcome to Banshee</h1>
          <p>Run, orchestrate, and observe CLI agents across providers</p>
        </div>

        {/* No omnibar – simplified start menu */}

        <div className="actions-grid">
          <button className="action-tile primary" onClick={() => alert('Start New Session (stub)')}>
            <Play size={18} />
            <div className="action-meta">
              <div className="label">Start New Session</div>
              <div className="hint">S</div>
            </div>
          </button>
          <button className="action-tile" onClick={openFolder}>
            <FolderOpen size={18} />
            <div className="action-meta">
              <div className="label">Open Folder</div>
              <div className="hint">O</div>
            </div>
          </button>
          <button className="action-tile" onClick={() => setShowClonePanel(true)} disabled={cloning} aria-busy={cloning}>
            <GitBranch size={18} />
            <div className="action-meta">
              <div className="label">Clone Repository</div>
              <div className="hint">G</div>
            </div>
          </button>
        </div>

        {showClonePanel && (
          <>
            {/* Overlay */}
            <div className="modal-overlay" onClick={() => (!cloning ? setShowClonePanel(false) : null)} />
            {/* Modal */}
            <div className="modal">
              <div className="modal-header">
                <div className="modal-title">Clone Repository</div>
                <button className="welcome-action" onClick={() => setShowClonePanel(false)} disabled={cloning}>Close</button>
              </div>

              {/* Progress bar (indeterminate) */}
              {cloning && (
                <div className="modal-body">
                  <div className="progress"><div className="bar" /></div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>Downloading… {elapsed}</div>
                </div>
              )}

              <div className="modal-body">
                <div className="form-col">
                  <input
                  type="text"
                  placeholder="https://github.com/owner/repo.git"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={cloning}
                  className="text-input"
                />
                <div className="form-row">
                  <input
                    type="text"
                    placeholder="Choose destination folder"
                    value={destParent}
                    readOnly
                    disabled={cloning}
                    className="text-input"
                    style={{ flex: 1 }}
                  />
                  <button className="welcome-action" onClick={browseDest} disabled={cloning}>Browse…</button>
                  <button className="welcome-action primary" onClick={startClone} disabled={cloning} aria-busy={cloning}>
                    {cloning ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span className="spinner" aria-hidden />
                        Cloning…
                      </span>
                    ) : 'Start Clone'}
                  </button>
                </div>

                {cloneError && (
                  <div className="error-banner" role="alert">
                    <strong style={{ marginRight: 6 }}>Clone failed:</strong>
                    <span>{cloneError}</span>
                  </div>
                )}
                </div>
              </div>
            </div>
          </>
        )}

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <h3>
              <Clock size={16} />
              Recent Projects
            </h3>
            <div className="recent-list">
              {recentProjects.slice(0, 5).map((project) => (
                <button
                  key={project.id}
                  className="recent-item"
                  onClick={() => openRecent(project.path)}
                  title={project.path}
                >
                  <FolderOpen size={16} />
                  <div className="recent-info">
                    <div className="recent-name">{project.name}</div>
                    <div className="recent-path">{project.path}</div>
                  </div>
                  {project.lastOpened && (
                    <div className="recent-time">
                      {new Date(project.lastOpened).toLocaleDateString()}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
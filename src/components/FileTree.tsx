import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { readDir, exists, BaseDirectory } from '@tauri-apps/plugin-fs'
import { ChevronRight, ChevronDown, Folder, FolderOpen, X, GitBranch, Search } from 'lucide-react'
import { useSession } from '../state/session'
import { useWorkspaceStore } from '../state/workspace'
import { getFileIcon } from '../utils/fileIcons'
import { invoke } from '@tauri-apps/api/core'
import { path } from '@tauri-apps/api'
import { runTauriFileSystemDiagnostics, formatDiagnosticResults } from '../utils/tauriDiagnostics'
import { getGitStatus, type GitFileStatus } from '../utils/gitStatus'
import { Tooltip } from './Tooltip'

interface FileNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  children?: FileNode[]
  expanded?: boolean
}

export function FileTree() {
  const projectDir = useSession((s) => s.projectDir)
  const setProjectDir = useSession((s) => s.setProjectDir)
  const { activeProjectId, getProject } = useWorkspaceStore()
  const [nodes, setNodes] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const loadAttempts = useRef(0)
  const lastLoadPath = useRef<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [gitStatus, setGitStatus] = useState<Map<string, GitFileStatus>>(new Map())
  const [showGitStatus, setShowGitStatus] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  
  // Get the active project path from workspace store
  const activeProject = activeProjectId ? getProject(activeProjectId) : null
  const currentProjectPath = activeProject?.path || projectDir
  
  // Add diagnostic helper
  const addDiagnostic = (msg: string) => {
    const timestamp = new Date().toISOString()
    const diagnostic = `[${timestamp}] ${msg}`
    console.log('[FileTree Diagnostic]', diagnostic)
    setDiagnostics(prev => [...prev.slice(-20), diagnostic]) // Keep last 20 diagnostics
  }

  const handleOpenRepo = useCallback(async () => {
    if (!(window as any).__TAURI__) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, multiple: false, title: 'Open Repository' })
      if (!selected) return

      const repoPathCandidate = Array.isArray(selected) ? selected[0] : selected
      if (typeof repoPathCandidate !== 'string' || repoPathCandidate.length === 0) return

      const repoPath = repoPathCandidate
      const projectName = repoPath.split('/').pop() || repoPath

      const workspace = useWorkspaceStore.getState()
      const existing = workspace.projects.find((p) => p.path === repoPath)
      if (existing) {
        workspace.setActiveProject(existing.id)
      } else {
        const projectId = workspace.addProject({ name: projectName, path: repoPath })
        workspace.setActiveProject(projectId)
      }

      const session = useSession.getState()
      session.setProjectDir(repoPath)
      setNodes([])
      setSearchQuery('')
      setSearchVisible(false)
    } catch (err) {
      console.error('Failed to open repository:', err)
    }
  }, [setProjectDir])

  // Load directory with comprehensive diagnostics
  async function loadDirectory(basePath: string, relativePath: string = ''): Promise<FileNode[]> {
    try {
      const fullPath = relativePath ? `${basePath}/${relativePath}` : basePath
      addDiagnostic(`Loading directory: ${fullPath}`)
      
      // Step 1: Check Tauri readiness
      if (!(window as any).__TAURI__) {
        addDiagnostic('ERROR: Tauri API not available')
        throw new Error('Tauri API not available')
      }
      
      // Step 2: Test fs plugin availability
      if (!readDir) {
        addDiagnostic('ERROR: readDir function not available from @tauri-apps/plugin-fs')
        throw new Error('readDir not available')
      }
      
      // Step 3: Check if path exists
      addDiagnostic(`Checking if path exists: ${fullPath}`)
      try {
        const pathExists = await exists(fullPath)
        addDiagnostic(`Path exists check result: ${pathExists}`)
        if (!pathExists) {
          // Try different path formats
          addDiagnostic('Path does not exist, trying alternative formats...')
          
          // Try normalizing the path
          const normalized = await path.normalize(fullPath)
          addDiagnostic(`Normalized path: ${normalized}`)
          
          const normalizedExists = await exists(normalized)
          addDiagnostic(`Normalized path exists: ${normalizedExists}`)
        }
      } catch (existsErr) {
        addDiagnostic(`ERROR checking path existence: ${existsErr}`)
      }
      
      // Step 4: Attempt readDir with detailed error handling
      addDiagnostic('Attempting readDir...')
      const entries = await readDir(fullPath).catch(async err => {
        const errorStr = err.toString()
        addDiagnostic(`readDir failed with error: ${errorStr}`)
        addDiagnostic(`Error type: ${err.constructor.name}`)
        addDiagnostic(`Error stack: ${err.stack || 'No stack trace'}`)
        
        // Try to provide more specific error info
        if (errorStr.includes('permission')) {
          addDiagnostic('DIAGNOSIS: Permission denied error')
          
          // Check Tauri fs scope configuration
          addDiagnostic('Checking Tauri configuration...')
          try {
            // Try to read a known safe directory to test permissions
            await readDir('/', { baseDir: BaseDirectory.Home })
            addDiagnostic('Can read home directory - permissions seem OK')
          } catch (homeErr) {
            addDiagnostic(`Cannot read home directory: ${homeErr}`)
          }
          
          throw new Error(`Permission denied: ${fullPath}`)
        } else if (errorStr.includes('not found') || errorStr.includes('No such file')) {
          addDiagnostic('DIAGNOSIS: Directory not found')
          
          // Log path components for debugging
          const pathParts = fullPath.split('/')
          addDiagnostic(`Path components: ${JSON.stringify(pathParts)}`)
          
          // Try to find where the path breaks
          let testPath = ''
          for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i]) {
              testPath = testPath ? `${testPath}/${pathParts[i]}` : `/${pathParts[i]}`
              try {
                const testExists = await exists(testPath)
                addDiagnostic(`Path segment '${testPath}' exists: ${testExists}`)
                if (!testExists) break
              } catch (e) {
                addDiagnostic(`Error checking '${testPath}': ${e}`)
                break
              }
            }
          }
          
          throw new Error(`Directory not found: ${fullPath}`)
        } else if (errorStr.includes('plugin not loaded') || errorStr.includes('not initialized')) {
          addDiagnostic('DIAGNOSIS: Tauri FS plugin not initialized')
          addDiagnostic('This suggests the plugin needs to be properly configured in Cargo.toml')
          throw new Error('Tauri FS plugin not initialized')
        }
        
        // Unknown error
        addDiagnostic('DIAGNOSIS: Unknown error type')
        throw err
      })
      
      addDiagnostic(`Successfully read directory, found ${entries.length} entries`)
      
      const nodes: FileNode[] = []
      for (const entry of entries as any[]) {
        const name = entry.name as string
        const isDirectory = entry.isDirectory as boolean
        
        // Skip only the most common large directories
        if (name === 'node_modules' || name === '.git') {
          continue
        }
        
        nodes.push({
          path: relativePath ? `${relativePath}/${name}` : name,
          name,
          kind: isDirectory ? 'dir' : 'file',
          children: isDirectory ? [] : undefined,
          expanded: false
        })
      }
      
      // Sort: directories first, then alphabetically
      return nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    } catch (err) {
      console.error('[FileTree] Failed to read directory:', currentProjectPath, err)
      return []
    }
  }

  // Initial load and reload when project changes
  useEffect(() => {
    loadAttempts.current++
    addDiagnostic(`=== Load attempt #${loadAttempts.current} ===`)
    addDiagnostic(`activeProjectId: ${activeProjectId}`)
    addDiagnostic(`projectDir: ${projectDir}`)
    addDiagnostic(`currentProjectPath: ${currentProjectPath}`)
    addDiagnostic(`lastLoadPath: ${lastLoadPath.current}`)
    
    // Check if this is a duplicate load attempt
    if (currentProjectPath === lastLoadPath.current) {
      addDiagnostic('Skipping duplicate load attempt for same path')
      return
    }
    
    if (currentProjectPath) {
      lastLoadPath.current = currentProjectPath
      setLoading(true)
      setNodes([]) // Clear previous project's files
      
      // Add timing diagnostics
      const loadStartTime = performance.now()
      addDiagnostic(`Starting load at ${loadStartTime}ms since page load`)
      
      const checkAndLoad = async () => {
        // Wait for Tauri to be ready
        let tauriCheckAttempts = 0
        while (!(window as any).__TAURI__ && tauriCheckAttempts < 50) {
          addDiagnostic(`Waiting for Tauri... attempt ${tauriCheckAttempts + 1}`)
          await new Promise(resolve => setTimeout(resolve, 100))
          tauriCheckAttempts++
        }
        
        if (!(window as any).__TAURI__) {
          addDiagnostic('ERROR: Tauri never became available after 5 seconds')
          setLoading(false)
          return
        }
        
        addDiagnostic('Tauri is ready, proceeding with directory load')
        
        try {
          const nodes = await loadDirectory(currentProjectPath)
          const loadEndTime = performance.now()
          addDiagnostic(`Load completed in ${(loadEndTime - loadStartTime).toFixed(2)}ms`)
          addDiagnostic(`Loaded ${nodes.length} nodes`)
          setNodes(nodes)
          setLoading(false)
        } catch (err: unknown) {
          const loadEndTime = performance.now()
          addDiagnostic(`Load FAILED after ${(loadEndTime - loadStartTime).toFixed(2)}ms`)
          addDiagnostic(`Error: ${String(err)}`)
          setLoading(false)
          
          // Retry logic for specific errors
          if (String(err).includes('not initialized') && loadAttempts.current < 3) {
            addDiagnostic('Scheduling retry in 1 second...')
            setTimeout(() => {
              lastLoadPath.current = null // Allow retry
              loadDirectory(currentProjectPath).then(setNodes).catch(console.error)
            }, 1000)
          }
        }
      }
      
      checkAndLoad()
      
      // Load git status (deferred to reduce startup contention)
      if (showGitStatus) {
        const gitTimer = setTimeout(() => {
          getGitStatus(currentProjectPath).then(status => {
            setGitStatus(status.files)
          }).catch(err => {
            console.error('[FileTree] Failed to load git status:', err)
          })
        }, 2500)
        return () => clearTimeout(gitTimer)
      }
    } else {
      addDiagnostic('No currentProjectPath available')
      setNodes([])
      lastLoadPath.current = null
    }
  }, [currentProjectPath, showGitStatus])
  

  useEffect(() => {
    if (searchVisible) {
      searchInputRef.current?.focus()
    }
  }, [searchVisible])

  // Refresh git status periodically
  useEffect(() => {
    if (!currentProjectPath || !showGitStatus) return
    
    // Defer starting the interval a bit after mount
    let interval: number | undefined
    const startTimer = window.setTimeout(() => {
      interval = window.setInterval(() => {
        getGitStatus(currentProjectPath).then(status => {
          setGitStatus(status.files)
        }).catch(err => {
          console.error('[FileTree] Failed to refresh git status:', err)
        })
      }, 5000)
    }, 3000)
    
    return () => {
      window.clearTimeout(startTimer)
      if (interval) window.clearInterval(interval)
    }
  }, [currentProjectPath, showGitStatus])

  // Toggle directory
  async function toggleDir(node: FileNode) {
    if (node.kind !== 'dir' || !currentProjectPath) return
    
    const newExpanded = !node.expanded
    node.expanded = newExpanded
    
    // Load children if expanding and not loaded yet
    if (newExpanded && node.children?.length === 0) {
      node.children = await loadDirectory(currentProjectPath, node.path)
    }
    
    setNodes([...nodes])
  }

  // Open file
  function openFile(node: FileNode) {
    if (node.kind === 'file') {
      // TODO: Implement file opening
      console.log('Open file:', node.path)
    }
  }

  // Close current folder
  async function closeFolder() {
    try {
      // Stop Claude
      await invoke('interrupt_codex').catch(() => {})
      
      // Clear the project directory in session
      setProjectDir(undefined)
      setNodes([])
      setSearchQuery('')
      setSearchVisible(false)
      
      // Navigate back to welcome screen by reloading
      // This will reset the app state and show the welcome view
      window.location.reload()
    } catch (err) {
      console.error('Failed to close folder:', err)
    }
  }

  // Helpers for filtering and flattening the tree
  const getStatusColor = (status: GitFileStatus | undefined) => {
    if (!status) return undefined
    switch (status.status) {
      case 'modified': return '#e2b340'
      case 'added': return '#50fa7b'
      case 'deleted': return '#ff5555'
      case 'untracked': return '#6272a4'
      default: return undefined
    }
  }

  const filterNodes = (items: FileNode[], query: string): FileNode[] => {
    if (!query) return items
    const q = query.toLowerCase()
    const filter = (nodes: FileNode[]): FileNode[] =>
      nodes
        .map(n => {
          if (n.kind === 'dir' && n.children) {
            const filteredChildren = filter(n.children)
            if (
              n.name.toLowerCase().includes(q) ||
              n.path.toLowerCase().includes(q) ||
              filteredChildren.length > 0
            ) {
              return { ...n, children: filteredChildren }
            }
          } else if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) {
            return n
          }
          return null
        })
        .filter(Boolean) as FileNode[]
    return filter(items)
  }

  const flattenNodes = (
    items: FileNode[],
    depth = 0,
    acc: { node: FileNode; depth: number }[] = []
  ) => {
    for (const node of items) {
      acc.push({ node, depth })
      const shouldExpand = searchQuery ? true : node.expanded
      if (node.kind === 'dir' && shouldExpand && node.children) {
        flattenNodes(node.children, depth + 1, acc)
      }
    }
    return acc
  }

  const flatNodes = useMemo(() => {
    const filtered = filterNodes(nodes, searchQuery)
    return flattenNodes(filtered)
  }, [nodes, searchQuery])

// ... (rest of the code remains the same)

  if (loading) {
    return (
      <div className="file-tree-empty">
        <p>Loading files...</p>
      </div>
    )
  }

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <div className="file-tree-title">
          <Folder size={16} />
          <span>{currentProjectPath ? currentProjectPath.split('/').pop() : ''}</span>
        </div>
        <div className="file-tree-actions">
          <button
            className="file-tree-button"
            onClick={handleOpenRepo}
            title="Open repository"
          >
            <FolderOpen size={14} />
            <span>Open repo</span>
          </button>
          <button
            className={`file-tree-action ${searchVisible ? 'active' : ''}`}
            onClick={() => {
              setSearchVisible((prev) => {
                const next = !prev
                if (!next) setSearchQuery('')
                return next
              })
            }}
            title={searchVisible ? 'Hide search' : 'Search files'}
          >
            <Search size={16} />
          </button>
          <button
            className="file-tree-action"
            onClick={() => setShowGitStatus(!showGitStatus)}
            title={showGitStatus ? "Hide git status" : "Show git status"}
            style={{ opacity: showGitStatus ? 1 : 0.5 }}
          >
            <GitBranch size={16} />
          </button>
          <button
            className="file-tree-action"
            onClick={closeFolder}
            title="Close folder"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {searchVisible && (
        <div className="file-tree-search-row">
          <Search size={14} className="file-tree-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="file-tree-search-input text-input"
          />
          {searchQuery && (
            <button
              className="file-tree-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}
      <div className="file-tree-content">
        {loading ? (
          <div className="file-tree-empty">
            <p>Loading files...</p>
          </div>
        ) : nodes.length > 0 ? (
          <Virtuoso
            style={{ height: '100%' }}
            data={flatNodes}
            itemContent={(_index, { node, depth }) => {
              const isDir = node.kind === 'dir'
              const isExpanded = !!node.expanded
              const { icon: FileIcon, color } = isDir
                ? { icon: isExpanded ? FolderOpen : Folder, color: 'var(--text-secondary)' }
                : getFileIcon(node.name)

              const fileStatus = gitStatus.get(node.path)
              const hasChanges = isDir
                ? Array.from(gitStatus.keys()).some(path => path.startsWith(node.path + '/'))
                : !!fileStatus
              const statusColor = fileStatus
                ? getStatusColor(fileStatus)
                : hasChanges
                  ? '#e2b340'
                  : undefined

              return (
                <div
                  className="file-item"
                  style={{ paddingLeft: `${12 + depth * 16}px` }}
                  onClick={() => (isDir ? toggleDir(node) : openFile(node))}
                >
                  {isDir && (
                    <span className="file-chevron">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  )}
                  <FileIcon size={16} className="file-icon" style={{ color }} />
                  <span className="file-name">{node.name}</span>
                  {showGitStatus && statusColor && (
                    <Tooltip
                      content={
                        fileStatus
                          ? `${fileStatus.status}${fileStatus.staged ? ' (staged)' : ''}`
                          : 'Has changes'
                      }
                      delay={200}
                    >
                      <span
                        className="file-status-indicator"
                        style={{
                          display: 'inline-block',
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: statusColor,
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!isDir && fileStatus) {
                            const sessionStore = useSession.getState()
                            sessionStore.setWorkbenchTab('diffs')
                          }
                        }}
                      />
                    </Tooltip>
                  )}
                </div>
              )
            }}
          />
        ) : (
          <div className="file-tree-empty">
            <p>Empty folder</p>
            <small style={{ opacity: 0.6, fontSize: '11px' }}>
              Path: {currentProjectPath}
            </small>
            {diagnostics.length > 0 && (
              <details style={{ marginTop: '10px', fontSize: '10px', opacity: 0.7 }}>
                <summary style={{ cursor: 'pointer' }}>Diagnostics ({diagnostics.length})</summary>
                <div style={{ 
                  maxHeight: '200px', 
                  overflowY: 'auto', 
                  padding: '5px', 
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '4px',
                  marginTop: '5px',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}>
                  {diagnostics.map((d, i) => (
                    <div key={i} style={{ 
                      marginBottom: '2px',
                      color: d.includes('ERROR') ? '#ff6b6b' : 
                             d.includes('SUCCESS') ? '#51cf66' : 
                             d.includes('DIAGNOSIS') ? '#ffd93d' : 'inherit'
                    }}>
                      {d}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <button
              style={{
                marginTop: '10px',
                padding: '5px 10px',
                fontSize: '11px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
              onClick={async () => {
                addDiagnostic('=== Running Full Tauri FS Diagnostics ===')
                const results = await runTauriFileSystemDiagnostics(currentProjectPath || '')
                const formatted = formatDiagnosticResults(results)
                formatted.split('\n').forEach(line => {
                  if (line.trim()) addDiagnostic(line)
                })
              }}
            >
              Run Full Diagnostics
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

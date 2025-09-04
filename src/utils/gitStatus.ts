import { invoke } from '@tauri-apps/api/core'

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unchanged'

export interface GitFileStatus {
  path: string
  status: FileStatus
  staged: boolean
}

export interface GitStatusResult {
  files: Map<string, GitFileStatus>
  branch: string
  ahead: number
  behind: number
}

// Cache git status to avoid too many calls
let statusCache: GitStatusResult | null = null
let cacheTimestamp = 0
const CACHE_DURATION = 1000 // 1 second cache

export async function getGitStatus(projectPath: string): Promise<GitStatusResult> {
  const now = Date.now()
  
  // Return cached result if still fresh
  if (statusCache && now - cacheTimestamp < CACHE_DURATION) {
    return statusCache
  }
  
  try {
    // Run git status command
    const result = await invoke<any>('run_command', {
      command: 'git status --porcelain=v1 -b',
      cwd: projectPath
    })
    
    if (result.exit_code !== 0) {
      // Not a git repository or git error
      return {
        files: new Map(),
        branch: '',
        ahead: 0,
        behind: 0
      }
    }
    
    const lines = result.output.trim().split('\n')
    const files = new Map<string, GitFileStatus>()
    
    let branch = ''
    let ahead = 0
    let behind = 0
    
    for (const line of lines) {
      if (line.startsWith('##')) {
        // Parse branch info
        const match = line.match(/## (.+?)(?:\.\.\.(.+?))?(?:\s+\[ahead (\d+)(?:, behind (\d+))?\])?$/)
        if (match) {
          branch = match[1]
          ahead = parseInt(match[3] || '0')
          behind = parseInt(match[4] || '0')
        }
      } else if (line.length > 2) {
        // Parse file status
        const statusCode = line.substring(0, 2)
        const filePath = line.substring(3)
        
        let status: FileStatus = 'unchanged'
        let staged = false
        
        // Check staging area status (first character)
        const stagingStatus = statusCode[0]
        if (stagingStatus !== ' ' && stagingStatus !== '?') {
          staged = true
        }
        
        // Determine file status
        if (statusCode === '??') {
          status = 'untracked'
        } else if (statusCode.includes('M')) {
          status = 'modified'
        } else if (statusCode.includes('A')) {
          status = 'added'
        } else if (statusCode.includes('D')) {
          status = 'deleted'
        } else if (statusCode.includes('R')) {
          status = 'renamed'
        }
        
        // Handle renamed files (they appear as "R  old -> new")
        const actualPath = filePath.includes(' -> ') 
          ? filePath.split(' -> ')[1] 
          : filePath
        
        files.set(actualPath, {
          path: actualPath,
          status,
          staged
        })
      }
    }
    
    statusCache = { files, branch, ahead, behind }
    cacheTimestamp = now
    
    return statusCache
  } catch (error) {
    console.error('Failed to get git status:', error)
    return {
      files: new Map(),
      branch: '',
      ahead: 0,
      behind: 0
    }
  }
}

export function clearGitStatusCache() {
  statusCache = null
  cacheTimestamp = 0
}

// Get status for a specific file
export async function getFileStatus(projectPath: string, filePath: string): Promise<GitFileStatus | null> {
  const status = await getGitStatus(projectPath)
  return status.files.get(filePath) || null
}

// Check if path has any changes under it (for directories)
export async function hasChangesUnderPath(projectPath: string, dirPath: string): Promise<boolean> {
  const status = await getGitStatus(projectPath)
  
  for (const [filePath] of status.files) {
    if (filePath.startsWith(dirPath)) {
      return true
    }
  }
  
  return false
}
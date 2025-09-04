// Session persistence utilities - PER REPOSITORY

export interface PersistedSession {
  messages: any[]
  events: any[]
  tools?: Record<string, any>  // Add tools to persistence
  edits?: any[]  // Add edits too
  cost: {
    usd: number
    tokensIn: number
    tokensOut: number
  }
  lastUpdated: string
  sessionId?: string
  projectPath?: string
}

const SESSION_STORAGE_PREFIX = 'claude_session_'
// Increased limits for full conversation history
const MAX_EVENTS = 50000  // 10x increase
const MAX_MESSAGES = 10000  // 10x increase

// Get storage key for a specific project
function getStorageKey(projectPath?: string): string {
  if (!projectPath) {
    // Get from current project if not provided
    const currentProject = (window as any).useSession?.getState()?.projectDir
    projectPath = currentProject || 'default'
  }
  // Create a safe key from the path
  const safeKey = (projectPath || 'default').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
  return `${SESSION_STORAGE_PREFIX}${safeKey}`
}

export function saveSession(data: Partial<PersistedSession>, projectPath?: string) {
  try {
    const storageKey = getStorageKey(projectPath)
    const existing = loadSession(projectPath)
    const updated: PersistedSession = {
      ...existing,
      ...data,
      lastUpdated: new Date().toISOString(),
      projectPath: projectPath || existing.projectPath
    }
    
    // Trim if too large
    if (updated.events && updated.events.length > MAX_EVENTS) {
      updated.events = updated.events.slice(-MAX_EVENTS)
    }
    if (updated.messages && updated.messages.length > MAX_MESSAGES) {
      updated.messages = updated.messages.slice(-MAX_MESSAGES)
    }
    
    localStorage.setItem(storageKey, JSON.stringify(updated))
  } catch (e) {
    console.error('Failed to save session:', e)
  }
}

export function loadSession(projectPath?: string): PersistedSession {
  try {
    const storageKey = getStorageKey(projectPath)
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error('Failed to load session:', e)
  }
  
  return {
    messages: [],
    events: [],
    tools: {},
    edits: [],
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    lastUpdated: new Date().toISOString(),
    projectPath
  }
}

export function clearSession(projectPath?: string) {
  try {
    const storageKey = getStorageKey(projectPath)
    localStorage.removeItem(storageKey)
  } catch (e) {
    console.error('Failed to clear session:', e)
  }
}

export function getSessionAge(projectPath?: string): number {
  const session = loadSession(projectPath)
  if (!session.lastUpdated) return Infinity
  
  const lastUpdate = new Date(session.lastUpdated)
  const now = new Date()
  return now.getTime() - lastUpdate.getTime()
}

// Check if session is stale (older than 24 hours)
export function isSessionStale(projectPath?: string): boolean {
  const age = getSessionAge(projectPath)
  return age > 24 * 60 * 60 * 1000 // 24 hours in milliseconds
}

// Get all stored sessions
export function getAllSessions(): { path: string; session: PersistedSession }[] {
  const sessions: { path: string; session: PersistedSession }[] = []
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(SESSION_STORAGE_PREFIX)) {
      try {
        const session = JSON.parse(localStorage.getItem(key) || '{}')
        const path = session.projectPath || key.replace(SESSION_STORAGE_PREFIX, '')
        sessions.push({ path, session })
      } catch (e) {
        // Skip invalid entries
      }
    }
  }
  
  return sessions
}
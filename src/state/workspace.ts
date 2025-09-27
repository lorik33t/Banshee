import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { migrateWorkspaceData } from '../utils/workspaceMigration'

export interface Project {
  id: string
  name: string
  path: string
  lastOpened?: number
}

export interface WorkspaceState {
  projects: Project[]
  activeProjectId: string | null
  recentProjects: Project[]
  
  // Actions
  addProject: (project: Omit<Project, 'id'>) => string
  removeProject: (id: string) => void
  setActiveProject: (id: string | null) => void
  updateProjectLastOpened: (id: string) => void
  getProject: (id: string) => Project | undefined
  getRecentProjects: (limit?: number) => Project[]
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      recentProjects: [],
      
      addProject: (projectData) => {
        const id = `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const project: Project = {
          ...projectData,
          id,
          lastOpened: Date.now()
        }

        try {
          set(state => {
            // Limit total projects to prevent localStorage quota issues
            const maxProjects = 50
            const currentProjects = state.projects.length >= maxProjects
              ? state.projects.slice(-maxProjects + 1) // Keep only the most recent ones
              : state.projects

            return {
              projects: [...currentProjects, project],
              recentProjects: [project, ...state.recentProjects.filter(p => p.id !== id)].slice(0, 10)
            }
          })
        } catch (error) {
          console.warn('[Workspace] localStorage quota exceeded, clearing old projects:', error)
          // If still failing, clear more aggressively
          try {
            set(() => ({
              projects: [project], // Start fresh with just this project
              recentProjects: [project].slice(0, 10)
            }))
          } catch (fallbackError) {
            console.error('[Workspace] Critical localStorage error:', fallbackError)
          }
        }

        return id
      },
      
      removeProject: (id) => {
        set(state => ({
          projects: state.projects.filter(p => p.id !== id),
          activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
          recentProjects: state.recentProjects.filter(p => p.id !== id)
        }))
      },
      
      setActiveProject: (id) => {
        set({ activeProjectId: id })
        if (id) {
          get().updateProjectLastOpened(id)
        }
      },
      
      updateProjectLastOpened: (id) => {
        set(state => {
          const project = state.projects.find(p => p.id === id)
          if (!project) return state
          
          const updatedProject = { ...project, lastOpened: Date.now() }
          const updatedProjects = state.projects.map(p => p.id === id ? updatedProject : p)
          
          // Update recent projects
          const recentProjects = [
            updatedProject,
            ...state.recentProjects.filter(p => p.id !== id)
          ].slice(0, 10)
          
          return {
            projects: updatedProjects,
            recentProjects
          }
        })
      },
      
      getProject: (id) => {
        return get().projects.find(p => p.id === id)
      },
      
      getRecentProjects: (limit = 5) => {
        return get().recentProjects.slice(0, limit)
      }
    }),
    {
      name: 'claude-code-workspace',
      version: 1,
      migrate: (persistedState: any, version: number) => {
        console.log('[Workspace] Migrating from version', version)
        return migrateWorkspaceData(persistedState as WorkspaceState)
      }
    }
  )
)
import type { WorkspaceState } from '../state/workspace'

export function migrateWorkspaceData(state: WorkspaceState): WorkspaceState {
  // Fix projects that point to parent directories instead of actual project folders
  const fixedProjects = state.projects.map(project => {
    // If the saved path points to a parent repo directory like ".../conductor/repo/point",
    // fix it by appending the appropriate subdirectory based on project name.
    // This avoids hardcoding user-specific absolute paths.
    if (project.path.endsWith('/conductor/repo/point')) {
      if (project.name === 'babylon') {
        return { ...project, path: `${project.path}/babylon` }
      } else if (project.name === 'tender-copilot-chat' || project.name === 'point') {
        return { ...project, path: `${project.path}/tender-copilot-chat` }
      }
    }
    return project
  })

  return {
    ...state,
    projects: fixedProjects,
    recentProjects: fixedProjects.filter(p => 
      state.recentProjects.some(rp => rp.id === p.id)
    )
  }
}
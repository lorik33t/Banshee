import { useCallback, useMemo } from "react";
import { GitBranch, Globe, MessageCircle, Save, Search, X } from "lucide-react";
import { useEditor } from "../state/editor";
import { useSession } from "../state/session";
import { useWorkspaceStore } from "../state/workspace";

export function WorkspaceHeader(props: {
  searchVisible: boolean;
  onToggleSearch: () => void;
  showGitStatus: boolean;
  onToggleGitStatus: () => void;
  workbenchTab: "diffs" | "checkpoints";
  onWorkbenchTabChange: (tab: "diffs" | "checkpoints") => void;
  showWorkbench: boolean;
  workspaceView: "chat" | "editor" | "browser";
  onWorkspaceViewChange: (view: "chat" | "editor" | "browser") => void;
}) {
  const {
    searchVisible,
    onToggleSearch,
    showGitStatus,
    onToggleGitStatus,
    workbenchTab: _workbenchTab,
    onWorkbenchTabChange: _onWorkbenchTabChange,
    showWorkbench: _showWorkbench,
    workspaceView,
    onWorkspaceViewChange,
  } = props;

  const openFiles = useEditor((s) => s.openFiles);
  const activePath = useEditor((s) => s.activePath);
  const setActiveFile = useEditor((s) => s.setActiveFile);
  const closeFile = useEditor((s) => s.closeFile);
  const saveAll = useEditor((s) => s.saveAll);

  const hasDirty = useMemo(
    () => openFiles.some((file) => file.dirty),
    [openFiles],
  );

  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId);
  const getProject = useWorkspaceStore((state) => state.getProject);
  const projectDir = useSession((s) => s.projectDir);

  const activeProject = activeProjectId ? getProject(activeProjectId) : null;

  const projectLabel = useMemo(() => {
    if (activeProject?.name && activeProject.name.trim().length) {
      return activeProject.name;
    }
    if (projectDir) {
      const parts = projectDir.split(/\\|\//).filter(Boolean);
      return parts[parts.length - 1] ?? projectDir;
    }
    return "Workspace";
  }, [activeProject?.name, projectDir]);

  const handleSelectTab = useCallback(
    (path?: string) => {
      setActiveFile(path);
      onWorkspaceViewChange(path ? "editor" : "chat");
    },
    [onWorkspaceViewChange, setActiveFile],
  );

  return (
    <div className="workspace-header">
      <div className="workspace-header-left">
        <span
          className="workspace-project-name"
          title={projectDir ?? undefined}
        >
          {projectLabel}
        </span>
        <button
          type="button"
          className={`workspace-icon-btn ${searchVisible ? "active" : ""}`}
          onClick={onToggleSearch}
          title={searchVisible ? "Hide search" : "Search files"}
          aria-pressed={searchVisible}
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          className={`workspace-icon-btn ${showGitStatus ? "active" : ""}`}
          onClick={onToggleGitStatus}
          title={showGitStatus ? "Hide git status" : "Show git status"}
          aria-pressed={showGitStatus}
        >
          <GitBranch size={16} />
        </button>
      </div>

      <div className="workspace-header-views">
        <button
          type="button"
          className={`workspace-icon-btn ${workspaceView === "chat" ? "active" : ""}`}
          onClick={() => onWorkspaceViewChange("chat")}
          title="Chat workspace"
          aria-pressed={workspaceView === "chat"}
        >
          <MessageCircle size={16} />
        </button>
        <button
          type="button"
          className={`workspace-icon-btn ${workspaceView === "browser" ? "active" : ""}`}
          onClick={() => onWorkspaceViewChange("browser")}
          title="Browser workspace"
          aria-pressed={workspaceView === "browser"}
        >
          <Globe size={16} />
        </button>
      </div>

      <div className="workspace-header-center">
        <div className="editor-tabs editor-tabs--inline">
          {/* Removed Chat heading; only show file tabs when present */}
          {openFiles.map((file) => {
            const isActive = file.path === activePath;
            return (
              <button
                type="button"
                key={file.path}
                className={`editor-tab ${isActive ? "active" : ""}`}
                onClick={() => handleSelectTab(file.path)}
              >
                <span className="editor-tab-title">
                  {file.name}
                  {file.dirty && <span className="editor-tab-dot" />}
                </span>
                <X
                  size={12}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeFile(file.path);
                  }}
                />
              </button>
            );
          })}
          <div className="editor-tab-spacer" />
        </div>
        {openFiles.length > 0 && (
          <button
            type="button"
            className="editor-save-all"
            onClick={() => saveAll().catch(() => {})}
            disabled={!hasDirty}
          >
            <Save size={14} /> Save all
          </button>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import {
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  RefreshCw,
  Settings as SettingsIcon,
  FolderOpen,
  Plus,
  X,
} from "lucide-react";
import "./index.css";
import { FileTree } from "./components/FileTree";
import { CheckpointsPanel } from "./components/CheckpointsPanel";
import { WelcomeView } from "./components/WelcomeView";
import { PermissionDialog } from "./components/PermissionDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TauriInitDiagnostics } from "./components/TauriInitDiagnostics";
import { DiffsPanel } from "./components/DiffsPanel";
import { WorkspaceTabs } from "./components/WorkspaceTabs";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { useSession } from "./state/session";
import { useProjectLifecycle } from "./hooks/useProjectLifecycle";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { SettingsView } from "./components/SettingsView";
import { useSettings } from "./state/settings";
import { invoke } from "@tauri-apps/api/core";

type TauriWindow = Window & { __TAURI__?: unknown };

const getTauriWindow = (): TauriWindow | null => {
  if (typeof window === "undefined") return null;
  return "__TAURI__" in window ? (window as TauriWindow) : null;
};

function useCssWidth(key: string, fallback: number) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return fallback;
    const stored = Number(window.localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(`--${key}`, `${width}px`);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, String(Math.round(width)));
    }
  }, [key, width]);

  return [width, setWidth] as const;
}

export default function App() {
  const { activeProject, openProject, closeProject } = useProjectLifecycle();
  const sessionId = useSession((s) => s.sessionId);
  const sessionOrder = useSession((s) => s.sessionOrder);
  const sessionMeta = useSession((s) => s.sessionMeta);
  const createSession = useSession((s) => s.createSession);
  const switchSession = useSession((s) => s.switchSession);
  const closeSession = useSession((s) => s.closeSession);
  const workbenchTab = useSession((s) => s.ui.workbenchTab);
  const setWorkbenchTab = useSession((s) => s.setWorkbenchTab);
  const workspaceView = useSession((s) => s.ui.workspaceView ?? "chat");
  const setWorkspaceView = useSession((s) => s.setWorkspaceView);
  const openSettings = useSettings((s) => s.openSettings);
  const loadSettings = useSettings((s) => s.loadSettings);
  const themePreference = useSettings((s) => s.settings.theme);

  const [leftSidebarWidth, setLeftSidebarWidth] = useCssWidth("ls-width", 320);
  const [workbenchWidth, setWorkbenchWidth] = useCssWidth("wb-width", 420);

  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showWorkbench, setShowWorkbench] = useState(true);
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const [fileTreeSearchVisible, setFileTreeSearchVisible] = useState(false);
  const [fileTreeShowGitStatus, setFileTreeShowGitStatus] = useState(true);

  const toggleLeftSidebar = useCallback(() => {
    setShowLeftSidebar((prev) => !prev);
  }, []);

  const toggleWorkbench = useCallback(() => {
    setShowWorkbench((prev) => !prev);
  }, []);

  const openFolder = useCallback(async () => {
    if (!getTauriWindow()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Project Folder",
      });

      if (selected) {
        const folderPath = Array.isArray(selected) ? selected[0] : selected;
        if (typeof folderPath === "string" && folderPath.length > 0) {
          await openProject(folderPath);
        }
      }
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, [openProject]);

  useGlobalShortcuts({
    activeProject,
    toggleLeftSidebar,
    toggleRightSidebar: toggleWorkbench,
  });

  useEffect(() => {
    if (!activeProject) {
      setShowLeftSidebar(false);
      setShowWorkbench(false);
    } else {
      setShowLeftSidebar(true);
      setShowWorkbench(true);
    }
  }, [activeProject]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setFileTreeSearchVisible(false);
  }, [activeProject]);

  useEffect(() => {
    if (!showLeftSidebar) {
      setFileTreeSearchVisible(false);
    }
  }, [showLeftSidebar]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const mode = themePreference ?? "system";
      if (mode === "retro") {
        root.setAttribute("data-theme", "retro");
        return;
      }

      const resolved =
        mode === "dark"
          ? "dark"
          : mode === "light"
            ? "light"
            : media.matches
              ? "dark"
              : "light";
      if (resolved === "dark") {
        root.setAttribute("data-theme", "dark");
      } else {
        root.removeAttribute("data-theme");
      }
    };

    applyTheme();

    if (!themePreference || themePreference === "system") {
      const listener = () => applyTheme();
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
      }
      media.addListener(listener);
      return () => media.removeListener(listener);
    }

    return undefined;
  }, [themePreference]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: MouseEvent | TouchEvent) => {
      const clientX =
        "touches" in event ? (event.touches[0]?.clientX ?? 0) : event.clientX;
      const clamp = (value: number, min: number, max: number) =>
        Math.min(max, Math.max(min, value));
      if (resizing === "left") {
        const next = clamp(clientX, 200, 600);
        setLeftSidebarWidth(next);
      } else if (resizing === "right") {
        const viewportWidth = window.innerWidth;
        const next = clamp(viewportWidth - clientX, 280, 640);
        setWorkbenchWidth(next);
      }
    };
    const stop = () => setResizing(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", stop);
    window.addEventListener("mouseleave", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("mouseleave", stop);
    };
  }, [resizing, setLeftSidebarWidth, setWorkbenchWidth]);

  const leftResizeStart = useCallback(
    (event: ReactMouseEvent | ReactTouchEvent) => {
      event.preventDefault();
      setResizing("left");
    },
    [],
  );

  const rightResizeStart = useCallback(
    (event: ReactMouseEvent | ReactTouchEvent) => {
      event.preventDefault();
      setResizing("right");
    },
    [],
  );

  const handleNewSession = useCallback(() => {
    if (getTauriWindow()) {
      void openFolder();
    } else {
      createSession(undefined);
    }
  }, [createSession, openFolder]);

  const handleCloseSession = useCallback(
    async (id: string) => {
      if (id === sessionId) {
        closeProject();
        return;
      }
      if (getTauriWindow()) {
        await invoke("stop_codex", { sessionId: id }).catch(() => {});
      }
      closeSession(id);
    },
    [closeProject, closeSession, sessionId],
  );

  if (!activeProject) {
    return (
      <div className="app">
        <WelcomeView onProjectOpen={openProject} />
        <PermissionDialog />
        <TauriInitDiagnostics />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span>Banshee</span>
          </div>
          {sessionOrder.length > 0 && (
            <div className="session-tabs">
              {sessionOrder.map((id) => {
                const meta = sessionMeta[id];
                const isActive = id === sessionId;
                return (
                  <button
                    key={id}
                    className={`session-tab ${isActive ? "active" : ""}`}
                    onClick={() => switchSession(id)}
                  >
                    <span className="session-tab-label">
                      {meta?.name ?? "Session"}
                    </span>
                    {sessionOrder.length > 1 && (
                      <span
                        className="session-tab-close"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCloseSession(id);
                        }}
                      >
                        <X size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                className="session-tab add"
                onClick={handleNewSession}
                title="Open project in new session"
              >
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="header-right">
          <button
            className="header-btn"
            onClick={openFolder}
            title="Open Different Repository"
          >
            <FolderOpen size={16} />
          </button>
          <button
            className="header-btn"
            onClick={toggleLeftSidebar}
            title={showLeftSidebar ? "Hide File Tree" : "Show File Tree"}
          >
            {showLeftSidebar ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </button>
          <button
            className="header-btn"
            onClick={toggleWorkbench}
            title={showWorkbench ? "Hide Workbench" : "Show Workbench"}
          >
            {showWorkbench ? (
              <PanelRightClose size={16} />
            ) : (
              <PanelRightOpen size={16} />
            )}
          </button>
          <button
            className="header-btn"
            onClick={closeProject}
            title="Close Project"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="header-btn"
            onClick={openSettings}
            title="Settings"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      <div className="main-content">
        <WorkspaceHeader
          searchVisible={fileTreeSearchVisible}
          onToggleSearch={() => setFileTreeSearchVisible((prev) => !prev)}
          showGitStatus={fileTreeShowGitStatus}
          onToggleGitStatus={() => setFileTreeShowGitStatus((prev) => !prev)}
          workbenchTab={workbenchTab}
          onWorkbenchTabChange={setWorkbenchTab}
          showWorkbench={showWorkbench}
          workspaceView={workspaceView}
          onWorkspaceViewChange={setWorkspaceView}
        />

        <div className="workspace-body">
          {showLeftSidebar && (
            <>
              <div className="left-sidebar" style={{ width: leftSidebarWidth }}>
                <FileTree
                  searchVisible={fileTreeSearchVisible}
                  showGitStatus={fileTreeShowGitStatus}
                  onToggleSearch={() =>
                    setFileTreeSearchVisible((prev) => !prev)
                  }
                  onToggleGitStatus={() =>
                    setFileTreeShowGitStatus((prev) => !prev)
                  }
                />
              </div>
              <div
                className="resizer"
                onMouseDown={leftResizeStart}
                onTouchStart={leftResizeStart}
              />
            </>
          )}

          <div className="workspace-container">
            <ErrorBoundary>
              <WorkspaceTabs />
            </ErrorBoundary>
          </div>

          {showWorkbench && (
            <>
              <div
                className="resizer"
                onMouseDown={rightResizeStart}
                onTouchStart={rightResizeStart}
              />
              <div className="workbench" style={{ width: workbenchWidth }}>
                <div className="workbench-body">
                  {workbenchTab === "diffs" && <DiffsPanel />}
                  {workbenchTab === "checkpoints" && <CheckpointsPanel />}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <PermissionDialog />
      <TauriInitDiagnostics />
      <SettingsView />
    </div>
  );
}

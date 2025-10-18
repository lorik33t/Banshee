import { create } from "zustand";
import {
  saveSession,
  loadSession,
  clearSession,
} from "../utils/sessionPersistence";
import { useEditor } from "./editor";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  DEFAULT_MODE_ID,
  DEFAULT_MODEL_ID,
  type ModeOptionId,
} from "../constants/codex";

export type Role = "user" | "assistant";
export type ToolType =
  | "bash"
  | "grep"
  | "read"
  | "write"
  | "web"
  | "mcp"
  | "task";

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string; name?: string };

export type MessageEvent = {
  id: string;
  type: "message";
  role: Role;
  text: string; // Keep for backward compatibility
  content?: MessageContent[]; // New content array for mixed content
  model?: string; // Track which model/subagent was used
  routingReason?: string; // Why the router chose this model (copied from the preceding user message)
  tokens?: { input: number; output: number }; // Per-message token counts
  ts: number;
};

export type ToolStartEvent = {
  id: string;
  type: "tool:start";
  tool: ToolType;
  args: Record<string, any>;
  ts: number;
};
export type ToolOutputEvent = {
  id: string;
  type: "tool:output";
  chunk: string;
  done?: boolean;
  stream?: "stdout" | "stderr";
  exitCode?: number;
  ts: number;
};

export type EditProposedEvent = {
  id: string;
  type: "edit:proposed";
  file: string;
  before: string;
  after: string;
  ts: number;
};
export type EditStatusEvent = {
  id: string;
  type: "edit:applied" | "edit:rejected";
  ts: number;
};

export type PermissionRequestEvent = {
  id: string;
  type: "permission:request";
  tools: ToolType[];
  scope: "once" | "session" | "project";
  details?: Record<string, any>;
  ts: number;
};
export type PermissionDecisionEvent = {
  id: string;
  type: "permission:decision";
  allow: boolean;
  scope: "once" | "session" | "project";
  ts: number;
};

export type CostUpdateEvent = {
  type: "cost:update";
  usd: number;
  tokensIn: number;
  tokensOut: number;
  ts: number;
};

export type ThinkingEvent = {
  id: string;
  type: "thinking";
  text: string;
  done: boolean;
  ts: number;
  parentId?: string;
  sequence?: number;
  fullText?: string;
};

// Checkpoint events from handlers
export type CheckpointCreateEvent = {
  type: "checkpoint:create";
  trigger?: string;
  fileSnapshots?: Array<{
    path: string;
    originalContent?: string;
    currentContent?: string;
  }>;
  ts: number;
};

export type CheckpointRecord = {
  id: string;
  ts: number;
  trigger?: string;
  fileCount: number;
};

export type TurnSnapshot = {
  id: string;
  turn: number;
  ts: number;
  summary?: string;
  checkpointId?: string;
  tool?: string;
};

// Telemetry token stats (from Gemini/Qwen handlers)
export type TokenUsageSnapshot = {
  input: number;
  cachedInput: number;
  output: number;
  reasoning: number;
  total: number;
};

export type RateLimitWindowSummary = {
  usedPercent: number;
  windowMinutes?: number;
  resetsInSeconds?: number;
};

export type RateLimitSummary = {
  primary?: RateLimitWindowSummary;
  secondary?: RateLimitWindowSummary;
  primaryToSecondaryRatio?: number;
};

export type BrowserSelectionContext = {
  selector: string;
  summary?: string;
  textContent?: string;
  outerHTML?: string;
  url?: string;
  includeInNextMessage?: boolean;
  capturedAt: number;
};

export type TelemetryTokensEvent = {
  type: "telemetry:tokens";
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  thoughtsTokens?: number;
  toolTokens?: number;
  latencyMs?: number;
  tokenUsage?: TokenUsageSnapshot;
  rateLimits?: RateLimitSummary;
  contextWindow?: number;
  contextEffective?: number;
  contextUsedTokens?: number;
  contextRemainingTokens?: number;
  contextUsedPct?: number;
  contextRemainingPct?: number;
  ts: number;
};

export type SessionEvent =
  | MessageEvent
  | ToolStartEvent
  | ToolOutputEvent
  | EditProposedEvent
  | EditStatusEvent
  | PermissionRequestEvent
  | PermissionDecisionEvent
  | CostUpdateEvent
  | ThinkingEvent
  | CheckpointCreateEvent
  | TelemetryTokensEvent
  | { type: "assistant:delta"; chunk: string; ts: number }
  | { type: "assistant:complete"; text: string; ts: number; id?: string } // allow optional id for source correlation
  | { type: "model:update"; model?: string; ts: number }
  | { type: "thread:update"; threadId?: string; ts: number }
  | { type: "raw"; payload: any; ts: number };

export type ProposedEdit = {
  id: string;
  file: string;
  before: string;
  after: string;
  status: "proposed" | "applied" | "rejected";
};

export type ToolRun = {
  id: string;
  tool: ToolType;
  args: Record<string, any>;
  output: string;
  done: boolean;
  agent?: string;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
};

export type ContextUsageState = {
  window?: number;
  effective?: number;
  usedTokens?: number;
  remainingTokens?: number;
  usedPct?: number;
  remainingPct?: number;
  tokenUsage?: TokenUsageSnapshot;
  rateLimits?: RateLimitSummary;
};

type SessionMeta = {
  id: string;
  name: string;
  projectDir?: string;
  createdAt: number;
  codexThreadId?: string;
};

type SessionData = {
  events: SessionEvent[];
  messages: MessageEvent[];
  tools: Record<string, ToolRun>;
  toolOrder: string[];
  edits: ProposedEdit[];
  checkpoints?: CheckpointRecord[];
  turns: TurnSnapshot[];
  currentTurnIndex: number;
  pendingCheckpointId?: string;
  thinking?: { text: string; done: boolean };
  projectDir?: string;
  permissions: {
    pending?: PermissionRequestEvent;
    decisions: PermissionDecisionEvent[];
  };
  cost: { usd: number; tokensIn: number; tokensOut: number };
  contextUsage?: ContextUsageState;
  autoAccept: boolean;
  selectedEditId?: string;
  showTerminal: boolean;
  isStreaming: boolean;
  streamingStartTime?: number;
  streamingModel?: string;
  streamingMessageId?: string;
  pendingProjectDir?: string;
  fileTracker: {
    originalContents: Map<string, string>;
    modifiedFiles: Set<string>;
    isTracking: boolean;
  };
  browserSelection?: BrowserSelectionContext;
  codexSelection: {
    modelId: string;
    modeId: ModeOptionId;
  };
  ui: {
    workbenchTab: "diffs" | "checkpoints" | "codex";
    workspaceView?: "chat" | "editor" | "browser";
  };
  codexThreadId?: string;
};

const createSessionId = () => `sess-${Math.random().toString(36).slice(2, 10)}`;

const cloneJson = <T>(value: T): T => {
  const fn = (globalThis as any).structuredClone;
  if (typeof fn === "function") {
    return fn(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const cloneTools = (
  tools: Record<string, ToolRun>,
): Record<string, ToolRun> => {
  const result: Record<string, ToolRun> = {};
  for (const [id, tool] of Object.entries(tools)) {
    result[id] = {
      ...tool,
      args: cloneJson(tool.args ?? {}),
      output: tool.output,
    };
  }
  return result;
};

const captureSessionSnapshot = (state: SessionState): SessionData => ({
  events: state.events.map(cloneJson),
  messages: state.messages.map(cloneJson),
  tools: cloneTools(state.tools),
  toolOrder: [...state.toolOrder],
  edits: state.edits.map(cloneJson),
  checkpoints: state.checkpoints ? state.checkpoints.map(cloneJson) : [],
  turns: state.turns.map(cloneJson),
  currentTurnIndex: state.currentTurnIndex,
  thinking: state.thinking ? { ...state.thinking } : undefined,
  projectDir: state.projectDir,
  permissions: {
    pending: state.permissions.pending
      ? cloneJson(state.permissions.pending)
      : undefined,
    decisions: state.permissions.decisions.map(cloneJson),
  },
  cost: { ...state.cost },
  contextUsage: state.contextUsage ? { ...state.contextUsage } : undefined,
  autoAccept: state.autoAccept,
  selectedEditId: state.selectedEditId,
  showTerminal: state.showTerminal,
  isStreaming: state.isStreaming,
  streamingStartTime: state.streamingStartTime,
  streamingModel: state.streamingModel,
  streamingMessageId: state.streamingMessageId,
  pendingProjectDir: state.pendingProjectDir,
  pendingCheckpointId: state.pendingCheckpointId,
  fileTracker: {
    originalContents: new Map(state.fileTracker.originalContents),
    modifiedFiles: new Set(state.fileTracker.modifiedFiles),
    isTracking: state.fileTracker.isTracking,
  },
  browserSelection: state.browserSelection
    ? { ...state.browserSelection }
    : undefined,
  codexSelection: { ...state.codexSelection },
  ui: { ...state.ui },
  codexThreadId: state.codexThreadId,
});

const applySessionSnapshot = (data: SessionData): Partial<SessionState> => ({
  events: data.events.map(cloneJson),
  messages: data.messages.map(cloneJson),
  tools: cloneTools(data.tools),
  toolOrder: [...data.toolOrder],
  edits: data.edits.map(cloneJson),
  checkpoints: data.checkpoints ? data.checkpoints.map(cloneJson) : [],
  turns: data.turns.map(cloneJson),
  currentTurnIndex: data.currentTurnIndex,
  thinking: data.thinking ? { ...data.thinking } : undefined,
  projectDir: data.projectDir,
  permissions: {
    pending: data.permissions.pending
      ? cloneJson(data.permissions.pending)
      : undefined,
    decisions: data.permissions.decisions.map(cloneJson),
  },
  cost: { ...data.cost },
  contextUsage: data.contextUsage ? { ...data.contextUsage } : undefined,
  autoAccept: data.autoAccept,
  selectedEditId: data.selectedEditId,
  showTerminal: data.showTerminal,
  isStreaming: data.isStreaming,
  streamingStartTime: data.streamingStartTime,
  streamingModel: data.streamingModel,
  streamingMessageId: data.streamingMessageId,
  pendingProjectDir: data.pendingProjectDir,
  pendingCheckpointId: data.pendingCheckpointId,
  fileTracker: {
    originalContents: new Map(data.fileTracker.originalContents),
    modifiedFiles: new Set(data.fileTracker.modifiedFiles),
    isTracking: data.fileTracker.isTracking,
  },
  browserSelection: data.browserSelection
    ? { ...data.browserSelection }
    : undefined,
  codexSelection: data.codexSelection
    ? { ...data.codexSelection }
    : { modelId: DEFAULT_MODEL_ID, modeId: DEFAULT_MODE_ID },
  ui: {
    workbenchTab: data.ui.workbenchTab ?? "diffs",
    workspaceView: data.ui.workspaceView ?? "chat",
  },
  codexThreadId: data.codexThreadId,
});

const createSessionData = (): SessionData => ({
  events: [],
  messages: [],
  tools: {},
  toolOrder: [],
  edits: [],
  checkpoints: [],
  turns: [],
  currentTurnIndex: -1,
  thinking: undefined,
  projectDir: undefined,
  permissions: { decisions: [] },
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextUsage: undefined,
  autoAccept: false,
  selectedEditId: undefined,
  showTerminal: false,
  isStreaming: false,
  streamingStartTime: undefined,
  streamingModel: undefined,
  streamingMessageId: undefined,
  pendingProjectDir: undefined,
  pendingCheckpointId: undefined,
  fileTracker: {
    originalContents: new Map(),
    modifiedFiles: new Set(),
    isTracking: false,
  },
  browserSelection: undefined,
  codexSelection: {
    modelId: DEFAULT_MODEL_ID,
    modeId: DEFAULT_MODE_ID,
  },
  ui: { workbenchTab: "diffs", workspaceView: "chat" },
  codexThreadId: undefined,
});

const sessionSnapshots = new Map<string, SessionData>();

const pendingSessionEvents = new Map<string, SessionEvent[]>();

const cloneEvent = <T>(event: T): T => JSON.parse(JSON.stringify(event));

export const queueSessionEvent = (sessionId: string, event: SessionEvent) => {
  const queue = pendingSessionEvents.get(sessionId);
  if (queue) {
    queue.push(cloneEvent(event));
  } else {
    pendingSessionEvents.set(sessionId, [cloneEvent(event)]);
  }
};

const flushPendingEvents = (
  sessionId: string,
  push: (event: SessionEvent) => void,
) => {
  const queue = pendingSessionEvents.get(sessionId);
  if (!queue?.length) return;
  pendingSessionEvents.delete(sessionId);
  queue.forEach((event) => push(cloneEvent(event)));
};

const deriveSessionName = (
  metas: Record<string, SessionMeta>,
  projectDir?: string,
) => {
  const existingNames = new Set(Object.values(metas).map((meta) => meta.name));
  if (projectDir && projectDir.trim().length) {
    const base = projectDir.split(/\\|\//).filter(Boolean).pop() || "Session";
    let name = base;
    let counter = 2;
    while (existingNames.has(name)) {
      name = `${base} (${counter++})`;
    }
    return name;
  }
  let index = existingNames.size + 1;
  let name = `Session ${index}`;
  while (existingNames.has(name)) {
    index += 1;
    name = `Session ${index}`;
  }
  return name;
};

export type SessionState = {
  sessionId: string;
  sessionOrder: string[];
  sessionMeta: Record<string, SessionMeta>;
  events: SessionEvent[];
  messages: MessageEvent[];
  tools: Record<string, ToolRun>;
  toolOrder: string[];
  edits: ProposedEdit[];
  checkpoints?: CheckpointRecord[];
  turns: TurnSnapshot[];
  currentTurnIndex: number;
  thinking?: { text: string; done: boolean };
  projectDir?: string;
  permissions: {
    pending?: PermissionRequestEvent;
    decisions: PermissionDecisionEvent[];
  };
  cost: { usd: number; tokensIn: number; tokensOut: number };
  contextUsage?: ContextUsageState;
  autoAccept: boolean;
  selectedEditId?: string;
  showTerminal: boolean;
  isStreaming: boolean;
  streamingStartTime?: number;
  streamingModel?: string;
  streamingMessageId?: string;
  pendingProjectDir?: string;
  pendingCheckpointId?: string;
  // File tracking for checkpoints
  fileTracker: {
    originalContents: Map<string, string>;
    modifiedFiles: Set<string>;
    isTracking: boolean;
  };
  browserSelection?: BrowserSelectionContext;
  codexSelection: {
    modelId: string;
    modeId: ModeOptionId;
  };
  ui: {
    workbenchTab: "diffs" | "checkpoints" | "codex";
    workspaceView: "chat" | "editor" | "browser";
  };
  codexThreadId?: string;

  createSession: (projectDir?: string, name?: string) => string;
  switchSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  pushEvent: (e: SessionEvent) => void;
  setProjectDir: (dir?: string) => void;
  setAutoAccept: (v: boolean) => void;
  setBrowserSelection: (selection: BrowserSelectionContext) => void;
  clearBrowserSelection: () => void;
  markBrowserSelectionUsed: () => void;
  setCodexSelection: (
    selection: Partial<{ modelId: string; modeId: ModeOptionId }>,
  ) => void;
  setCodexThreadId: (threadId?: string) => void;
  acceptEdit: (id: string) => void;
  rejectEdit: (id: string) => void;
  selectEdit: (id?: string) => void;
  resolvePermission: (
    allow: boolean,
    scope: "once" | "session" | "project",
  ) => void;
  setWorkbenchTab: (tab: "diffs" | "checkpoints" | "codex") => void;
  setWorkspaceView: (view: "chat" | "editor" | "browser") => void;
  setShowTerminal: (show: boolean) => void;
  setStreaming: (
    streaming: boolean,
    model?: string,
    messageId?: string,
  ) => void;
  clearConversation: () => void;
  loadPersistedSession: (projectPath?: string) => void;
  clearSession: () => void;
  restoreTurn: (turnIndex: number) => Promise<void>;
  undoTurn: () => Promise<void>;
  redoTurn: () => Promise<void>;
};

export const useSession = create<SessionState>((set, get) => {
  const initialId = createSessionId();
  const initialMeta: SessionMeta = {
    id: initialId,
    name: "Session 1",
    projectDir: undefined,
    createdAt: Date.now(),
    codexThreadId: undefined,
  };
  const baseState = applySessionSnapshot(createSessionData());

  return {
    sessionId: initialId,
    sessionOrder: [initialId],
    sessionMeta: { [initialId]: initialMeta },
    ...baseState,
    createSession: (projectDir?: string, name?: string) => {
      const current = get();
      sessionSnapshots.set(current.sessionId, captureSessionSnapshot(current));
      const nextId = createSessionId();
      const sessionName =
        name ?? deriveSessionName(current.sessionMeta, projectDir);
      const meta: SessionMeta = {
        id: nextId,
        name: sessionName,
        projectDir,
        createdAt: Date.now(),
        codexThreadId: undefined,
      };
      const data = createSessionData();
      data.projectDir = projectDir;
      set((state) => ({
        sessionId: nextId,
        sessionOrder: [...state.sessionOrder, nextId],
        sessionMeta: { ...state.sessionMeta, [nextId]: meta },
        ...applySessionSnapshot(data),
      }));
      sessionSnapshots.delete(nextId);
      flushPendingEvents(nextId, get().pushEvent);
      return nextId;
    },
    switchSession: (nextId: string) => {
      const current = get();
      if (current.sessionId === nextId) return;
      sessionSnapshots.set(current.sessionId, captureSessionSnapshot(current));
      const snapshot = sessionSnapshots.get(nextId) ?? createSessionData();
      set((state) => ({
        sessionId: nextId,
        sessionOrder: state.sessionOrder.includes(nextId)
          ? state.sessionOrder
          : [...state.sessionOrder, nextId],
        sessionMeta: {
          ...state.sessionMeta,
          [nextId]: {
            ...(state.sessionMeta[nextId] ?? {
              id: nextId,
              name: deriveSessionName(state.sessionMeta, snapshot.projectDir),
              createdAt: Date.now(),
            }),
            projectDir: snapshot.projectDir,
            codexThreadId: snapshot.codexThreadId,
          },
        },
        ...applySessionSnapshot(snapshot),
      }));
      sessionSnapshots.delete(nextId);
      flushPendingEvents(nextId, get().pushEvent);
    },
    closeSession: (targetId: string) => {
      const current = get();
      if (!current.sessionOrder.includes(targetId)) return;
      const remaining = current.sessionOrder.filter((id) => id !== targetId);
      const updatedMeta = { ...current.sessionMeta };
      delete updatedMeta[targetId];
      sessionSnapshots.delete(targetId);

      if (remaining.length === 0) {
        const newId = createSessionId();
        const meta: SessionMeta = {
          id: newId,
          name: "Session 1",
          projectDir: undefined,
          createdAt: Date.now(),
          codexThreadId: undefined,
        };
        const data = createSessionData();
        set({
          sessionId: newId,
          sessionOrder: [newId],
          sessionMeta: { [newId]: meta },
          ...applySessionSnapshot(data),
        });
        return;
      }

      if (targetId === current.sessionId) {
        const nextId = remaining[0];
        const snapshot = sessionSnapshots.get(nextId) ?? createSessionData();
        set({
          sessionId: nextId,
          sessionOrder: remaining,
          sessionMeta: updatedMeta,
          ...applySessionSnapshot(snapshot),
        });
      } else {
        set({
          sessionOrder: remaining,
          sessionMeta: updatedMeta,
        });
      }
    },
    renameSession: (sessionId: string, name: string) => {
      set((state) => ({
        sessionMeta: {
          ...state.sessionMeta,
          [sessionId]: {
            ...(state.sessionMeta[sessionId] ?? {
              id: sessionId,
              createdAt: Date.now(),
            }),
            name,
          },
        },
      }));
    },

    pushEvent: (e) => {
      const state = get();

      if (e.type === "thread:update") {
        get().setCodexThreadId(e.threadId);
        return;
      }

      // Global deduplication check for events with IDs (but be more conservative for messages)
      const hasId = "id" in e && e.id;
      if (hasId) {
        const isDuplicate = state.events.some((existing) => {
          if (existing.type !== e.type) return false;
          if (!("id" in existing) || existing.id !== e.id) return false;
          if (
            existing.type === "tool:start" ||
            existing.type === "tool:output"
          ) {
            return (
              existing.ts === e.ts ||
              Math.abs((existing.ts || 0) - (e.ts || 0)) < 1000
            ); // Within 1 second
          }
          // For messages, be more strict - only skip if timestamp is exactly the same
          if (existing.type === "message") {
            return existing.ts === e.ts;
          }
          return existing.ts === e.ts;
        });

        if (isDuplicate) {
          console.log(
            "[session.pushEvent] Skipping duplicate event:",
            e.type,
            e.id,
          );
          return;
        }
      }

      const appendTurnSnapshot = (
        summary: string | undefined,
        timestamp: number,
        checkpointId?: string,
        model?: string,
        messageId?: string,
      ) => {
        const trimmedSummary = summary
          ? summary.split("\n")[0]?.trim().slice(0, 160)
          : undefined;
        const turnId = messageId || `turn_${timestamp}`;
        set((prev) => {
          const baseTurns =
            prev.currentTurnIndex >= 0
              ? prev.turns.slice(0, prev.currentTurnIndex + 1)
              : [];
          const last = baseTurns[baseTurns.length - 1];
          if (
            last &&
            last.id === turnId &&
            last.summary === trimmedSummary &&
            last.checkpointId === checkpointId
          ) {
            const shouldClearPending =
              checkpointId && prev.pendingCheckpointId === checkpointId;
            return shouldClearPending ? { pendingCheckpointId: undefined } : {};
          }

          const snapshot: TurnSnapshot = {
            id: turnId,
            turn: baseTurns.length,
            ts: timestamp,
            summary:
              trimmedSummary && trimmedSummary.length > 0
                ? trimmedSummary
                : undefined,
            checkpointId,
            tool: model,
          };

          const turns = [...baseTurns, snapshot];
          return {
            turns,
            currentTurnIndex: turns.length - 1,
            pendingCheckpointId: undefined,
          };
        });
      };

      const sanitizeOutput = (text: string | undefined, model?: string) => {
        if (!text) return text;
        const m = (model || "").toLowerCase();

        const lines = text.split(/\r?\n/);
        const filtered = lines.filter((line) => {
          const trimmed = line.trim();

          // Filter out messy log messages
          if (
            trimmed.includes("FunctionCall:") &&
            trimmed.includes("timeout_ms")
          )
            return false;
          if (trimmed.includes("codex_core::codex") && trimmed.includes("INFO"))
            return false;
          if (trimmed.includes("stderr") && trimmed.includes('ts":'))
            return false;
          if (
            trimmed.includes('⚠️ {"message":"') &&
            trimmed.includes("\\u001b")
          )
            return false;

          // Filter out ANSI escape sequences and log noise
          if (
            trimmed.match(
              /^\u001b\[2m\d{4}-\d{2}-\d{2}T.*\u001b\[0m.*INFO.*codex_core/,
            )
          )
            return false;

          // Only sanitize known benign Qwen CLI noise
          if (m.includes("qwen")) {
            if (/loaded cached qwen credentials\.?/i.test(line)) return false;
          }

          return true;
        });

        return filtered.join("\n");
      };
      if (e.type === "checkpoint:create") {
        // Persist checkpoint to backend and track in memory
        const id = `cp_${Date.now()}`;
        const snaps = (e.fileSnapshots || []).map((s) => ({
          path: s.path,
          original_content: s.originalContent ?? "",
          current_content: s.currentContent ?? s.originalContent ?? "",
        }));
        // Fire and forget; do not block UI
        Promise.resolve()
          .then(() => {
            try {
              // @ts-ignore invoke available in Tauri env
              return invoke("save_checkpoint_files", {
                sessionId: state.sessionId,
                checkpointId: id,
                files: snaps,
                trigger: e.trigger,
              });
            } catch {}
          })
          .catch(() => {});

        const rec: CheckpointRecord = {
          id,
          ts: e.ts,
          trigger: e.trigger,
          fileCount: snaps.length,
        };
        const existing = state.checkpoints || [];
        const nextEvents = [...state.events, e];
        set((prev) => {
          const nextTurns = prev.turns.length
            ? (() => {
                const updated = [...prev.turns];
                const lastIndex = updated.length - 1;
                if (lastIndex >= 0 && !updated[lastIndex].checkpointId) {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    checkpointId: rec.id,
                  };
                }
                return updated;
              })()
            : prev.turns;
          return {
            events:
              nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
            checkpoints: [rec, ...existing].slice(0, 100),
            pendingCheckpointId: rec.id,
            turns: nextTurns,
          };
        });
        // Optionally surface the panel
        set((s) => ({ ui: { ...s.ui, workbenchTab: "checkpoints" } }));
        return;
      }
      if (e.type === "model:update") {
        // Update streamingModel so UI can display the active subagent badge
        set({ streamingModel: e.model });
        const nextEvents = [...state.events, e];
        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
        });
        return;
      }
      if (e.type === "assistant:complete") {
        const finalizeStreaming = () => {
          let changed = false;
          set((prev) => {
            if (
              !prev.isStreaming &&
              !prev.streamingStartTime &&
              !prev.streamingModel &&
              !prev.streamingMessageId
            ) {
              return {};
            }
            changed = true;
            return {
              isStreaming: false,
              streamingStartTime: undefined,
              streamingModel: undefined,
              streamingMessageId: undefined,
            };
          });
          if (changed) {
            const updated = get();
            sessionSnapshots.set(
              updated.sessionId,
              captureSessionSnapshot(updated),
            );
          }
        };

        finalizeStreaming();

        // Finalize the assistant message for this stream id; create if missing
        const messages = [...state.messages];
        const incomingId = (e as any).id ? String((e as any).id) : undefined;
        const streamId = state.streamingMessageId;
        const targetId = streamId || incomingId;
        let targetIndex = -1;
        const checkpointIdForTurn = get().pendingCheckpointId;
        const modelForTurn = state.streamingModel;
        if (targetId) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (
              messages[i].role === "assistant" &&
              messages[i].id === targetId
            ) {
              targetIndex = i;
              break;
            }
          }
        }
        if (targetIndex >= 0) {
          const last = messages[targetIndex];
          // Prefer the final text from the completion event to avoid duplicating
          // partial/garbled streaming output (seen with some CLIs like Qwen).
          const finalText =
            e.text && e.text.length
              ? (sanitizeOutput(e.text, state.streamingModel) as string)
              : (sanitizeOutput(last.text, state.streamingModel) as string);
          const maxPrevTs = Math.max(
            ...state.events.map((ev) => ev.ts || 0),
            ...state.messages.map((m) => m.ts || 0),
          );
          const updatedTs = maxPrevTs + 1;
          // If the final event carries a different id, migrate the message id to it
          const finalId = incomingId || last.id;
          // Ensure routingReason is preserved or copied from the last user message
          let rr = last.routingReason;
          if (!rr) {
            for (let i = state.messages.length - 1; i >= 0; i--) {
              const m = state.messages[i] as any;
              if (m.role === "user" && m.routingReason) {
                rr = m.routingReason;
                break;
              }
            }
          }
          const updatedMsg = {
            ...last,
            id: finalId,
            text: finalText,
            ts: updatedTs,
            routingReason: rr,
            tokens: last.tokens,
          };
          const previousId = last.id;
          messages[targetIndex] = updatedMsg;
          // Add the final message to events array (since streaming deltas weren't added)
          const eventsCopy = [...state.events];
          let foundMessage = false;
          for (let i = eventsCopy.length - 1; i >= 0; i--) {
            const ev = eventsCopy[i] as any;
            if (
              ev.type === "message" &&
              ev.role === "assistant" &&
              (ev.id === previousId || ev.id === updatedMsg.id)
            ) {
              eventsCopy[i] = updatedMsg as any;
              foundMessage = true;
              break;
            }
          }
          if (!foundMessage) {
            eventsCopy.push(updatedMsg as any);
          }
          const nextEvents = [...eventsCopy, e];
          set({
            events:
              nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
            messages:
              messages.length > 10000 ? messages.slice(-10000) : messages,
            streamingMessageId: undefined,
            isStreaming: false,
            streamingStartTime: undefined,
            streamingModel: undefined,
          });
          appendTurnSnapshot(
            finalText,
            updatedTs,
            checkpointIdForTurn,
            modelForTurn,
            finalId,
          );
          const updatedState = get();
          sessionSnapshots.set(
            updatedState.sessionId,
            captureSessionSnapshot(updatedState),
          );
          if (updatedState.projectDir) {
            saveSession(
              {
                events: nextEvents.slice(-50000),
                messages: messages.slice(-10000),
                tools: updatedState.tools,
                toolOrder: updatedState.toolOrder,
                edits: updatedState.edits,
                cost: updatedState.cost,
                threadId: updatedState.codexThreadId,
              },
              updatedState.projectDir,
            );
          }
          return;
        }
        // Fallback: If we didn't find an exact id match, try to update the most recent
        // assistant message from this turn (prevents duplicate replies when handlers
        // change ids between streaming and completion).
        let recentAssistantIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") {
            recentAssistantIndex = i;
            break;
          }
        }
        if (recentAssistantIndex >= 0) {
          // Ensure this assistant message belongs to the current turn (after last user)
          let lastUserTs = 0;
          for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i].role === "user") {
              lastUserTs = state.messages[i].ts;
              break;
            }
          }
          if (messages[recentAssistantIndex].ts >= lastUserTs) {
            const last = messages[recentAssistantIndex];
            const finalText =
              e.text && e.text.length
                ? (sanitizeOutput(e.text, state.streamingModel) as string)
                : (sanitizeOutput(last.text, state.streamingModel) as string);
            const updatedTs =
              Math.max(
                ...state.events.map((ev) => (ev as any).ts || 0),
                ...state.messages.map((m) => (m as any).ts || 0),
              ) + 1;
            const finalId = incomingId || last.id;
            let rr = last.routingReason;
            if (!rr) {
              for (let i = state.messages.length - 1; i >= 0; i--) {
                const m = state.messages[i] as any;
                if (m.role === "user" && m.routingReason) {
                  rr = m.routingReason;
                  break;
                }
              }
            }
            const updatedMsg = {
              ...last,
              id: finalId,
              text: finalText,
              ts: updatedTs,
              routingReason: rr,
            };
            const previousId = last.id;
            messages[recentAssistantIndex] = updatedMsg;
            const eventsCopy = [...state.events];
            let foundMessage = false;
            for (let i = eventsCopy.length - 1; i >= 0; i--) {
              const ev = eventsCopy[i] as any;
              if (
                ev.type === "message" &&
                ev.role === "assistant" &&
                (ev.id === previousId || ev.id === updatedMsg.id)
              ) {
                eventsCopy[i] = updatedMsg as any;
                foundMessage = true;
                break;
              }
            }
            if (!foundMessage) {
              eventsCopy.push(updatedMsg as any);
            }
            const nextEvents = [...eventsCopy, e];
            set({
              events:
                nextEvents.length > 50000
                  ? nextEvents.slice(-50000)
                  : nextEvents,
              messages:
                messages.length > 10000 ? messages.slice(-10000) : messages,
              streamingMessageId: undefined,
            });
            appendTurnSnapshot(
              finalText,
              updatedTs,
              checkpointIdForTurn,
              modelForTurn,
              finalId,
            );
            const updatedState = get();
            sessionSnapshots.set(
              updatedState.sessionId,
              captureSessionSnapshot(updatedState),
            );
            if (updatedState.projectDir) {
              saveSession(
                {
                  events: nextEvents.slice(-50000),
                  messages: messages.slice(-10000),
                  tools: updatedState.tools,
                  toolOrder: updatedState.toolOrder,
                  edits: updatedState.edits,
                  cost: updatedState.cost,
                  threadId: updatedState.codexThreadId,
                },
                updatedState.projectDir,
              );
            }
            return;
          }
        }
        // No existing assistant message; create final assistant message directly
        const model = state.streamingModel;
        // Ensure assistant ts > last user and last tool ts so it renders below all prior events
        let lastUserTs = 0;
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === "user") {
            lastUserTs = state.messages[i].ts;
            break;
          }
        }
        let lastToolTs = 0;
        for (const ev of state.events) {
          if (ev.type === "tool:start" || ev.type === "tool:output") {
            if (ev.ts > lastToolTs) lastToolTs = ev.ts;
          }
        }
        const baseTs = e.ts || Date.now();
        const msgTs = Math.max(baseTs, lastUserTs, lastToolTs) + 1;
        // Copy routingReason from the last user message, if any
        let lastUserReason: string | undefined = undefined;
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const m = state.messages[i] as any;
          if (m.role === "user" && m.routingReason) {
            lastUserReason = m.routingReason;
            break;
          }
        }
        const msg: MessageEvent = {
          id: (e as any).id || String(Date.now()),
          type: "message",
          role: "assistant",
          text: sanitizeOutput(e.text, state.streamingModel) as string,
          model,
          routingReason: lastUserReason,
          ts: msgTs,
        };
        const nextEvents = [...state.events, e, msg];
        const nextMessages = [...state.messages, msg];
        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          messages:
            nextMessages.length > 10000
              ? nextMessages.slice(-10000)
              : nextMessages,
          streamingMessageId: undefined,
        });
        appendTurnSnapshot(
          msg.text,
          msg.ts,
          checkpointIdForTurn,
          model,
          msg.id,
        );
        const updatedState = get();
        sessionSnapshots.set(
          updatedState.sessionId,
          captureSessionSnapshot(updatedState),
        );
        if (updatedState.projectDir) {
          saveSession(
            {
              events: nextEvents.slice(-50000),
              messages: nextMessages.slice(-10000),
              tools: updatedState.tools,
              toolOrder: updatedState.toolOrder,
              edits: updatedState.edits,
              cost: updatedState.cost,
              threadId: updatedState.codexThreadId,
            },
            updatedState.projectDir,
          );
        }
        return;
      }
      if (e.type === "message") {
        // Removed expensive console logging - only log in development
        if (import.meta.env.DEV) {
          console.log("[session.pushEvent] Received message event:", {
            id: e.id,
            role: e.role,
            textLength: e.text?.length,
            textPreview: e.text?.substring(0, 50),
          });
        }

        // Check if this exact event already exists
        const existingEventIndex = state.events.findIndex(
          (ev) => ev.type === "message" && ev.id === e.id && ev.text === e.text,
        );
        if (existingEventIndex >= 0) {
          console.log("[session.pushEvent] Skipping duplicate event");
          return;
        }

        // For assistant messages, aggregate by ID if it's part of the same response
        if (e.role === "assistant" && e.id) {
          const existingIndex = state.messages.findIndex(
            (m) => m.id === e.id && m.role === "assistant",
          );
          if (existingIndex >= 0) {
            const existing = state.messages[existingIndex];
            // If text is identical, skip duplicate
            if (e.text === existing.text) {
              console.log(
                "[session.pushEvent] Skipping identical assistant message",
              );
              return;
            }
            // If new text contains old (streaming continuation), replace
            if (e.text.includes(existing.text)) {
              // Update text; ensure model populated
              // Ensure assistant ts after last tool event for correct rendering order
              let lastToolTs = 0;
              for (const ev of state.events) {
                if (ev.type === "tool:start" || ev.type === "tool:output") {
                  if (ev.ts > lastToolTs) lastToolTs = ev.ts;
                }
              }
              const newTs = Math.max(Date.now(), lastToolTs + 1);
              // Preserve or adopt routingReason from the last user message for clarity
              let lastUserReason: string | undefined = existing.routingReason;
              if (!lastUserReason) {
                for (let i = state.messages.length - 1; i >= 0; i--) {
                  const m = state.messages[i] as any;
                  if (m.role === "user" && m.routingReason) {
                    lastUserReason = m.routingReason;
                    break;
                  }
                }
              }
              const updated = {
                ...existing,
                text: sanitizeOutput(e.text, state.streamingModel) as string,
                model: existing.model || state.streamingModel,
                routingReason: lastUserReason,
                ts: newTs,
              };
              const nextEvents = [...state.events];
              const nextMessages = [...state.messages];
              nextMessages[existingIndex] = updated;
              // Update events array entry as well
              for (let i = nextEvents.length - 1; i >= 0; i--) {
                if (
                  (nextEvents[i] as any).id === updated.id &&
                  nextEvents[i].type === "message"
                ) {
                  nextEvents[i] = updated as any;
                  break;
                }
              }
              set({
                events:
                  nextEvents.length > 50000
                    ? nextEvents.slice(-50000)
                    : nextEvents,
                messages:
                  nextMessages.length > 10000
                    ? nextMessages.slice(-10000)
                    : nextMessages,
              });
              return;
            }
            // If old text contains new (shouldn't happen), skip duplicate
            // But only if the new text is significantly smaller (less than 50% of old text)
            if (
              existing.text.includes(e.text) &&
              e.text.length < existing.text.length * 0.5
            ) {
              console.log(
                "[session.pushEvent] Skipping subset assistant message",
              );
              return;
            }
            // Otherwise append as separate paragraph
            let lastUserReason: string | undefined = existing.routingReason;
            if (!lastUserReason) {
              for (let i = state.messages.length - 1; i >= 0; i--) {
                const m = state.messages[i] as any;
                if (m.role === "user" && m.routingReason) {
                  lastUserReason = m.routingReason;
                  break;
                }
              }
            }
            const updated = {
              ...existing,
              text:
                existing.text +
                "\n\n" +
                (sanitizeOutput(e.text, state.streamingModel) as string),
              model: existing.model || state.streamingModel,
              routingReason: lastUserReason,
            };
            const nextEvents = [...state.events, e];
            const nextMessages = [
              ...state.messages.slice(0, existingIndex),
              updated,
              ...state.messages.slice(existingIndex + 1),
            ];
            set({
              events:
                nextEvents.length > 50000
                  ? nextEvents.slice(-50000)
                  : nextEvents,
              messages:
                nextMessages.length > 10000
                  ? nextMessages.slice(-10000)
                  : nextMessages,
            });
            return;
          }
        }

        // Check for duplicate assistant messages by content (within last 2 messages only)
        // This is more conservative to prevent legitimate new messages from being skipped
        if (e.role === "assistant") {
          const recentMessages = state.messages.slice(-2);
          const duplicateFound = recentMessages.some(
            (m) => m.role === "assistant" && m.text === e.text && m.id === e.id,
          );
          if (duplicateFound) {
            console.log(
              "[session.pushEvent] Skipping duplicate assistant message by content and ID",
            );
            return;
          }
        }

        // Add as new message - optimized array operations
        {
          const nextEvents =
            state.events.length > 50000
              ? [...state.events.slice(-49999), e] // Keep last 49,999 + new
              : [...state.events, e];
          // Ensure assistant messages carry model information for UI badges
          let lastUserReason: string | undefined = undefined;
          if (e.role === "assistant") {
            for (let i = state.messages.length - 1; i >= 0; i--) {
              const m = state.messages[i] as any;
              if (m.role === "user" && m.routingReason) {
                lastUserReason = m.routingReason;
                break;
              }
            }
          }
          const newMsg =
            e.role === "assistant"
              ? {
                  ...e,
                  text: sanitizeOutput(
                    (e as any).text,
                    state.streamingModel,
                  ) as string,
                  model: e.model || state.streamingModel,
                  routingReason: (e as any).routingReason || lastUserReason,
                }
              : e;
          const nextMessages =
            state.messages.length > 10000
              ? [...state.messages.slice(-9999), newMsg]
              : [...state.messages, newMsg];

          set({
            events: nextEvents,
            messages: nextMessages,
          });

          // Save session after adding message - only save recent items
          if (state.projectDir) {
            saveSession(
              {
                events: nextEvents,
                messages: nextMessages,
                tools: state.tools,
                toolOrder: state.toolOrder,
                edits: state.edits,
                cost: state.cost,
                threadId: state.codexThreadId,
              },
              state.projectDir,
            );
          }
        }
        return;
      }
      if (e.type === "assistant:delta") {
        const streamId = state.streamingMessageId;
        const messages = [...state.messages];

        let targetIndex = -1;
        if (streamId) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (
              messages[i].role === "assistant" &&
              messages[i].id === streamId
            ) {
              targetIndex = i;
              break;
            }
          }
        }

        if (targetIndex === -1) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant") {
              targetIndex = i;
              break;
            }
          }
        }

        if (
          targetIndex >= 0 &&
          streamId &&
          messages[targetIndex].id !== streamId
        ) {
          targetIndex = -1;
        }

        if (targetIndex >= 0) {
          const lastMsg = messages[targetIndex];
          const updatedMsg = {
            ...lastMsg,
            text: `${lastMsg.text}${sanitizeOutput(e.chunk, state.streamingModel) as string}`.trim(),
            ts: Date.now(),
          };
          messages[targetIndex] = updatedMsg;
          set({
            messages:
              messages.length > 10000 ? messages.slice(-10000) : messages,
          });
        } else {
          let lastUserTs = 0;
          for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i].role === "user") {
              lastUserTs = state.messages[i].ts;
              break;
            }
          }

          const id = streamId || `assistant-${Date.now()}`;
          const msg: MessageEvent = {
            id,
            type: "message",
            role: "assistant",
            text: sanitizeOutput(e.chunk, state.streamingModel) as string,
            model: state.streamingModel,
            routingReason: undefined,
            ts: Math.max(Date.now(), lastUserTs) + 1,
          };

          const nextMessages = [...state.messages, msg];
          set({
            messages:
              nextMessages.length > 10000
                ? nextMessages.slice(-10000)
                : nextMessages,
          });
        }
        return;
      }
      if (e.type === "thinking") {
        const eventId = (e as any).id ? String((e as any).id) : e.id;
        const parentId = e.parentId ? String(e.parentId) : eventId;
        const eventsCopy = [...state.events];

        const chunkText = e.text || "";
        const fullText =
          e.fullText && e.fullText.length ? e.fullText : chunkText;

        // Extract bold headers from reasoning content (like CLI does)
        const extractFirstBold = (content: string): string | null => {
          const match = content.match(/\*\*(.*?)\*\*/);
          return match ? match[1].trim() : null;
        };

        const currentHeader =
          extractFirstBold(chunkText) || extractFirstBold(fullText);

        // Find the most recent thinking block (regardless of parentId for simpler logic)
        let foundIndex = -1;
        let mostRecentThinking = null;
        for (let i = eventsCopy.length - 1; i >= 0; i--) {
          const existing = eventsCopy[i] as any;
          if (existing && existing.type === "thinking") {
            mostRecentThinking = existing;
            foundIndex = i;
            break;
          }
        }

        // If we found an existing thinking block, check if we should create a new one
        if (foundIndex >= 0 && mostRecentThinking) {
          const previousHeader = extractFirstBold(
            mostRecentThinking.fullText || mostRecentThinking.text || "",
          );
          const shouldCreateNewBlock =
            mostRecentThinking.done === true || // Previous block marked as completed
            (currentHeader && currentHeader !== previousHeader); // Different header = new thinking section

          if (shouldCreateNewBlock) {
            // Mark the previous thinking block as completed
            if (!mostRecentThinking.done) {
              eventsCopy[foundIndex] = {
                ...mostRecentThinking,
                done: true,
              };
            }

            // Create a NEW thinking block
            const newThinkingId = `thinking_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            console.log(
              "[session.pushEvent] Creating new thinking block:",
              newThinkingId,
              "because:",
              mostRecentThinking.done
                ? "previous completed"
                : "section break detected",
            );
            eventsCopy.push({
              id: newThinkingId,
              parentId: eventId, // Use current event id as parent for new block
              type: "thinking" as const,
              text: chunkText,
              fullText,
              done: !!e.done,
              ts: e.ts ?? Date.now(),
              sequence: e.sequence,
            });
          } else {
            // Update the existing incomplete thinking block
            eventsCopy[foundIndex] = {
              ...mostRecentThinking,
              id: mostRecentThinking.id, // Keep original id
              parentId: mostRecentThinking.parentId,
              text: chunkText,
              fullText,
              done: e.done ?? mostRecentThinking.done ?? false,
              ts: Math.max(mostRecentThinking.ts ?? 0, e.ts ?? Date.now()),
              sequence: e.sequence ?? mostRecentThinking.sequence,
            };
          }
        } else {
          // No existing thinking block found, create a new one
          eventsCopy.push({
            id: eventId,
            parentId,
            type: "thinking" as const,
            text: chunkText,
            fullText,
            done: !!e.done,
            ts: e.ts ?? Date.now(),
            sequence: e.sequence,
          });
        }

        const trimmed =
          eventsCopy.length > 50000 ? eventsCopy.slice(-50000) : eventsCopy;
        set({
          events: trimmed,
          thinking: { text: fullText, done: !!e.done },
        });
        return;
      }
      if (e.type === "tool:start") {
        // Check for duplicate tool:start events
        const existingTool = state.tools[e.id];
        if (existingTool) {
          console.log(
            "[session.pushEvent] Skipping duplicate tool:start event for",
            e.id,
          );
          return;
        }

        const run: ToolRun = {
          id: e.id,
          tool: e.tool,
          args: e.args,
          output: "",
          done: false,
          agent: (e as any).agent || (e as any).model || get().streamingModel,
          startedAt: e.ts ?? Date.now(),
        };
        const nextEvents = [...state.events, e];
        const nextTools = { ...state.tools, [e.id]: run };
        const nextOrder = state.toolOrder.includes(e.id)
          ? state.toolOrder
          : [...state.toolOrder, e.id];
        // Fire a permission request if none has been made/decided yet for this session/project
        let pendingPerm = state.permissions.pending;
        const hasDecision =
          state.permissions.decisions && state.permissions.decisions.length > 0;
        let eventsWithPerm = nextEvents;
        if (!pendingPerm && !hasDecision && !state.autoAccept) {
          const req: PermissionRequestEvent = {
            id: `perm_${Date.now()}`,
            type: "permission:request",
            tools: [e.tool],
            scope: "session",
            ts: Date.now(),
          };
          eventsWithPerm = [...nextEvents, req];
          set({ permissions: { ...state.permissions, pending: req } });
        }
        set({
          events:
            eventsWithPerm.length > 50000
              ? eventsWithPerm.slice(-50000)
              : eventsWithPerm,
          tools: nextTools,
          toolOrder: nextOrder,
        });
        // Opportunistic checkpoint for Claude (which doesn't emit checkpoint events):
        // If a write/edit tool declares a file path, capture a one-file snapshot before modification.
        Promise.resolve().then(async () => {
          try {
            const tool = String(e.tool || "").toLowerCase();
            const args = (e as any).args || {};
            const filePath =
              args.path || args.file_path || args.file || args.filename;
            const isWrite = tool === "write";
            const isEdit = tool === "edit";
            const isReplace = tool === "replace";
            const isBash = tool === "bash";
            const destructiveBash =
              isBash &&
              typeof (args.command || args.raw) === "string" &&
              /\b(rm|mv|cp|git\s+(reset|revert|clean)|npm\s+(install|update|uninstall)|yarn\s+(add|remove|upgrade))\b/.test(
                args.command || args.raw,
              );
            if (
              (isWrite || isEdit || isReplace) &&
              filePath &&
              (window as any).__TAURI__
            ) {
              let original = "";
              try {
                original = await readTextFile(filePath);
              } catch {}
              const id = `cp_${Date.now()}`;
              await invoke("save_checkpoint_files", {
                sessionId: state.sessionId,
                checkpointId: id,
                files: [
                  {
                    path: filePath,
                    original_content: original,
                    current_content: original,
                  },
                ],
                trigger: `${tool}:${filePath}`,
              });
              const existing = get().checkpoints || [];
              const rec = {
                id,
                ts: Date.now(),
                trigger: `${tool}:${filePath}`,
                fileCount: 1,
              };
              set((prev) => {
                const nextTurns = prev.turns.length
                  ? (() => {
                      const updated = [...prev.turns];
                      const lastIndex = updated.length - 1;
                      if (lastIndex >= 0 && !updated[lastIndex].checkpointId) {
                        updated[lastIndex] = {
                          ...updated[lastIndex],
                          checkpointId: rec.id,
                        };
                      }
                      return updated;
                    })()
                  : prev.turns;
                return {
                  checkpoints: [rec, ...existing].slice(0, 100),
                  pendingCheckpointId: rec.id,
                  turns: nextTurns,
                };
              });
            } else if (destructiveBash && (window as any).__TAURI__) {
              const id = `cp_${Date.now()}`;
              await invoke("save_checkpoint_files", {
                sessionId: state.sessionId,
                checkpointId: id,
                files: [],
                trigger: `bash:${args.command || args.raw}`,
              });
              const existing = get().checkpoints || [];
              const rec = {
                id,
                ts: Date.now(),
                trigger: `bash:${args.command || args.raw}`,
                fileCount: 0,
              };
              set((prev) => {
                const nextTurns = prev.turns.length
                  ? (() => {
                      const updated = [...prev.turns];
                      const lastIndex = updated.length - 1;
                      if (lastIndex >= 0 && !updated[lastIndex].checkpointId) {
                        updated[lastIndex] = {
                          ...updated[lastIndex],
                          checkpointId: rec.id,
                        };
                      }
                      return updated;
                    })()
                  : prev.turns;
                return {
                  checkpoints: [rec, ...existing].slice(0, 100),
                  pendingCheckpointId: rec.id,
                  turns: nextTurns,
                };
              });
            }
          } catch {}
        });
        // Save session with tools
        saveSession(
          {
            events: eventsWithPerm.slice(-50000),
            messages: state.messages.slice(-10000),
            tools: nextTools,
            toolOrder: nextOrder,
            edits: state.edits,
            cost: state.cost,
            threadId: state.codexThreadId,
          },
          state.projectDir,
        );
        return;
      }
      if (e.type === "tool:output") {
        const run = state.tools[e.id];
        if (!run) {
          // Check if this is a duplicate output event for a non-existent tool
          const existingOutputEvents = state.events.filter(
            (ev) => ev.type === "tool:output" && ev.id === e.id,
          );
          if (existingOutputEvents.length > 0) {
            console.log(
              "[session.pushEvent] Skipping duplicate tool:output event for",
              e.id,
            );
            return;
          }
          const nextEvents = [...state.events, e];
          set({
            events:
              nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          });
          return;
        }
        const merged: ToolRun = {
          ...run,
          output: run.output + e.chunk,
          done: !!e.done,
          completedAt: e.done ? (e.ts ?? Date.now()) : run.completedAt,
          exitCode:
            e.done && typeof e.exitCode === "number"
              ? e.exitCode
              : run.exitCode,
        };
        const nextEvents = [...state.events, e];
        const nextTools = { ...state.tools, [e.id]: merged };
        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          tools: nextTools,
        });
        // Save session with updated tools when done
        if (e.done) {
          saveSession(
            {
              events: nextEvents.slice(-50000),
              messages: state.messages.slice(-10000),
              tools: nextTools,
              toolOrder: state.toolOrder,
              edits: state.edits,
              cost: state.cost,
              threadId: state.codexThreadId,
            },
            state.projectDir,
          );
        }
        return;
      }
      if (e.type === "edit:proposed") {
        const edit: ProposedEdit = {
          id: e.id,
          file: e.file,
          before: e.before,
          after: e.after,
          status: "proposed",
        };
        const nextEvents = [...state.events, e];
        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          edits: [...state.edits, edit],
          selectedEditId: e.id,
          ui: { ...state.ui, workbenchTab: "diffs" },
        });
        return;
      }
      if (e.type === "edit:applied" || e.type === "edit:rejected") {
        const status = e.type === "edit:applied" ? "applied" : "rejected";
        const nextEvents = [...state.events, e];
        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          edits: state.edits.map((ed) =>
            ed.id === e.id ? { ...ed, status } : ed,
          ),
        });
        return;
      }
      if (e.type === "permission:request") {
        const nextEvents = [...state.events, e];
        if (state.autoAccept) {
          const scope = e.scope || "session";
          const decision: PermissionDecisionEvent = {
            id: e.id,
            type: "permission:decision",
            allow: true,
            scope,
            ts: Date.now(),
          };
          const withDecision = [...nextEvents, decision];
          const trimmed =
            withDecision.length > 50000
              ? withDecision.slice(-50000)
              : withDecision;
          set({
            events: trimmed,
            permissions: {
              pending: undefined,
              decisions: [...(state.permissions.decisions || []), decision],
            },
          });
          if (typeof window !== "undefined" && (window as any).__TAURI__) {
            invoke("resolve_codex_permission", {
              sessionId: state.sessionId,
              requestId: e.id,
              allow: true,
              scope,
            }).catch((err) => {
              console.error("Failed to auto-resolve Codex permission:", err);
            });
          }
        } else {
          set({
            events:
              nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
            permissions: { ...state.permissions, pending: e },
          });
        }
        return;
      }
      if (e.type === "permission:decision") {
        const nextEvents = [...state.events, e];
        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          permissions: {
            pending: undefined,
            decisions: [...state.permissions.decisions, e],
          },
        });
        return;
      }
      if (e.type === "cost:update") {
        // Update the last assistant message with token counts
        const messages = [...state.messages];
        let lastAssistantIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role === "assistant") {
            lastAssistantIndex = i;
            break;
          }
        }
        if (lastAssistantIndex >= 0) {
          messages[lastAssistantIndex] = {
            ...messages[lastAssistantIndex],
            tokens: { input: e.tokensIn, output: e.tokensOut },
          };
        }
        const nextEvents = [...state.events, e];
        const newCost = {
          usd: e.usd,
          tokensIn: e.tokensIn,
          tokensOut: e.tokensOut,
        };
        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          messages: messages.length > 10000 ? messages.slice(-10000) : messages,
          cost: newCost,
        });
        // Save session after cost update
        saveSession(
          {
            events: nextEvents.slice(-50000),
            messages: messages.slice(-10000),
            tools: state.tools,
            toolOrder: state.toolOrder,
            edits: state.edits,
            cost: newCost,
            threadId: state.codexThreadId,
          },
          state.projectDir,
        );
        return;
      }
      if (e.type === "telemetry:tokens") {
        // Update last assistant message tokens without touching USD cost
        const messages = [...state.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role === "assistant") {
            messages[i] = {
              ...m,
              tokens: {
                input: (e as any).tokensIn || 0,
                output: (e as any).tokensOut || 0,
              },
            };
            break;
          }
        }
        const nextEvents = [...state.events, e];
        const previousUsage = state.contextUsage;
        const contextUsage: ContextUsageState | undefined = (() => {
          const hasContextData =
            e.contextWindow !== undefined ||
            e.contextEffective !== undefined ||
            e.contextUsedTokens !== undefined ||
            e.contextRemainingTokens !== undefined ||
            e.contextUsedPct !== undefined ||
            e.contextRemainingPct !== undefined ||
            e.tokenUsage !== undefined ||
            e.rateLimits !== undefined;

          if (!hasContextData) {
            return previousUsage;
          }

          return {
            window: e.contextWindow ?? previousUsage?.window,
            effective: e.contextEffective ?? previousUsage?.effective,
            usedTokens: e.contextUsedTokens ?? previousUsage?.usedTokens,
            remainingTokens:
              e.contextRemainingTokens ?? previousUsage?.remainingTokens,
            usedPct: e.contextUsedPct ?? previousUsage?.usedPct,
            remainingPct: e.contextRemainingPct ?? previousUsage?.remainingPct,
            tokenUsage: e.tokenUsage ?? previousUsage?.tokenUsage,
            rateLimits: e.rateLimits ?? previousUsage?.rateLimits,
          };
        })();

        set({
          events:
            nextEvents.length > 50000 ? nextEvents.slice(-50000) : nextEvents,
          messages: messages.length > 10000 ? messages.slice(-10000) : messages,
          contextUsage,
        });
        return;
      }
    },

    setProjectDir: (dir) => {
      const currentState = get();
      const currentDir = currentState.projectDir;

      set((state) => ({
        projectDir: dir,
        sessionMeta: {
          ...state.sessionMeta,
          [state.sessionId]: {
            ...(state.sessionMeta[state.sessionId] ?? {
              id: state.sessionId,
              name: deriveSessionName(state.sessionMeta, dir),
              createdAt: Date.now(),
            }),
            projectDir: dir,
            codexThreadId: state.codexThreadId,
          },
        },
      }));

      if (currentDir !== dir) {
        const state = get();
        if (state.isStreaming) {
          set({ pendingProjectDir: dir });
          return;
        }

        useEditor.getState().reset();

        set({
          events: [],
          messages: [],
          tools: {},
          toolOrder: [],
          edits: [],
          thinking: undefined,
          cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
          isStreaming: false,
          streamingStartTime: undefined,
          streamingModel: undefined,
          codexThreadId: undefined,
        });

        if (dir) {
          Promise.resolve().then(() => {
            try {
              get().loadPersistedSession(dir);
            } catch (err) {
              console.warn(
                "[session.setProjectDir] Failed to load persisted session",
                err,
              );
            }
          });
        } else {
          useEditor.getState().reset();
          set({ codexThreadId: undefined });
          set((state) => ({
            sessionMeta: {
              ...state.sessionMeta,
              [state.sessionId]: {
                ...(state.sessionMeta[state.sessionId] ?? {
                  id: state.sessionId,
                  name: deriveSessionName(state.sessionMeta, state.projectDir),
                  projectDir: undefined,
                  createdAt: Date.now(),
                }),
                codexThreadId: undefined,
                projectDir: undefined,
              },
            },
          }));
        }
      }
    },

    setAutoAccept: (v) => set({ autoAccept: v }),

    setBrowserSelection: (selection) =>
      set(() => ({
        browserSelection: {
          ...selection,
          includeInNextMessage: selection.includeInNextMessage ?? true,
        },
      })),

    clearBrowserSelection: () => set({ browserSelection: undefined }),

    markBrowserSelectionUsed: () =>
      set((state) =>
        state.browserSelection
          ? {
              browserSelection: {
                ...state.browserSelection,
                includeInNextMessage: false,
              },
            }
          : {},
      ),

    setCodexSelection: (selection) =>
      set((state) => ({
        codexSelection: {
          modelId: selection.modelId ?? state.codexSelection.modelId,
          modeId: selection.modeId ?? state.codexSelection.modeId,
        },
      })),

    setCodexThreadId: (threadId) => {
      set((state) => {
        const existing = state.sessionMeta[state.sessionId];
        const meta = existing ?? {
          id: state.sessionId,
          name: deriveSessionName(state.sessionMeta, state.projectDir),
          projectDir: state.projectDir,
          createdAt: Date.now(),
        };

        const updatedMeta = {
          ...state.sessionMeta,
          [state.sessionId]: {
            ...meta,
            codexThreadId: threadId,
          },
        };

        if (state.projectDir) {
          saveSession({ threadId }, state.projectDir);
        }

        return {
          codexThreadId: threadId,
          sessionMeta: updatedMeta,
        };
      });

      const updatedState = get();
      sessionSnapshots.set(
        updatedState.sessionId,
        captureSessionSnapshot(updatedState),
      );
    },

    acceptEdit: (id) => {
      const now = Date.now();
      get().pushEvent({ id, type: "edit:applied", ts: now });
    },

    rejectEdit: (id) => {
      const now = Date.now();
      get().pushEvent({ id, type: "edit:rejected", ts: now });
    },

    selectEdit: (id) => set({ selectedEditId: id }),

    resolvePermission: (allow, scope) => {
      const pending = get().permissions.pending;
      if (!pending) return;
      get().pushEvent({
        id: pending.id,
        type: "permission:decision",
        allow,
        scope,
        ts: Date.now(),
      });
      if (typeof window !== "undefined" && (window as any).__TAURI__) {
        const sessionId = get().sessionId;
        invoke("resolve_codex_permission", {
          sessionId: sessionId,
          requestId: pending.id,
          allow,
          scope,
        }).catch((err) =>
          console.error("Failed to resolve Codex permission:", err),
        );
      }
    },

    setWorkbenchTab: (tab) =>
      set((s) => ({ ui: { ...s.ui, workbenchTab: tab } })),
    setWorkspaceView: (view) =>
      set((s) => ({ ui: { ...s.ui, workspaceView: view } })),

    setShowTerminal: (show) => set({ showTerminal: show }),

    setStreaming: (streaming, model, messageId) => {
      const current = get();
      const now = Date.now();
      if (streaming) {
        const startTime = current.isStreaming
          ? (current.streamingStartTime ?? now)
          : now;
        if (import.meta.env.DEV) {
          console.log("[session.setStreaming] enabling", {
            model,
            messageId,
            startTime,
          });
        }
        set({
          isStreaming: true,
          streamingStartTime: startTime,
          streamingModel: model,
          streamingMessageId: messageId || current.streamingMessageId,
        });
      } else {
        if (import.meta.env.DEV) {
          console.log("[session.setStreaming] disabling");
        }
        set({
          isStreaming: false,
          streamingStartTime: undefined,
          streamingModel: undefined,
          streamingMessageId: undefined,
        });
      }
      sessionSnapshots.set(current.sessionId, captureSessionSnapshot(get()));
    },

    clearConversation: () => {
      const state = get();

      // Stop any streaming first
      set((state) => {
        const snapshot = captureSessionSnapshot({
          ...state,
          isStreaming: false,
          streamingStartTime: undefined,
          streamingModel: undefined,
          streamingMessageId: undefined,
        });
        sessionSnapshots.set(state.sessionId, snapshot);
        return {
          isStreaming: false,
          streamingStartTime: undefined,
          streamingModel: undefined,
          streamingMessageId: undefined,
        };
      });
      get().setCodexThreadId(undefined);

      // Stop Codex backend and restart it
      if (typeof window !== "undefined" && (window as any).__TAURI__) {
        const projectDir = state.projectDir || "";

        // Stop Codex completely
        // Use atomic restart for better reliability
        if (projectDir) {
          console.log(
            "[Session] restart_codex when clearing project",
            projectDir,
          );
          invoke("restart_codex", {
            sessionId: state.sessionId,
            projectDir: projectDir,
          })
            .then(() => {
              // Clear all state after restart
              set({
                events: [],
                messages: [],
                tools: {},
                toolOrder: [],
                edits: [],
                thinking: undefined,
                cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
                contextUsage: undefined,
                checkpoints: [],
                turns: [],
                currentTurnIndex: -1,
                pendingCheckpointId: undefined,
                isStreaming: false,
                streamingStartTime: undefined,
                streamingModel: undefined,
                streamingMessageId: undefined,
                browserSelection: undefined,
                codexThreadId: undefined,
              });

              // Clear persisted session
              clearSession(projectDir);
            })
            .catch((err) => {
              console.error("Failed to restart Codex:", err);
            });
        } else {
          invoke("stop_codex", { sessionId: state.sessionId })
            .then(() => {
              set({
                events: [],
                messages: [],
                tools: {},
                toolOrder: [],
                edits: [],
                thinking: undefined,
                cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
                contextUsage: undefined,
                checkpoints: [],
                turns: [],
                currentTurnIndex: -1,
                pendingCheckpointId: undefined,
                isStreaming: false,
                streamingStartTime: undefined,
                streamingModel: undefined,
                streamingMessageId: undefined,
                browserSelection: undefined,
                codexThreadId: undefined,
              });
              clearSession(projectDir);
            })
            .catch((err) => {
              console.error("Failed to stop Codex:", err);
            });
        }
      } else {
        // No Tauri, just clear state
        set({
          events: [],
          messages: [],
          tools: {},
          toolOrder: [],
          edits: [],
          thinking: undefined,
          cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
          contextUsage: undefined,
          checkpoints: [],
          turns: [],
          currentTurnIndex: -1,
          pendingCheckpointId: undefined,
          isStreaming: false,
          streamingStartTime: undefined,
          streamingModel: undefined,
          streamingMessageId: undefined,
          browserSelection: undefined,
        });
        clearSession(state.projectDir);
      }
    },

    loadPersistedSession: (projectPath) => {
      const state = get();
      const targetProject = projectPath ?? state.projectDir;
      const persisted = loadSession(targetProject);

      if (import.meta.env.DEV) {
        try {
          console.log("[session.loadPersistedSession] target", targetProject, {
            messageCount: persisted?.messages?.length,
            eventCount: persisted?.events?.length,
            toolCount: persisted?.tools
              ? Object.keys(persisted.tools).length
              : 0,
            hasThreadId: Boolean(persisted?.threadId),
          });
          if (
            persisted?.messages &&
            persisted.messages.length &&
            typeof persisted.messages[0] === "object"
          ) {
            console.log(
              "[session.loadPersistedSession] sample message",
              persisted.messages[0],
            );
          }
        } catch (err) {
          console.warn(
            "[session.loadPersistedSession] debug logging failed",
            err,
          );
        }
      }

      type RehydratedMessageCandidate = {
        preferredId?: string;
        role: Role;
        text: string;
        content?: MessageContent[];
        model?: string;
        routingReason?: string;
        tokens?: { input: number; output: number };
        ts: number;
      };

      const rawEvents = Array.isArray(persisted.events)
        ? [...persisted.events]
        : [];
      const rawMessages = Array.isArray(persisted.messages)
        ? [...persisted.messages]
        : [];

      let timestampCursor = 0;
      const registerTimestamp = (raw: any): number => {
        if (typeof raw === "number" && Number.isFinite(raw)) {
          timestampCursor = Math.max(timestampCursor, raw);
          return raw;
        }
        timestampCursor += 1;
        return timestampCursor;
      };

      rawEvents.forEach((event) => {
        if (
          event &&
          typeof event === "object" &&
          typeof (event as any).ts === "number"
        ) {
          timestampCursor = Math.max(
            timestampCursor,
            (event as any).ts as number,
          );
        }
      });
      rawMessages.forEach((message) => {
        if (
          message &&
          typeof message === "object" &&
          typeof (message as any).ts === "number"
        ) {
          timestampCursor = Math.max(
            timestampCursor,
            (message as any).ts as number,
          );
        }
      });

      const extractText = (value: any): string => {
        if (typeof value?.text === "string") {
          return value.text;
        }
        if (Array.isArray(value?.content)) {
          const textParts = value.content
            .filter(
              (part: any) =>
                part && part.type === "text" && typeof part.text === "string",
            )
            .map((part: any) => part.text);
          if (textParts.length) {
            return textParts.join("\n\n");
          }
        }
        return "";
      };

      const normaliseTokens = (
        value: any,
      ): { input: number; output: number } | undefined => {
        if (!value || typeof value !== "object") return undefined;
        const input = Number((value as any).input);
        const output = Number((value as any).output);
        if (!Number.isFinite(input) && !Number.isFinite(output)) {
          return undefined;
        }
        return {
          input: Number.isFinite(input) ? input : 0,
          output: Number.isFinite(output) ? output : 0,
        };
      };

      const toCandidate = (
        source: any,
        fallbackRole: Role,
      ): RehydratedMessageCandidate => {
        const role: Role =
          source?.role === "assistant"
            ? "assistant"
            : source?.role === "user"
              ? "user"
              : fallbackRole;
        const preferredId =
          typeof source?.id === "string" && source.id.trim().length
            ? source.id.trim()
            : undefined;
        const ts = registerTimestamp(source?.ts);
        const text = extractText(source);
        const content = Array.isArray(source?.content)
          ? source.content
          : undefined;
        const model =
          typeof source?.model === "string" ? source.model : undefined;
        const routingReason =
          typeof source?.routingReason === "string"
            ? source.routingReason
            : undefined;
        const tokens = normaliseTokens(source?.tokens);
        return {
          preferredId,
          role,
          text,
          content,
          model,
          routingReason,
          tokens,
          ts,
        };
      };

      const mergeCandidates = (
        existing: RehydratedMessageCandidate,
        incoming: RehydratedMessageCandidate,
      ): RehydratedMessageCandidate => {
        const text =
          incoming.text && incoming.text.length >= existing.text.length
            ? incoming.text
            : existing.text;
        const content = incoming.content?.length
          ? incoming.content
          : existing.content;
        const model = incoming.model ?? existing.model;
        const routingReason = incoming.routingReason ?? existing.routingReason;
        const tokens = incoming.tokens ?? existing.tokens;
        const ts = Math.max(existing.ts, incoming.ts);
        return {
          preferredId: incoming.preferredId ?? existing.preferredId,
          role: incoming.role || existing.role,
          text,
          content,
          model,
          routingReason,
          tokens,
          ts,
        };
      };

      type CandidateBucket = {
        candidate: RehydratedMessageCandidate;
        events: any[];
      };

      const candidateBuckets = new Map<string, CandidateBucket>();
      let fallbackSeed = 0;

      const upsertCandidate = (
        candidate: RehydratedMessageCandidate,
        eventRef?: any,
      ) => {
        if (candidate.preferredId) {
          const key = `id:${candidate.preferredId}`;
          const existing = candidateBuckets.get(key);
          if (existing) {
            existing.candidate = mergeCandidates(existing.candidate, candidate);
            if (eventRef) {
              existing.events.push(eventRef);
            }
          } else {
            candidateBuckets.set(key, {
              candidate,
              events: eventRef ? [eventRef] : [],
            });
          }
          return;
        }

        let matchedKey: string | undefined;
        for (const [key, bucket] of candidateBuckets.entries()) {
          if (bucket.candidate.preferredId) continue;
          if (bucket.candidate.role !== candidate.role) continue;
          const tsClose = Math.abs(bucket.candidate.ts - candidate.ts) <= 2;
          const textMatches =
            bucket.candidate.text === candidate.text ||
            (bucket.candidate.text &&
              candidate.text &&
              bucket.candidate.text.includes(candidate.text)) ||
            (candidate.text &&
              bucket.candidate.text &&
              candidate.text.includes(bucket.candidate.text));
          if (tsClose && textMatches) {
            matchedKey = key;
            break;
          }
        }

        if (matchedKey) {
          const bucket = candidateBuckets.get(matchedKey)!;
          bucket.candidate = mergeCandidates(bucket.candidate, candidate);
          if (eventRef) {
            bucket.events.push(eventRef);
          }
        } else {
          const key = `fallback:${candidate.role}:${fallbackSeed++}`;
          candidateBuckets.set(key, {
            candidate,
            events: eventRef ? [eventRef] : [],
          });
        }
      };

      const normalisedEvents = rawEvents.map((event) => {
        if (!event || typeof event !== "object") {
          return event as SessionEvent;
        }
        const normalised: any = { ...event };
        normalised.ts = registerTimestamp(normalised.ts);
        const type = normalised.type;
        const isMessageLike =
          type === "message" ||
          type === "assistant:complete" ||
          type === "agent_message" ||
          type === "assistant_message";

        if (isMessageLike) {
          const fallbackRole: Role =
            normalised.role === "user" ? "user" : "assistant";
          const candidate = toCandidate(normalised, fallbackRole);
          // Ignore empty assistant completions that never produced text
          if (candidate.text?.trim().length || candidate.content?.length) {
            upsertCandidate(candidate, normalised);
          }
        }
        return normalised as SessionEvent;
      });

      rawMessages.forEach((msg) => {
        const candidate = toCandidate(
          msg,
          msg?.role === "assistant" ? "assistant" : "user",
        );
        upsertCandidate(candidate);
      });

      const usedIds = new Set<string>();
      let generatedIdCounter = 0;
      const assignId = (preferredId: string | undefined, role: Role) => {
        if (
          preferredId &&
          preferredId.length > 0 &&
          !usedIds.has(preferredId)
        ) {
          usedIds.add(preferredId);
          return preferredId;
        }
        let base =
          preferredId && preferredId.length > 0
            ? preferredId
            : `rehydrated_${role}`;
        let candidateId = base;
        while (usedIds.has(candidateId)) {
          generatedIdCounter += 1;
          candidateId = `${base}_${generatedIdCounter}`;
        }
        usedIds.add(candidateId);
        return candidateId;
      };

      const normalisedMessages: MessageEvent[] = [];
      candidateBuckets.forEach(({ candidate, events }) => {
        const finalId = assignId(candidate.preferredId, candidate.role);
        const finalTs = events.reduce((max, ev) => {
          const value = typeof ev?.ts === "number" ? ev.ts : candidate.ts;
          return Math.max(max, value);
        }, candidate.ts);
        const message: MessageEvent = {
          id: finalId,
          type: "message",
          role: candidate.role,
          text: candidate.text,
          content: candidate.content,
          model: candidate.model,
          routingReason: candidate.routingReason,
          tokens: candidate.tokens,
          ts: finalTs,
        };
        normalisedMessages.push(message);
        events.forEach((event) => {
          event.id = finalId;
          event.role = candidate.role;
          event.text = candidate.text;
          event.content = candidate.content;
          event.model = candidate.model;
          event.routingReason = candidate.routingReason;
          event.tokens = candidate.tokens;
          event.ts = finalTs;
        });
      });

      normalisedMessages.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
      normalisedEvents.sort(
        (a, b) => ((a as any)?.ts ?? 0) - ((b as any)?.ts ?? 0),
      );

      const fallbackMessages = (): MessageEvent[] => {
        const results: MessageEvent[] = [];
        rawMessages.forEach((msg, index) => {
          if (!msg || typeof msg !== "object") return;
          const role: Role = msg.role === "assistant" ? "assistant" : "user";
          const id =
            typeof msg.id === "string" && msg.id.trim().length
              ? msg.id
              : `legacy_${role}_${index}`;
          const ts = typeof msg.ts === "number" ? msg.ts : index + 1;
          const text =
            typeof msg.text === "string" && msg.text.length
              ? msg.text
              : extractText(msg);
          if (!text && role === "assistant") return;
          const message: MessageEvent = {
            id,
            type: "message",
            role,
            text,
            ts,
          };
          const content = Array.isArray((msg as any).content)
            ? (msg as any).content
            : undefined;
          if (content) {
            message.content = content;
          }
          const model =
            typeof (msg as any).model === "string"
              ? (msg as any).model
              : undefined;
          if (model) {
            message.model = model;
          }
          const routingReason =
            typeof (msg as any).routingReason === "string"
              ? (msg as any).routingReason
              : undefined;
          if (routingReason) {
            message.routingReason = routingReason;
          }
          const tokens = normaliseTokens((msg as any).tokens);
          if (tokens) {
            message.tokens = tokens;
          }
          results.push(message);
        });
        return results;
      };

      const finalMessages =
        normalisedMessages.length > 0 ? normalisedMessages : fallbackMessages();

      const fallbackEvents = (): SessionEvent[] => {
        const results: SessionEvent[] = [];
        rawEvents.forEach((event) => {
          if (!event || typeof event !== "object") return;
          const ts =
            typeof (event as any).ts === "number"
              ? (event as any).ts
              : Date.now();
          results.push({ ...(event as any), ts } as SessionEvent);
        });
        return results;
      };

      const finalEvents =
        normalisedEvents.length > 0 ? normalisedEvents : fallbackEvents();

      const normalisedTools =
        persisted.tools &&
        typeof persisted.tools === "object" &&
        !Array.isArray(persisted.tools)
          ? Object.entries(persisted.tools).reduce<Record<string, ToolRun>>(
              (acc, [id, tool]) => {
                if (tool && typeof tool === "object") {
                  const run = tool as any;
                  acc[id] = {
                    id,
                    tool: run.tool,
                    args: run.args || {},
                    output: typeof run.output === "string" ? run.output : "",
                    done: !!run.done,
                    agent: run.agent,
                    startedAt:
                      typeof run.startedAt === "number"
                        ? run.startedAt
                        : undefined,
                    completedAt:
                      typeof run.completedAt === "number"
                        ? run.completedAt
                        : undefined,
                    exitCode:
                      typeof run.exitCode === "number"
                        ? run.exitCode
                        : undefined,
                  };
                }
                return acc;
              },
              {},
            )
          : {};

      const normalisedToolOrder = Array.isArray(persisted.toolOrder)
        ? persisted.toolOrder.filter(
            (id): id is string =>
              typeof id === "string" && id in normalisedTools,
          )
        : Object.keys(normalisedTools);

      const normalisedEdits = Array.isArray(persisted.edits)
        ? persisted.edits
        : [];

      const normalisedCost =
        persisted.cost && typeof persisted.cost === "object"
          ? {
              usd: (() => {
                const value = Number((persisted.cost as any).usd);
                return Number.isFinite(value) ? value : 0;
              })(),
              tokensIn: (() => {
                const value = Number((persisted.cost as any).tokensIn);
                return Number.isFinite(value) ? value : 0;
              })(),
              tokensOut: (() => {
                const value = Number((persisted.cost as any).tokensOut);
                return Number.isFinite(value) ? value : 0;
              })(),
            }
          : { usd: 0, tokensIn: 0, tokensOut: 0 };

      set((current) => {
        const existingMeta = current.sessionMeta[current.sessionId];
        const baseMeta = existingMeta ?? {
          id: current.sessionId,
          name: deriveSessionName(
            current.sessionMeta,
            targetProject ?? current.projectDir,
          ),
          projectDir: targetProject ?? current.projectDir,
          createdAt: Date.now(),
          codexThreadId: undefined,
        };

        const updatedMeta: SessionMeta = {
          ...baseMeta,
          projectDir: targetProject ?? baseMeta.projectDir,
          codexThreadId: persisted.threadId,
        };

        return {
          events: finalEvents,
          messages: finalMessages,
          tools: normalisedTools,
          toolOrder: normalisedToolOrder,
          edits: normalisedEdits,
          cost: normalisedCost,
          checkpoints: [],
          turns: [],
          currentTurnIndex: -1,
          pendingCheckpointId: undefined,
          thinking: undefined,
          permissions: { decisions: [] },
          isStreaming: false,
          streamingStartTime: undefined,
          streamingModel: undefined,
          streamingMessageId: undefined,
          codexThreadId: persisted.threadId,
          sessionMeta: {
            ...current.sessionMeta,
            [current.sessionId]: updatedMeta,
          },
        };
      });

      const updated = get();
      sessionSnapshots.set(updated.sessionId, captureSessionSnapshot(updated));
    },

    clearSession: () => {
      const state = get();

      // Clear all state
      set({
        events: [],
        messages: [],
        tools: {},
        toolOrder: [],
        edits: [],
        thinking: undefined,
        permissions: { decisions: [] },
        cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
        checkpoints: [],
        turns: [],
        currentTurnIndex: -1,
        pendingCheckpointId: undefined,
        autoAccept: false,
        isStreaming: false,
        streamingStartTime: undefined,
        streamingModel: undefined,
        streamingMessageId: undefined,
        selectedEditId: undefined,
        fileTracker: {
          originalContents: new Map(),
          modifiedFiles: new Set(),
          isTracking: false,
        },
        browserSelection: undefined,
        codexThreadId: undefined,
      });

      useEditor.getState().reset();

      set((state) => ({
        sessionMeta: {
          ...state.sessionMeta,
          [state.sessionId]: {
            ...(state.sessionMeta[state.sessionId] ?? {
              id: state.sessionId,
              name: deriveSessionName(state.sessionMeta, state.projectDir),
              projectDir: state.projectDir,
              createdAt: Date.now(),
            }),
            codexThreadId: undefined,
          },
        },
      }));

      // Clear persisted session
      if (state.projectDir) {
        clearSession(state.projectDir);
      }
    },

    restoreTurn: async (turnIndex: number) => {
      const state = get();
      if (turnIndex < 0 || turnIndex >= state.turns.length) return;
      const snapshot = state.turns[turnIndex];
      if (!snapshot?.checkpointId) {
        set({ currentTurnIndex: turnIndex });
        return;
      }
      if (typeof window !== "undefined" && (window as any).__TAURI__) {
        try {
          await invoke("restore_checkpoint", {
            sessionId: state.sessionId,
            checkpointId: snapshot.checkpointId,
          });
        } catch (err) {
          console.error("Failed to restore checkpoint", err);
          return;
        }
      }
      set({ currentTurnIndex: turnIndex });
      sessionSnapshots.set(state.sessionId, captureSessionSnapshot(get()));
    },

    undoTurn: async () => {
      const state = get();
      if (!state.turns.length) return;
      const startIndex =
        state.currentTurnIndex >= 0
          ? state.currentTurnIndex
          : state.turns.length - 1;
      let idx = startIndex - 1;
      while (idx >= 0 && !state.turns[idx]?.checkpointId) {
        idx -= 1;
      }
      if (idx < 0) return;
      await get().restoreTurn(idx);
    },

    redoTurn: async () => {
      const state = get();
      if (!state.turns.length) return;
      let idx = state.currentTurnIndex + 1;
      while (idx < state.turns.length && !state.turns[idx]?.checkpointId) {
        idx += 1;
      }
      if (idx >= state.turns.length) return;
      await get().restoreTurn(idx);
    },
  } as SessionState;
});

// Make session store globally accessible
export const useSessionStore = useSession;
if (typeof window !== "undefined") {
  (window as any).useSession = useSession;
}

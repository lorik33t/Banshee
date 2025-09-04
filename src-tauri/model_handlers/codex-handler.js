#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

console.error('[Codex Handler] Starting Codex streaming handler');

// Find the codex CLI executable (cross-platform, no user-specific paths)
function findCodexCommand() {
  // 1) Explicit override via env
  if (process.env.CODEX_BINARY_PATH) return process.env.CODEX_BINARY_PATH;
  // 2) In PATH
  try { execSync('which codex', { stdio: 'ignore' }); return 'codex'; } catch {}
  // 3) Common install locations
  const candidates = [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    `${process.env.HOME || ''}/.local/bin/codex`,
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  // 4) Repos-based builds if present
  const repos = process.env.BANSHEE_REPOS_DIR || path.join(process.cwd(), 'repos');
  const buildCandidate = path.join(repos, 'codex', 'target', 'release', 'codex');
  try { if (fs.existsSync(buildCandidate)) return buildCandidate; } catch {}
  // 5) Workspace-local binary fallback
  const localCandidate = path.join(process.cwd(), 'codex');
  try { if (fs.existsSync(localCandidate)) return localCandidate; } catch {}
  console.error('[Codex Handler] Codex CLI not found. Please install it or set CODEX_BINARY_PATH.');
  process.exit(1);
}

let codexPath = findCodexCommand();

// Checkpoint helpers (top-level so they're always available)
const DESTRUCTIVE_BASH_PATTERNS = [
  /\brm\b\s+/, /\bmv\b\s+/, /\bcp\b\s+/, />>|\s>\s/, /\bgit\b\s+(reset|revert|clean)\b/, /\bnpm\b\s+(install|update|uninstall)\b/, /\byarn\b\s+(add|remove|upgrade)\b/
];
const guessPathsFromCmd = (cmd) => {
  try {
    const tokens = (cmd || '').split(/\s+/).filter(Boolean);
    const candidates = tokens.filter(t => !t.startsWith('-') && !/[;&|]/.test(t) && !/^[A-Z_]+=.*/.test(t) && t !== 'sudo' && t !== 'bash' && t !== 'sh');
    // Heuristic: looks like a path if it contains '/' or a '.' and not purely an option
    const paths = candidates.filter(t => /\//.test(t) || /\./.test(t));
    return Array.from(new Set(paths));
  } catch { return []; }
};
const emitCheckpoint = (trigger, paths) => {
  let fileSnapshots;
  if (Array.isArray(paths) && paths.length) {
    fileSnapshots = paths.map((p) => {
      try {
        const full = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
        const exists = fs.existsSync(full);
        const originalContent = exists ? fs.readFileSync(full, 'utf8') : '';
        return { path: p, originalContent };
      } catch { return { path: p }; }
    });
  }
  process.stdout.write(JSON.stringify({ type: 'checkpoint:create', trigger, fileSnapshots, ts: Date.now() }) + '\n');
};

// Persistent queue: accept multiple prompts over stdin lines
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const queue = [];
let running = false;

const runNext = () => {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  const input = next;
  console.error('[Codex Handler] Starting Codex exec...');
  
  // Load environment variables from .env if exists (search common locations)
  let extraEnv = {};
  const envCandidates = [
    process.env.CODEX_ENV_FILE,
    path.join(process.cwd(), 'repos', 'codex', '.env'),
    path.join(process.cwd(), '.env'),
    (process.env.BANSHEE_REPOS_DIR ? path.join(process.env.BANSHEE_REPOS_DIR, 'codex', '.env') : null),
    path.join(os.homedir(), '.banshee', 'codex', '.env'),
  ].filter(Boolean);
  for (const p of envCandidates) {
    try {
      if (fs.existsSync(p)) {
        const envContent = fs.readFileSync(p, 'utf8');
        envContent.split('\n').forEach(line => {
          const [key, value] = line.split('=');
          if (key && value) {
            extraEnv[key.trim()] = value.trim();
          }
        });
        break; // stop at first existing env file
      }
    } catch {}
  }
  
  // Prefer non-interactive exec mode with explicit autonomy/sandbox
  // We pass the prompt as an argument so Codex runs headless and streams output
  // Flags:
  //  -a/--ask-for-approval never: avoid interactive approvals
  //  --sandbox workspace-write: allow writes in workspace only
  //  -m/--model can be set via env or config; we skip here to use defaults
  // Frontend sends JSON: { currentMessage: string }
  let promptArg = input.trim();
  try {
    const parsed = JSON.parse(promptArg);
    if (parsed && typeof parsed.currentMessage === 'string') {
      promptArg = parsed.currentMessage;
    }
  } catch (_) {
    // Not JSON, use raw input
  }
  // codex exec does not support --ask-for-approval; it's non-interactive by design.
  const codexArgs = [
    'exec',
    '--sandbox', 'workspace-write',
    promptArg
  ];
  // Do not emit tool events for Codex; treat it as a first-class agent stream
  const codex = spawn(codexPath, codexArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,  // Include API keys from .env
      NO_COLOR: '1',  // Disable color output for cleaner parsing
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let buffer = '';
  let isStreaming = false;
  let startTs = null;
  let thinkingText = '';
  let inThinking = false;
  let lastOutChar = '';
  // Read per-request preferences (passed from Composer)
  let displayMode = 'clean'; // 'clean' | 'compact' | 'verbose'
  let showReasoningPref = true;
  try {
    const maybe = JSON.parse(input);
    if (maybe && maybe.codexOptions) {
      if (typeof maybe.codexOptions.displayMode === 'string') displayMode = maybe.codexOptions.displayMode;
      if (typeof maybe.codexOptions.showReasoning === 'boolean') showReasoningPref = maybe.codexOptions.showReasoning;
    }
  } catch {}
  // tool capture state
  let activeToolId = null; // used in verbose mode
  const endActiveTool = () => {
    if (activeToolId) {
      process.stdout.write(JSON.stringify({ id: activeToolId, type: 'tool:output', chunk: '', done: true, ts: Date.now() }) + '\n');
      activeToolId = null;
    }
  };
  // compact mode aggregation
  let compactExecCount = 0;
  let compactToolCount = 0;
  let skippingToolBlock = false; // for clean/compact modes
  const messageId = `codex_${Date.now()}`;
  // Strip Codex banners, timestamps, config dump, and echoed instructions
  const sanitizeOutput = (text) => {
    if (!text) return ''
    const lines = text.split(/\r?\n/)
    const filtered = lines.filter((l) => {
      const s = l.trim()
      if (!s) return false
      if (/^\[\d{4}-\d{2}-\d{2}T/.test(s)) return false // [timestamp]
      if (/OpenAI Codex v\d/.test(s)) return false
      if (/^workdir:/i.test(s)) return false
      if (/^model:/i.test(s)) return false
      if (/^provider:/i.test(s)) return false
      if (/^approval:/i.test(s)) return false
      if (/^sandbox:/i.test(s)) return false
      if (/^reasoning(\s|:)/i.test(s)) return false
      if (/^User instructions:/i.test(s)) return false
      if (/^\[No prior messages\]/i.test(s)) return false
      if (/^System:/i.test(s)) return false
      if (/^--- Conversation/i.test(s)) return false
      if (/^(User|Assistant):/i.test(s)) return false
      if (/^thinking$/i.test(s)) return false
      if (/^Crafting a /i.test(s)) return false
      if (/^[-—–]{3,}$/.test(s)) return false
      return true
    })
    return filtered.join('\n')
  }
  
  // Stream stdout data as it arrives (real-time streaming)
  codex.stdout.on('data', (data) => {
    const raw = data.toString();
    // Line-by-line parse with state for thinking vs answer
    const lines = raw.split(/\r?\n/);
    let answerDelta = '';
    for (const line of lines) {
      const trimmed = line.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').trim(); // strip ANSI just in case
      if (!trimmed) continue;
      // Timestamped markers
      if (/^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*thinking\b/i.test(trimmed)) {
        inThinking = true; skippingToolBlock = false; continue;
      }
      if (/^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*codex\b/i.test(trimmed)) {
        inThinking = false; skippingToolBlock = false; continue;
      }
      const tsMatch = trimmed.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*(.*)$/);
      if (tsMatch) {
        const rest = tsMatch[2];
        let m;
        if ((m = rest.match(/^exec\s+(.+?)\s+in\s+(.+)$/i))) {
          const cmd = m[1];
          if (DESTRUCTIVE_BASH_PATTERNS.some(r => r.test(cmd))) {
            const paths = guessPathsFromCmd(cmd);
            emitCheckpoint(`bash: ${cmd}`, paths);
          }
          if (displayMode === 'verbose') {
            endActiveTool();
            activeToolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            process.stdout.write(JSON.stringify({ id: activeToolId, type: 'tool:start', tool: 'bash', args: { command: m[1], cwd: m[2] }, ts: Date.now() }) + '\n');
          } else if (displayMode === 'compact') {
            compactExecCount++; skippingToolBlock = true;
          } else { skippingToolBlock = true; }
          continue;
        }
        if ((m = rest.match(/^tool\s+(.+)$/i))) {
          if (displayMode === 'verbose') {
            endActiveTool();
            activeToolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            process.stdout.write(JSON.stringify({ id: activeToolId, type: 'tool:start', tool: 'mcp', args: { invocation: m[1] }, ts: Date.now() }) + '\n');
          } else if (displayMode === 'compact') {
            compactToolCount++; skippingToolBlock = true;
          } else { skippingToolBlock = true; }
          continue;
        }
        if (/^tokens used:/i.test(rest) || /^task (interrupted|aborted)/i.test(rest) || /^codex session/i.test(rest) || /^model:/i.test(rest)) {
          if (displayMode === 'verbose') endActiveTool();
          skippingToolBlock = false;
          continue;
        }
        if (displayMode === 'verbose') endActiveTool();
        skippingToolBlock = false;
        continue;
      }

      if (inThinking) {
        if (showReasoningPref) {
          thinkingText = thinkingText ? `${thinkingText}\n${trimmed}` : trimmed;
          process.stdout.write(JSON.stringify({ id: messageId, type: 'thinking', text: thinkingText, done: false, ts: Date.now() }) + '\n');
        }
      } else {
        if (displayMode === 'verbose' && activeToolId) {
          process.stdout.write(JSON.stringify({ id: activeToolId, type: 'tool:output', chunk: trimmed + '\n', ts: Date.now() }) + '\n');
          continue;
        }
        if (skippingToolBlock) { continue; }
        // Treat as assistant delta; sanitize to drop any residual headers
        const s = sanitizeOutput(trimmed);
        if (s && s.trim().length > 0) {
          const prevEnd = answerDelta.slice(-1);
          const needsSpace = (
            answerDelta.length > 0 &&
            !/\s$/.test(answerDelta) &&
            prevEnd !== '-' &&
            !/^[.,!?;:)\]\}'’]/.test(s)
          );
          answerDelta += (needsSpace ? ' ' : '') + s;
        }
      }
    }
    let chunk = answerDelta;
    
    // Codex might have initial output we need to skip
    // Start streaming after we see actual response content
    if (!isStreaming) {
      // Look for start of actual response (skip headers/prompts)
      if (chunk.trim() && !chunk.includes('Welcome') && !chunk.includes('Model:')) {
        isStreaming = true;
        startTs = Date.now();
      } else {
        return; // Skip non-content output
      }
    }
    
    if (isStreaming) {
      // Emit parser-friendly delta event
      // Smart prefix spacing across events to avoid word-smash (e.g., 'canI')
      if (chunk && chunk.trim().length > 0) {
        const first = chunk[0];
        const needsSpaceAcrossEvents = (
          lastOutChar &&
          !/\s/.test(lastOutChar) &&
          !/^[.,!?;:)\]\}'’]/.test(first) &&
          /[\p{L}\p{N}]/u.test(first)
        );
        if (needsSpaceAcrossEvents) {
          chunk = ' ' + chunk;
        }

        const textEvent = {
          id: messageId,
          type: 'text',
          content: chunk,
          ts: startTs || Date.now()
        };
        process.stdout.write(JSON.stringify(textEvent) + '\n');
        buffer += chunk;
        // update lastOutChar to last non-space emitted
        for (let i = chunk.length - 1; i >= 0; i--) {
          const ch = chunk[i];
          if (!/\s/.test(ch)) { lastOutChar = ch; break }
        }
      }
    }
  });
  
  // Auto-approve permission prompts by sending 'y' to stdin
  const maybeApprove = (text) => {
    try {
      const t = String(text || '')
      if (/\b(allow|approve|proceed|continue|confirm|permission required)\b/i.test(t) && /\b(y\/n|yes\/no|\[y\/n\]|\[y\/N\])\b/i.test(t)) {
        try { codex.stdin.write('y\n') } catch {}
      }
    } catch {}
  }

  // Handle stderr for debugging and approvals
  codex.stderr.on('data', (data) => {
    const s = data.toString();
    console.error('[Codex stderr]:', s);
    maybeApprove(s);
  });
  
  // When Codex exits, send final result event
  codex.on('close', (code) => {
    console.error('[Codex Handler] Codex exited with code:', code);
    
    if (code !== 0 && !buffer) {
      // Error occurred with no output
      const errorEvent = {
        type: 'error',
        error: {
          message: `Codex process exited with code ${code}`
        }
      };
      process.stdout.write(JSON.stringify(errorEvent) + '\n');
    } else if (buffer) {
      // Send final result event with full output so parser can emit assistant:complete
      const resultEvent = {
        type: 'result',
        id: messageId,
        result: buffer,
        usage: {
          input_tokens: Math.floor(input.length / 4),  // Rough estimate
          output_tokens: Math.floor(buffer.length / 4)
        },
        ts: startTs || Date.now()
      };
      process.stdout.write(JSON.stringify(resultEvent) + '\n');
    }
    // Emit a terminal thinking:done if we captured one
    if (thinkingText && showReasoningPref) {
      process.stdout.write(JSON.stringify({
        id: messageId,
        type: 'thinking',
        text: thinkingText,
        done: true,
        ts: Date.now()
      }) + '\n');
    }
    // Close any dangling verbose tool
    if (activeToolId) {
      process.stdout.write(JSON.stringify({ id: activeToolId, type: 'tool:output', chunk: '', done: true, ts: Date.now() }) + '\n');
      activeToolId = null;
    }
    // Compact summary tile
    if (displayMode === 'compact' && (compactExecCount > 0 || compactToolCount > 0)) {
      const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      process.stdout.write(JSON.stringify({ id, type: 'tool:start', tool: 'mcp', args: { summary: 'codex-tools' }, ts: Date.now() }) + '\n');
      const parts = [];
      if (compactExecCount > 0) parts.push(`${compactExecCount} command${compactExecCount>1?'s':''}`);
      if (compactToolCount > 0) parts.push(`${compactToolCount} tool${compactToolCount>1?'s':''}`);
      process.stdout.write(JSON.stringify({ id, type: 'tool:output', chunk: `Codex ran ${parts.join(' and ')}`, done: true, ts: Date.now() }) + '\n');
    }
    running = false;
    setImmediate(runNext);
    // Ensure any skipped tool block is cleared
  });
  
  // Keep stdin open to auto-approve tool prompts
};

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  queue.push(trimmed);
  runNext();
});

console.error('[Codex Handler] Ready for streaming requests');

// Handle termination signals
process.on('SIGTERM', () => {
  console.error('[Codex Handler] SIGTERM received');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[Codex Handler] SIGINT received');
  process.exit(0);
});

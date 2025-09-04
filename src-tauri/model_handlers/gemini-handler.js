#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

console.error('[Gemini Handler] Starting Gemini streaming handler');

function findGeminiCommand() {
  if (process.env.GEMINI_BINARY_PATH) return { cmd: process.env.GEMINI_BINARY_PATH, args: [] };
  try {
    const bin = execSync('which gemini', { encoding: 'utf8' }).trim();
    if (bin) return { cmd: bin, args: [] };
  } catch {}
  const candidates = [
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    `${process.env.HOME || ''}/.local/bin/gemini`,
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return { cmd: c, args: [] }; } catch {} }
  return { cmd: 'npx', args: ['-y', '@google/gemini-cli'] };
}

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
  console.error('[Gemini Handler] Starting prompt...');
  
  // Load environment variables from config file if exists
  let extraEnv = {};
  const configCandidates = [
    process.env.GEMINI_ENV_FILE || process.env.GEMINI_CONFIG_FILE,
    path.join(process.cwd(), 'repos', '.gemini-config'),
    path.join(process.cwd(), '.gemini-config'),
    (process.env.BANSHEE_REPOS_DIR ? path.join(process.env.BANSHEE_REPOS_DIR, '.gemini-config') : null),
    path.join(os.homedir(), '.banshee', 'gemini', '.env'),
  ].filter(Boolean);
  for (const p of configCandidates) {
    try {
      if (fs.existsSync(p)) {
        const envContent = fs.readFileSync(p, 'utf8');
        envContent.split('\n').forEach(line => {
          const [key, value] = line.split('=');
          if (key && value) {
            extraEnv[key.trim()] = value.trim();
          }
        });
        break; // First existing file wins
      }
    } catch {}
  }
  
  // Try to parse the structured input so we can pass prompt via --prompt (-p)
  let promptArg = '';
  try {
    const parsed = JSON.parse(input);
    // Prefer currentMessage field; else use raw input
    promptArg = parsed.currentMessage || input;
  } catch {
    promptArg = input;
  }

  // Prepare telemetry log path (may not be used if telemetry is disabled)
  const telemetryFile = path.join(os.tmpdir(), `gemini-telemetry-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);

  // Spawn Gemini CLI in non-interactive mode: pass the prompt via --prompt and enable YOLO auto-approve
  const chosen = findGeminiCommand();
  const gemini = spawn(chosen.cmd, [
    ...chosen.args,
    '--yolo',
    '--prompt', promptArg,
    '--no-telemetry',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,  // Include API keys from .env
      NO_COLOR: '1',  // Disable color output for cleaner parsing
      LANG: process.env.LANG || 'en_US.UTF-8',
      TELEMETRY_LOG_FILE: telemetryFile,
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let buffer = '';
  let isStreaming = false;
  let startTs = null;
  let lastOutChar = '';
  let sawOutput = false;
  const sanitizeOutput = (text) => {
    if (!text) return text;
    const normalized = text.replace(/\r/g, '\n').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
    const lines = normalized.split(/\n/);
    const kept = [];
    for (const line of lines) {
      const l = line.trim();
      if (!l) { kept.push(''); continue; }
      if (/^welcome/i.test(l)) continue;
      if (/^model:/i.test(l)) continue;
      kept.push(line);
    }
    return kept.join('\n');
  };
  // Use a stable message id across the whole stream so the frontend can thread deltas
  const messageId = `gemini_${Date.now()}`;
  
  // Auto-approve any permission prompts by sending 'y' to stdin
  const maybeApprove = (text) => {
    try {
      const t = String(text || '')
      if (/\b(allow|approve|proceed|continue|confirm|permission required)\b/i.test(t) && /\b(y\/n|yes\/no|\[y\/n\]|\[y\/N\])\b/i.test(t)) {
        try { gemini.stdin.write('y\n') } catch {}
      }
    } catch {}
  }

  // Immediately close stdin to avoid interactive waits; YOLO approves tool calls
  try { gemini.stdin.end(); } catch {}

  // Stream stdout data as it arrives (real-time streaming)
  gemini.stdout.on('data', (data) => {
    let chunk = sanitizeOutput(data.toString());
    if (chunk && chunk.trim().length > 0) sawOutput = true;
    
    maybeApprove(chunk);
    
    
    // Gemini might have initial output we need to skip
    // Start streaming after we see actual response content
    if (!isStreaming) {
      // Look for start of actual response (skip headers/prompts)
      if (chunk && chunk.trim() && !chunk.includes('Welcome') && !chunk.includes('Model:')) {
        isStreaming = true; startTs = Date.now();
      } else {
        return; // Skip non-content output
      }
    }
    
    if (isStreaming) {
      if (!chunk || chunk.trim().length === 0) return;
      // Smart spacing across events
      const first = chunk[0];
      const needsSpaceAcrossEvents = (
        lastOutChar &&
        !/\s/.test(lastOutChar) &&
        first &&
        !/^[.,!?;:)\]\}'’]/.test(first) &&
        /[\p{L}\p{N}]/u.test(first)
      );
      if (needsSpaceAcrossEvents) chunk = ' ' + chunk;
      // Stream each chunk immediately as assistant message with stable id
      const assistantEvent = {
        type: 'assistant',
        message: {
          id: messageId,
          content: [{
            type: 'text',
            text: chunk
          }]
        },
        ts: startTs || Date.now()
      };
      process.stdout.write(JSON.stringify(assistantEvent) + '\n');
      buffer += chunk;
      for (let i = chunk.length - 1; i >= 0; i--) {
        const ch = chunk[i]; if (!/\s/.test(ch)) { lastOutChar = ch; break; }
      }
    }
  });

  // Best-effort telemetry reader to surface tool calls as UI tool events
  let telemetryTimer = null;
  let lastSize = 0;
  const emittedTools = new Set();
  // Checkpointing helpers
  const FILE_TOOLS = new Set(['write_file', 'replace', 'create_file', 'apply_patch', 'move', 'delete', 'write', 'edit']);
  const DESTRUCTIVE_BASH_PATTERNS = [
    /\brm\b\s+/,
    /\bmv\b\s+/,
    /\bcp\b\s+/,
    />>|\s>\s/,
    /\bgit\b\s+(reset|revert|clean)\b/,
    /\bnpm\b\s+(install|update|uninstall)\b/,
    /\byarn\b\s+(add|remove|upgrade)\b/,
  ];
  const extractPaths = (args) => {
    const keys = ['path', 'file_path', 'file', 'filename', 'target', 'destination', 'to', 'output'];
    const paths = [];
    if (args && typeof args === 'object') {
      for (const k of keys) {
        const v = args[k];
        if (typeof v === 'string') paths.push(v);
      }
    }
    return Array.from(new Set(paths)).filter(Boolean);
  };
  const emitCheckpoint = (trigger, paths) => {
    let fileSnapshots;
    if (Array.isArray(paths) && paths.length > 0) {
      fileSnapshots = paths.map((p) => {
        try {
          const full = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
          const exists = fs.existsSync(full);
          const originalContent = exists ? fs.readFileSync(full, 'utf8') : '';
          return { path: p, originalContent };
        } catch {
          return { path: p };
        }
      });
    }
    process.stdout.write(JSON.stringify({ type: 'checkpoint:create', trigger, fileSnapshots, ts: Date.now() }) + '\n');
  };
  const tryParseTelemetryChunk = (chunk) => {
    if (!chunk) return [];
    // Split concatenated JSON objects by }\n{ boundary
    const objs = chunk
      .split(/}\s*\n\s*{/)
      .map((obj, idx, arr) => {
        if (idx > 0) obj = '{' + obj;
        if (idx < arr.length - 1) obj = obj + '}';
        return obj.trim();
      })
      .filter(Boolean);
    const events = [];
    for (const s of objs) {
      try {
        const j = JSON.parse(s);
        const attrs = j && j.attributes ? j.attributes : null;
        const evName = attrs && attrs['event.name'];
        // Emit per-turn token stats from api_response
        if (evName === 'gemini_cli.api_response') {
          const tokensIn = Number(attrs.input_token_count || attrs.input_tokens || 0);
          const tokensOut = Number(attrs.output_token_count || attrs.output_tokens || 0);
          const cached = Number(attrs.cached_content_token_count || 0);
          const thoughts = Number(attrs.thoughts_token_count || 0);
          const tools = Number(attrs.tool_token_count || 0);
          const latency = Number(attrs.duration_ms || 0);
          process.stdout.write(JSON.stringify({
            type: 'telemetry:tokens',
            tokensIn, tokensOut, cachedTokens: cached, thoughtsTokens: thoughts, toolTokens: tools, latencyMs: latency,
            ts: Date.now()
          }) + '\n');
          // Also emit a cost:update so the existing UI path attaches tokens even if telemetry events are ignored
          process.stdout.write(JSON.stringify({
            type: 'cost:update',
            usd: 0,
            input_tokens: tokensIn,
            output_tokens: tokensOut,
            tokensIn,
            tokensOut,
            ts: Date.now()
          }) + '\n');
        }
        if (evName === 'gemini_cli.tool_call' || evName === 'tool_call' || evName === 'qwen_cli.tool_call') {
          const name = attrs.function_name || attrs.name || 'mcp';
          const args = attrs.function_args || attrs.args || {};
          const key = JSON.stringify({ name, args });
          if (emittedTools.has(key)) continue;
          emittedTools.add(key);
          const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          // Checkpoint before potentially destructive operations
          if (name === 'bash') {
            const cmd = typeof args === 'string' ? args : (args.command || args.raw || '');
            if (typeof cmd === 'string' && DESTRUCTIVE_BASH_PATTERNS.some(r => r.test(cmd))) {
              emitCheckpoint(`bash: ${cmd}`, []);
            }
          } else if (FILE_TOOLS.has(String(name).toLowerCase())) {
            const paths = extractPaths(typeof args === 'string' ? {} : args);
            emitCheckpoint(`${name}`, paths);
          }
          // Emit start
          process.stdout.write(JSON.stringify({
            id,
            type: 'tool:start',
            tool: name,
            args: (typeof args === 'string' ? { raw: args } : args) || {},
            ts: Date.now(),
          }) + '\n');
          // Emit a compact completion line as output
          const summary = `called ${name}${args ? ' with args' : ''}`;
          process.stdout.write(JSON.stringify({
            id,
            type: 'tool:output',
            chunk: summary,
            done: true,
            ts: Date.now(),
          }) + '\n');
        }
      } catch {}
    }
    return events;
  };
  // Poll the telemetry file while the process runs
  telemetryTimer = setInterval(() => {
    try {
      if (!fs.existsSync(telemetryFile)) return;
      const stat = fs.statSync(telemetryFile);
      if (stat.size <= lastSize) return;
      const fd = fs.openSync(telemetryFile, 'r');
      const len = stat.size - lastSize;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, lastSize);
      fs.closeSync(fd);
      lastSize = stat.size;
      tryParseTelemetryChunk(buf.toString('utf8'));
    } catch {}
  }, 300);

  // Handle stderr for debugging
  gemini.stderr.on('data', (data) => {
    const s = data.toString();
    console.error('[Gemini stderr]:', s);
    maybeApprove(s);
    if (s && s.trim().length > 0) sawOutput = true;
  });
  
  // When Gemini exits, send final result event
  gemini.on('close', (code) => {
    console.error('[Gemini Handler] Gemini exited with code:', code);
    
    
    if (code !== 0 && !buffer) {
      // Error occurred with no output
      const errorEvent = {
        type: 'error',
        error: {
          message: `Gemini process exited with code ${code}`
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
    
    if (telemetryTimer) clearInterval(telemetryTimer);
    running = false;
    // Kick next queued request, if any
    setImmediate(runNext);
  });

  // Keep process alive until it exits
  // Note: no hard timeout to avoid killing npx installs or slow starts
};

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  queue.push(trimmed);
  runNext();
});

console.error('[Gemini Handler] Ready for streaming requests');

// Handle termination signals
process.on('SIGTERM', () => {
  console.error('[Gemini Handler] SIGTERM received');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[Gemini Handler] SIGINT received');
  process.exit(0);
});

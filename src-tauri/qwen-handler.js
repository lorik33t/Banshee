#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

console.error('[Qwen Handler] Starting Qwen streaming handler');

function findQwenCommand() {
  // 1) Respect explicit binary override
  if (process.env.QWEN_BINARY_PATH) {
    return { cmd: process.env.QWEN_BINARY_PATH, args: [] };
  }
  // 2) Try 'which qwen'
  try {
    const bin = execSync('which qwen', { encoding: 'utf8' }).trim();
    if (bin) return { cmd: bin, args: [] };
  } catch {}
  // 3) Common Homebrew and user bin locations
  const candidates = [
    '/opt/homebrew/bin/qwen',
    '/usr/local/bin/qwen',
    `${process.env.HOME || ''}/.local/bin/qwen`,
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return { cmd: c, args: [] }; } catch {}
  }
  // 4) Fallback to npx package
  return { cmd: 'npx', args: ['-y', '@qwen-code/qwen-code'] };
}

// Use qwen CLI directly (installed globally via @qwen-code/qwen-code package)
let qwenPath = 'qwen';
let qwenArgs = [];  // No additional args needed, qwen is the command

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
  console.error('[Qwen Handler] Starting prompt...');
  
  // Load environment variables from config file if exists (search common locations)
  let extraEnv = {};
  const configCandidates = [
    process.env.QWEN_ENV_FILE || process.env.QWEN_CONFIG_FILE,
    path.join(process.cwd(), 'repos', '.qwen-config'),
    path.join(process.cwd(), '.qwen-config'),
    (process.env.BANSHEE_REPOS_DIR ? path.join(process.env.BANSHEE_REPOS_DIR, '.qwen-config') : null),
    path.join(os.homedir(), '.banshee', 'qwen', '.env'),
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
  
  // Try to parse the structured input so we can extract the composed prompt
  let promptArg = '';
  try {
    const parsed = JSON.parse(input);
    promptArg = parsed.currentMessage || input;
  } catch {
    promptArg = input;
  }

  // Prepare telemetry log to capture tool calls (best-effort, Qwen fork mirrors Gemini telemetry)
  const telemetryFile = path.join(os.tmpdir(), `qwen-telemetry-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);

  // Ensure workspace telemetry settings for Qwen so tool calls are emitted
  try {
    const wsDir = process.cwd();
    const qwenDir = path.join(wsDir, '.qwen');
    const settingsPath = path.join(qwenDir, 'settings.json');
    fs.mkdirSync(qwenDir, { recursive: true });
    let settings = {};
    try { const raw = fs.readFileSync(settingsPath, 'utf8'); settings = JSON.parse(raw); } catch {}
    settings = settings && typeof settings === 'object' ? settings : {};
    const t = (settings.telemetry && typeof settings.telemetry === 'object') ? settings.telemetry : {};
    const next = {
      ...settings,
      telemetry: {
        ...t,
        enabled: true,
        target: 'local',
        otlpEndpoint: '',
        outfile: telemetryFile,
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
  } catch {}

  // Spawn Qwen CLI in non-interactive prompt mode to avoid TUI wrapping
  const chosen = findQwenCommand();
  const qwen = spawn(chosen.cmd, [
    ...chosen.args,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,  // Include API keys from .env
      NO_COLOR: '1',  // Disable color output for cleaner parsing
      TERM: 'dumb',   // Avoid interactive TUI features
      COLUMNS: '500', // Reduce line wrapping risk
      PATH: [process.env.PATH || '', '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':'),
      LANG: process.env.LANG || 'en_US.UTF-8', // ensure UTF-8 text
      TELEMETRY_LOG_FILE: telemetryFile,
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  // Streaming state
  let buffer = '';
  let isStreaming = false;
  let startTs = null;
  let lastOutChar = '';
  let sawOutput = false;
  const sanitizeOutput = (text) => {
    if (!text) return '';
    // Normalize carriage returns to newlines to avoid partial-line overwrites
    let t = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
    t = t.split('\n').map((line)=> (line.includes('\r') ? line.split('\r').pop() : line)).join('\n');
    const lines = t.split(/\n/);
    const kept = [];
    let dropBlock = false;
    let braceDepth = 0;
    const startsTelemetryBlock = (s) => {
      const lc = s.toLowerCase();
      return (
        lc.includes('gemini_cli.') ||
        lc.includes('qwen_cli.') ||
        lc.includes("'event.name'") ||
        lc.includes('opentelemetry') ||
        lc.includes('telemetry.sdk.version') ||
        /^\s*\{\s*$/.test(s) ||
        /^\s*\{\s*resource\s*:\s*\{/.test(s) ||
        /^\s*\{\s*descriptor\s*:\s*\{/.test(s)
      );
    };
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) { if (!dropBlock) kept.push(''); continue; }
      if (!dropBlock && (/^welcome/i.test(l) || /^model:/i.test(l))) continue;
      if (!dropBlock && (/loaded cached qwen credentials\.?/i.test(l) || /using cached qwen credentials\.?/i.test(l))) continue;
      if (!dropBlock && startsTelemetryBlock(l)) {
        dropBlock = true;
        braceDepth += (raw.match(/\{/g) || []).length;
        braceDepth -= (raw.match(/\}/g) || []).length;
        if (braceDepth <= 0) { dropBlock = false; braceDepth = 0; }
        continue;
      }
      if (dropBlock) {
        braceDepth += (raw.match(/\{/g) || []).length;
        braceDepth -= (raw.match(/\}/g) || []).length;
        if (braceDepth <= 0) { dropBlock = false; braceDepth = 0; }
        continue;
      }
      // Drop typical box-drawing UI frames if any (from interactive TUIs)
      if (/^[\u2500-\u257F]+$/.test(l)) continue; // lines made only of box drawing characters
      if (/^[\u2500-\u257F\s\|\+\-]+$/.test(l)) continue;
      kept.push(l);
    }
    let out = kept.join('\n');
    out = out.replace(/([^\n])\n(?!\n)/g, '$1 ');
    out = out.replace(/[ \t]{2,}/g, ' ');
    return out;
  }
  // Use a stable message id across the whole stream so the frontend can thread deltas
  const messageId = `qwen_${Date.now()}`;
  
  // Auto-approve permission prompts by sending 'y' to stdin
  const maybeApprove = (text) => {
    try {
      const t = String(text || '')
      if (/\b(allow|approve|proceed|continue|confirm|permission required)\b/i.test(t) && /\b(y\/n|yes\/no|\[y\/n\]|\[y\/N\])\b/i.test(t)) {
        try { qwen.stdin.write('y\n') } catch {}
      }
    } catch {}
  }

  // Stream stdout data as it arrives (real-time streaming)
  qwen.stdout.on('data', (data) => {
    const raw = data.toString();
    // Also parse any telemetry JSON printed to stdout so we can emit stats/tool events
    try { tryParseTelemetryChunk(raw) } catch {}
    maybeApprove(raw);
    const cleaned = sanitizeOutput(raw);
    if (cleaned && cleaned.trim().length > 0) sawOutput = true;

    // Decide when to start streaming based on sanitized content
    if (!isStreaming) {
      if (cleaned && cleaned.trim().length > 0) {
        isStreaming = true;
        startTs = Date.now();
      } else {
        return; // Nothing to stream yet
      }
    }

    if (isStreaming) {
      if (!cleaned || cleaned.trim().length === 0) return;
      // Treat this chunk as the delta to display; accumulate into buffer.
      let out = cleaned;
      const first = out[0];
      const needs = (
        lastOutChar &&
        !/\s/.test(lastOutChar) &&
        first &&
        !/^[.,!?;:)\]\}'’]/.test(first) &&
        /[\p{L}\p{N}]/u.test(first)
      );
      if (needs) out = ' ' + out;
      const textEvent = { id: messageId, type: 'text', content: out, ts: startTs || Date.now() };
      process.stdout.write(JSON.stringify(textEvent) + '\n');
      // Accumulate the full answer for the final result event
      buffer += out;
      // Track last non-space character for cross-chunk spacing
      for (let i = out.length - 1; i >= 0; i--) {
        const ch = out[i];
        if (!/\s/.test(ch)) { lastOutChar = ch; break; }
      }
    }
  });
  
  // Handle stderr for debugging, filter out noisy auth messages
  qwen.stderr.on('data', (data) => {
    const text = data.toString();
    maybeApprove(text);
    const lower = text.toLowerCase();
    // Suppress telemetry noise and benign auth lines
    const isTelemetry = (
      lower.includes('gemini_cli.') ||
      lower.includes('qwen_cli.') ||
      lower.includes("'event.name'") ||
      lower.includes('opentelemetry') ||
      lower.includes('telemetry.sdk.version') ||
      /\{\s*resource:\s*\{/.test(text) ||
      /\{\s*descriptor:\s*\{/.test(text)
    );
    const isBenign = (
      lower.includes('loaded cached qwen credentials') ||
      lower.includes('using cached qwen credentials')
    );
    const isMeaningfulError = /error|invalid|unauthorized|forbidden|denied|timed out|timeout|code\s*\d+/i.test(text);
    if (!isTelemetry && !isBenign && isMeaningfulError) {
      console.error('[Qwen stderr]:', text);
    }
  });

  // Best-effort telemetry reader to surface tool calls as UI tool events
  let telemetryTimer = null;
  let lastSize = 0;
  const emittedTools = new Set();
  // Checkpoint helpers
  const FILE_TOOLS = new Set(['write_file', 'replace', 'create_file', 'apply_patch', 'move', 'delete', 'write', 'edit']);
  const DESTRUCTIVE_BASH_PATTERNS = [
    /\brm\b\s+/, /\bmv\b\s+/, /\bcp\b\s+/, />>|\s>\s/, /\bgit\b\s+(reset|revert|clean)\b/, /\bnpm\b\s+(install|update|uninstall)\b/, /\byarn\b\s+(add|remove|upgrade)\b/
  ];
  const extractPaths = (args) => {
    try {
      const keys = ['path','file_path','file','filename','target','destination','to','output'];
      const found = [];
      if (args && typeof args === 'object') {
        for (const k of keys) {
          const v = args[k];
          if (typeof v === 'string') found.push(v);
        }
      }
      return Array.from(new Set(found)).filter(Boolean);
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
  const tryParseTelemetryChunk = (chunk) => {
    if (!chunk) return [];
    const objs = chunk
      .split(/}\s*\n\s*{/)
      .map((obj, idx, arr) => {
        if (idx > 0) obj = '{' + obj;
        if (idx < arr.length - 1) obj = obj + '}';
        return obj.trim();
      })
      .filter(Boolean);
    for (const s of objs) {
      try {
        const j = JSON.parse(s);
        const attrs = j && j.attributes ? j.attributes : null;
        const evName = attrs && attrs['event.name'];
        if (evName === 'qwen_cli.api_response' || evName === 'gemini_cli.api_response' || evName === 'api_response') {
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
        if (evName === 'gemini_cli.tool_call' || evName === 'qwen_cli.tool_call' || evName === 'tool_call') {
          const name = attrs.function_name || attrs.name || 'mcp';
          const args = attrs.function_args || attrs.args || {};
          const key = JSON.stringify({ name, args });
          if (emittedTools.has(key)) continue;
          emittedTools.add(key);
          const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          // Emit checkpoint BEFORE tool execution for safety
          if (String(name).toLowerCase() === 'bash') {
            const cmd = typeof args === 'string' ? args : (args.command || args.raw || '');
            if (typeof cmd === 'string' && DESTRUCTIVE_BASH_PATTERNS.some((r) => r.test(cmd))) {
              emitCheckpoint(`bash: ${cmd}`, []);
            }
          } else if (FILE_TOOLS.has(String(name).toLowerCase())) {
            const paths = extractPaths(typeof args === 'string' ? {} : args);
            emitCheckpoint(`${name}`, paths);
          }
          process.stdout.write(JSON.stringify({ id, type: 'tool:start', tool: name, args: (typeof args === 'string' ? { raw: args } : args) || {}, ts: Date.now() }) + '\n');
          const summary = `called ${name}${args ? ' with args' : ''}`;
          process.stdout.write(JSON.stringify({ id, type: 'tool:output', chunk: summary, done: true, ts: Date.now() }) + '\n');
        }
      } catch {}
    }
  };
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

  // When Qwen exits, send final result event
  qwen.on('close', (code) => {
    console.error('[Qwen Handler] Qwen exited with code:', code);
    
    if (code !== 0 && !buffer) {
      // Error occurred with no output
      const errorEvent = {
        type: 'error',
        error: {
          message: `Qwen process exited with code ${code}`
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
    setImmediate(runNext);
  });
  
  // Send prompt then close stdin so the CLI proceeds without waiting
  try { if (qwen.stdin && !qwen.killed) { qwen.stdin.write(promptArg + '\n'); qwen.stdin.end(); } } catch {}

  setTimeout(() => {
    try {
      if (!sawOutput && !qwen.killed) {
        process.stdout.write(JSON.stringify({ type: 'error', error: { message: 'Qwen timed out without output' } }) + '\n');
        qwen.kill('SIGKILL');
      }
    } catch {}
  }, 15000);
  // Queue driver continues; do not exit process
};

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  queue.push(trimmed);
  runNext();
});

console.error('[Qwen Handler] Ready for streaming requests');

// Handle termination signals
process.on('SIGTERM', () => {
  console.error('[Qwen Handler] SIGTERM received');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[Qwen Handler] SIGINT received');
  process.exit(0);
});

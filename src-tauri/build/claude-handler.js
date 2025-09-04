#!/usr/bin/env node

const pty = require('node-pty');
const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Create readline interface for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let claudePty = null;
let hasActiveSession = false;

/**
 * Resolve the Claude CLI binary path.
 * 1. Use CLAUDE_BINARY_PATH env if set and exists.
 * 2. `which claude` lookup.
 * 3. Known install locations (Homebrew, system, user dirs, NVM).
 * 4. Fallback to command name `claude` (relies on PATH).
 */
function findClaudeBinary() {
  // 1. Environment variable override
  if (process.env.CLAUDE_BINARY_PATH && fs.existsSync(process.env.CLAUDE_BINARY_PATH)) {
    return process.env.CLAUDE_BINARY_PATH;
  }

  // 2. which claude
  try {
    const whichResult = execSync('which claude', { encoding: 'utf8' }).trim();
    if (whichResult && fs.existsSync(whichResult)) {
      return whichResult;
    }
  } catch (_) {
    // ignore
  }

  // 3. Known install locations
  const home = os.homedir();
  const candidates = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(home, 'bin', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
  ];

  // Search NVM installs
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try {
      for (const entry of fs.readdirSync(nvmDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const candidate = path.join(nvmDir, entry.name, 'bin', 'claude');
          candidates.push(candidate);
        }
      }
    } catch (_) {}
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 4. Fallback to relying on PATH
  return 'claude';
}

function spawnClaude(message) {
  console.error('[Handler] Spawning Claude PTY for message:', message.substring(0, 50));
  
  // Kill any existing PTY
  if (claudePty) {
    claudePty.kill();
    claudePty = null;
  }
  
  // Build args
  const args = [];
  
  if (hasActiveSession) {
    args.push('-c');
  }
  
  args.push('-p');
  args.push(message);
  args.push('--output-format');
  args.push('stream-json');
  args.push('--verbose');
  args.push('--dangerously-skip-permissions');
  
  console.error('[Handler] Args:', args.slice(0, 4), '...');
  
  // Spawn Claude with PTY
  const claudeBinaryPath = findClaudeBinary();
  console.error('[Handler] Using Claude binary:', claudeBinaryPath);
  claudePty = pty.spawn(claudeBinaryPath, args, {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env: process.env
  });
  
  console.error('[Handler] Claude PTY spawned with PID:', claudePty.pid);
  
  // Handle output
  claudePty.onData((data) => {
    process.stdout.write(data);
    console.error('[Handler] Streamed', data.length, 'bytes');
  });
  
  // Handle exit
  claudePty.onExit((exitCode) => {
    console.error('[Handler] Claude PTY exited with code:', exitCode);
    if (exitCode && exitCode.exitCode === 0) {
      hasActiveSession = true;
    }
    claudePty = null;
  });
}

// Handle input
rl.on('line', (line) => {
  try {
    const parsed = JSON.parse(line);
    if (parsed.currentMessage) {
      spawnClaude(parsed.currentMessage);
    }
  } catch (err) {
    console.error('[Handler] Error parsing input:', err);
  }
});

// Handle process termination
process.on('SIGTERM', () => {
  console.error('[Handler] Received SIGTERM');
  if (claudePty) {
    claudePty.kill();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[Handler] Received SIGINT');
  if (claudePty) {
    claudePty.kill();
  }
  process.exit(0);
});

console.error('[Handler] Claude PTY handler ready');

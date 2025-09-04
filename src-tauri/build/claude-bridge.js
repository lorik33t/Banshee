#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.error('[Bridge] Starting Claude bridge with PTY handler...');

// Use the PTY handler instead of spawning Claude directly
const handlerPath = path.join(__dirname, 'claude-handler.js');
console.error('[Bridge] Using PTY handler at:', handlerPath);

// Spawn the PTY handler
const handler = spawn('node', [handlerPath], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe']
});

console.error('[Bridge] PTY handler spawned with PID:', handler.pid);

// Forward handler output to stdout
handler.stdout.on('data', (data) => {
  process.stdout.write(data);
});

// Log handler stderr
handler.stderr.on('data', (data) => {
  console.error('[Handler stderr]:', data.toString());
});

// Handle handler errors
handler.on('error', (err) => {
  console.error('[Bridge] Handler error:', err);
  process.stdout.write(JSON.stringify({
    type: 'error',
    message: err.message
  }) + '\n');
});

// Handle handler exit
handler.on('close', (code) => {
  console.error('[Bridge] Handler exited with code:', code);
  process.exit(code || 0);
});

// Forward input from parent to handler
process.stdin.setEncoding('utf8');
process.stdin.on('data', (input) => {
  console.error('[Bridge] Forwarding to handler:', input.trim());
  handler.stdin.write(input);
});

// Handle process termination
process.on('SIGTERM', () => {
  console.error('[Bridge] Received SIGTERM');
  handler.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[Bridge] Received SIGINT');
  handler.kill();
  process.exit(0);
});

console.error('[Bridge] Ready with PTY handler');
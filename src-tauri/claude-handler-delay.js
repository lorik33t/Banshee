#!/usr/bin/env node

import { spawn } from 'node-pty';

// Simple approach: Fixed delay before sending anything
console.error('[DELAY] Starting Claude with fixed delay approach...');

// Read input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  // Parse the input to get the message
  let messageToSend = input;
  
  try {
    const parsed = JSON.parse(input);
    if (parsed.currentMessage) {
      messageToSend = parsed.currentMessage;
    }
  } catch (e) {
    // Use raw input if not JSON
  }
  
  // Create PTY for Claude
  const claude = spawn('claude', [
    '-c',
    '--output-format=stream-json'
  ], {
    name: 'xterm-color',
    cols: 120,
    rows: 40,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color'
    }
  });
  
  let buffer = '';
  let responded = false;
  
  // CRITICAL: Wait exactly 150ms then send Enter
  // This timing is based on typical Claude startup time
  setTimeout(() => {
    console.error('[DELAY] Sending Enter at 150ms...');
    claude.write('\r');
  }, 150);
  
  // Send message at 300ms (after prompt should be handled)
  setTimeout(() => {
    console.error('[DELAY] Sending message at 300ms...');
    claude.write(messageToSend + '\r');
  }, 300);
  
  // Handle Claude output
  claude.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    lines.forEach(line => {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('{')) {
        try {
          JSON.parse(trimmed);
          
          if (!responded) {
            responded = true;
          }
          
          // Forward the JSON
          process.stdout.write(trimmed + '\n');
          
        } catch (e) {
          // Not JSON
        }
      }
    });
  });
  
  // Timeout
  setTimeout(() => {
    if (!responded) {
      responded = true;
      claude.kill();
      
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: 'Claude CLI timeout',
        session_id: sessionId
      }) + '\n');
      
      process.exit(1);
    }
  }, 15000);
  
  // Handle exit
  claude.on('exit', (code) => {
    console.error('[DELAY] Claude exited with code:', code);
    process.exit(code || 0);
  });
  
  // Handle signals
  process.on('SIGTERM', () => {
    claude.kill();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    claude.kill();
    process.exit(0);
  });
});
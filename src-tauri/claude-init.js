#!/usr/bin/env node

// This script initializes Claude and retrieves conversation history
import { spawn } from 'child_process';

// When Claude starts with -c, we need to trigger it to output the conversation
// We can do this by sending an empty message or a special command

const claude = spawn('claude', ['-c', '--output-format=stream-json', '--verbose'], {
  cwd: process.cwd()
});

let buffer = '';
let hasHistory = false;

claude.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const parsed = JSON.parse(line);
      
      // Check if this is conversation history
      if (parsed.type === 'history' || parsed.type === 'conversation:history') {
        hasHistory = true;
        process.stdout.write(line + '\n');
      } else if (parsed.type === 'system' && parsed.subtype === 'init') {
        // System initialized
        process.stdout.write(line + '\n');
      } else if (parsed.type === 'message' && parsed.message) {
        // Output historical messages
        process.stdout.write(line + '\n');
      }
    } catch (e) {
      // Skip invalid JSON
    }
  }
});

// Set a timeout to check if we got history
setTimeout(() => {
  if (!hasHistory) {
    // No history received, output empty history event
    process.stdout.write(JSON.stringify({
      type: 'conversation:history',
      messages: [],
      timestamp: new Date().toISOString()
    }) + '\n');
  }
  claude.kill();
  process.exit(0);
}, 2000);

// Send empty input to trigger history output
claude.stdin.write('\n');
claude.stdin.end();
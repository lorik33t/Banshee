#!/usr/bin/env node

import { spawn } from 'child_process';

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
  
  // Don't use -c flag, it seems to cause hanging
  const claudeArgs = ['--dangerously-skip-permissions', '--output-format=stream-json', '--verbose'];
  
  console.error('[HANDLER] Starting Claude with args:', claudeArgs);
  console.error('[HANDLER] Message:', messageToSend);
  
  const claude = spawn('claude', claudeArgs, {
    cwd: process.cwd()
  });
  
  let responded = false;
  let buffer = '';
  
  // Handle cancellation signals
  process.on('SIGINT', () => {
    claude.kill('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    claude.kill('SIGTERM');
    process.exit(0);
  });
  
  // Add error handling
  claude.on('error', (err) => {
    console.error('[HANDLER] Failed to start Claude:', err);
    // Send error response
    process.stdout.write(JSON.stringify({
      type: 'error',
      message: 'Failed to start Claude CLI: ' + err.message
    }) + '\n');
    process.exit(1);
  });
  
  // Handle stderr
  claude.stderr.on('data', (data) => {
    console.error('[HANDLER stderr]:', data.toString());
  });
  
  // Buffer for line processing
  claude.stdout.on('data', (data) => {
    const chunk = data.toString();
    console.error('[HANDLER] Got stdout chunk:', chunk.substring(0, 100));
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        // Validate JSON
        JSON.parse(line);
        console.error('[HANDLER] Sending valid JSON line');
        process.stdout.write(line + '\n');
        responded = true;
      } catch (e) {
        console.error('[HANDLER] Invalid JSON, skipping:', line);
      }
    }
  });
  
  // Handle process exit
  claude.on('close', (code) => {
    console.error('[HANDLER] Claude process closed with code:', code);
    
    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        JSON.parse(buffer);
        process.stdout.write(buffer + '\n');
      } catch (e) {
        console.error('[HANDLER] Final buffer not valid JSON');
      }
    }
    
    if (!responded) {
      // No valid response received, send error
      process.stdout.write(JSON.stringify({
        type: 'error',
        message: 'Claude CLI exited without response (code: ' + code + ')'
      }) + '\n');
    }
    
    process.exit(0);
  });
  
  // Send message to Claude
  console.error('[HANDLER] Writing to stdin:', messageToSend);
  claude.stdin.write(messageToSend);
  claude.stdin.end();
});
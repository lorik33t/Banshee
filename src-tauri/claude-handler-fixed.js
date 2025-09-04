#!/usr/bin/env node

import { spawn } from 'node-pty';

// Simple but effective: Watch for prompt and respond IMMEDIATELY
console.error('[FIXED] Starting Claude with targeted prompt detection...');

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
    '--output-format=stream-json',
    '--verbose'
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
  let promptResponded = false;
  let messageSent = false;
  
  // Send Enter proactively - Claude often waits silently
  const sendEnterProactively = () => {
    if (!promptResponded) {
      claude.write('\r');
      setTimeout(() => {
        if (!promptResponded) claude.write('\r');
      }, 100);
      setTimeout(() => {
        if (!promptResponded) claude.write('\r');
      }, 200);
      setTimeout(() => {
        if (!promptResponded) claude.write('\r');
      }, 300);
      setTimeout(() => {
        if (!promptResponded) claude.write('\r');
      }, 500);
    }
  };
  
  // Start sending Enter immediately
  sendEnterProactively();
  
  // Handle Claude output
  claude.on('data', (data) => {
    const dataStr = data.toString();
    
    // Immediate prompt detection and response
    if (!promptResponded) {
      // Common permission prompt patterns
      const promptPatterns = [
        'press enter',
        'enter to confirm',
        'hit enter',
        'permission',
        '→',  // Arrow prompt
        '❯',  // Chevron prompt
        '▸',  // Triangle prompt
        '?',  // Question prompt
        ':',  // Colon prompt (common in CLI)
      ];
      
      const lowerData = dataStr.toLowerCase();
      const hasPrompt = promptPatterns.some(p => lowerData.includes(p));
      
      // Also check if output ends with common prompt characters
      const trimmed = dataStr.trim();
      const endsWithPrompt = trimmed.endsWith('?') || 
                           trimmed.endsWith(':') || 
                           trimmed.endsWith('>') ||
                           trimmed.endsWith('→') ||
                           trimmed.endsWith('❯');
      
      if (hasPrompt || endsWithPrompt) {
        console.error('[FIXED] Prompt detected! Sending Enter immediately');
        console.error('[FIXED] Prompt text:', JSON.stringify(dataStr.substring(0, 200)));
        promptResponded = true;
        
        // Send Enter multiple times rapidly
        claude.write('\r');
        claude.write('\r\n');
        setTimeout(() => claude.write('\r'), 10);
        setTimeout(() => claude.write('\r'), 50);
        setTimeout(() => claude.write('\r'), 100);
      }
    }
    
    // Send message after brief delay once we've handled any prompt
    if (promptResponded && !messageSent) {
      setTimeout(() => {
        if (!messageSent) {
          console.error('[FIXED] Sending message...');
          claude.write(messageToSend + '\r');
          messageSent = true;
        }
      }, 200);
    }
    
    // Process output for JSON
    buffer += dataStr;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    lines.forEach(line => {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('{')) {
        try {
          JSON.parse(trimmed);
          
          // Valid JSON - we're good!
          if (!responded) {
            responded = true;
            promptResponded = true;  // No prompt needed if we get JSON
            
            // Send message if we haven't yet
            if (!messageSent) {
              console.error('[FIXED] Got JSON, sending message...');
              claude.write(messageToSend + '\r');
              messageSent = true;
            }
          }
          
          // Forward the JSON
          process.stdout.write(trimmed + '\n');
          
        } catch (e) {
          // Not JSON
        }
      }
    });
  });
  
  // Fallback: Send message after 1.5 seconds if nothing happened
  setTimeout(() => {
    if (!messageSent) {
      console.error('[FIXED] Fallback: sending message after timeout');
      promptResponded = true;
      claude.write(messageToSend + '\r');
      messageSent = true;
    }
  }, 1500);
  
  // Timeout
  setTimeout(() => {
    if (!responded) {
      responded = true;
      claude.kill();
      
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: 'Claude CLI timeout - may need to run "claude auth login"',
        session_id: sessionId
      }) + '\n');
      
      process.exit(1);
    }
  }, 15000);
  
  // Handle exit
  claude.on('exit', (code) => {
    console.error('[FIXED] Claude exited with code:', code);
    if (!responded) {
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: `Claude CLI exited unexpectedly (code ${code})`,
        session_id: sessionId
      }) + '\n');
    }
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
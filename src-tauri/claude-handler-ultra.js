#!/usr/bin/env node

import { spawn } from 'node-pty';

console.error('[ULTRA] Starting Claude with ULTRA-aggressive prompt handling...');

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
      TERM: 'xterm-256color',
      FORCE_COLOR: '1'
    }
  });
  
  console.error('[ULTRA] Claude process spawned');
  
  let buffer = '';
  let responded = false;
  let jsonDetected = false;
  let enterInterval = null;
  let messagesSent = 0;
  
  // ULTRA-AGGRESSIVE: Send Enter continuously until we see JSON
  const startEnterSpam = () => {
    console.error('[ULTRA] Starting Enter key spam...');
    
    // Send Enter immediately
    claude.write('\r');
    
    // Then every 10ms until we see JSON
    enterInterval = setInterval(() => {
      if (!jsonDetected) {
        messagesSent++;
        
        // Cycle through different Enter formats
        switch (messagesSent % 6) {
          case 0: claude.write('\r'); break;
          case 1: claude.write('\n'); break;
          case 2: claude.write('\r\n'); break;
          case 3: claude.write(' \r'); break;
          case 4: claude.write('y\r'); break;
          case 5: claude.write('\x0D'); break;  // Raw carriage return
        }
        
        if (messagesSent % 100 === 0) {
          console.error(`[ULTRA] Sent ${messagesSent} Enter keys, still no JSON...`);
        }
      } else {
        clearInterval(enterInterval);
      }
    }, 10);  // Every 10ms
    
    // Stop spamming after 5 seconds if no JSON
    setTimeout(() => {
      if (enterInterval) {
        clearInterval(enterInterval);
        console.error('[ULTRA] Stopped Enter spam after 5 seconds');
      }
    }, 5000);
  };
  
  // Start Enter spam immediately
  startEnterSpam();
  
  // Set timeout for response
  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      if (enterInterval) clearInterval(enterInterval);
      claude.kill();
      
      // Send error response
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: `Claude CLI not responding after ${messagesSent} Enter attempts`,
        session_id: sessionId
      }) + '\n');
      
      process.exit(1);
    }
  }, 20000);  // 20 seconds
  
  // Track what we've seen
  let allOutput = '';
  
  // Handle Claude output
  claude.on('data', (data) => {
    const dataStr = data.toString();
    allOutput += dataStr;
    
    // Only log first occurrence of non-JSON data
    if (!jsonDetected && !dataStr.trim().startsWith('{')) {
      console.error('[ULTRA-Output]:', JSON.stringify(dataStr.substring(0, 100)));
    }
    
    buffer += dataStr;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    lines.forEach(line => {
      const trimmed = line.trim();
      
      // Look for JSON objects
      if (trimmed.startsWith('{')) {
        try {
          // Validate it's JSON
          const parsed = JSON.parse(trimmed);
          
          if (!jsonDetected) {
            jsonDetected = true;
            console.error(`[ULTRA] JSON detected after ${messagesSent} Enter attempts!`);
            if (enterInterval) {
              clearInterval(enterInterval);
              enterInterval = null;
            }
          }
          
          if (!responded) {
            clearTimeout(timeout);
            responded = true;
          }
          
          // Forward the JSON event
          process.stdout.write(trimmed + '\n');
          console.error('[ULTRA-JSON]:', trimmed.substring(0, 100));
          
        } catch (e) {
          // Not valid JSON
        }
      }
    });
    
    // If we still haven't seen JSON and buffer is getting large, 
    // it might be waiting at a different kind of prompt
    if (!jsonDetected && allOutput.length > 500) {
      console.error('[ULTRA] Large output buffer, trying different approach...');
      // Try sending the message directly
      if (!claude.writableEnded) {
        claude.write(messageToSend + '\r');
      }
    }
  });
  
  // Send message to Claude after brief delay
  setTimeout(() => {
    console.error('[ULTRA] Sending message:', messageToSend.substring(0, 50));
    claude.write(messageToSend + '\r');
  }, 100);
  
  // Also try sending message after 1 second if still no JSON
  setTimeout(() => {
    if (!jsonDetected) {
      console.error('[ULTRA] No JSON yet, resending message...');
      claude.write(messageToSend + '\r');
    }
  }, 1000);
  
  // Handle errors
  claude.on('exit', (code) => {
    console.error('[ULTRA] Claude exited with code:', code);
    if (enterInterval) clearInterval(enterInterval);
    clearTimeout(timeout);
    
    if (!responded) {
      // Log what we saw
      console.error('[ULTRA] All output received:', allOutput.substring(0, 500));
      
      // Send error response
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: `Claude CLI exited (code ${code}). Output: ${allOutput.substring(0, 200)}`,
        session_id: sessionId
      }) + '\n');
    }
    
    process.exit(code || 0);
  });
  
  // Handle signals
  process.on('SIGTERM', () => {
    if (enterInterval) clearInterval(enterInterval);
    claude.kill();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    if (enterInterval) clearInterval(enterInterval);
    claude.kill();
    process.exit(0);
  });
});
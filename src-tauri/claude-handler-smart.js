#!/usr/bin/env node

import { spawn } from 'node-pty';

console.error('[SMART] Starting Claude with smart prompt detection...');

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
  
  console.error('[SMART] Claude process spawned');
  
  let buffer = '';
  let responded = false;
  let jsonDetected = false;
  let lastOutputTime = Date.now();
  let lastOutputLength = 0;
  let stabilityCheckInterval = null;
  let phase = 'WAITING_FOR_PROMPT';  // WAITING_FOR_PROMPT -> PROMPT_HANDLED -> READY_FOR_MESSAGE -> PROCESSING
  let allOutput = '';
  
  // Function to check if output has stabilized
  const checkOutputStability = () => {
    const now = Date.now();
    const currentLength = allOutput.length;
    const timeSinceLastOutput = now - lastOutputTime;
    
    if (currentLength !== lastOutputLength) {
      // Output changed, update tracking
      lastOutputTime = now;
      lastOutputLength = currentLength;
      return false;
    }
    
    // Output is stable if no changes for 200ms
    return timeSinceLastOutput > 200;
  };
  
  // Smart phase management
  const handlePhase = () => {
    switch (phase) {
      case 'WAITING_FOR_PROMPT':
        if (checkOutputStability() && allOutput.length > 0) {
          console.error('[SMART] Output stabilized, likely at prompt. Sending Enter...');
          console.error('[SMART] Current output:', JSON.stringify(allOutput.slice(-200)));
          
          // Send Enter in multiple formats
          claude.write('\r');
          setTimeout(() => claude.write('\n'), 10);
          setTimeout(() => claude.write('\r\n'), 20);
          setTimeout(() => claude.write(' \r'), 30);
          
          phase = 'PROMPT_HANDLED';
          lastOutputTime = Date.now();
          lastOutputLength = allOutput.length;
        }
        break;
        
      case 'PROMPT_HANDLED':
        // Wait for any response to our Enter
        if (checkOutputStability()) {
          console.error('[SMART] Prompt handled, ready to send message');
          phase = 'READY_FOR_MESSAGE';
        }
        break;
        
      case 'READY_FOR_MESSAGE':
        console.error('[SMART] Sending actual message:', messageToSend.substring(0, 50));
        claude.write(messageToSend + '\r');
        phase = 'PROCESSING';
        
        // Clear the stability checker
        if (stabilityCheckInterval) {
          clearInterval(stabilityCheckInterval);
          stabilityCheckInterval = null;
        }
        break;
        
      case 'PROCESSING':
        // Just wait for JSON responses
        break;
    }
  };
  
  // Start stability checker
  stabilityCheckInterval = setInterval(handlePhase, 50);
  
  // If we see JSON immediately, skip all the prompt handling
  const fastTrackJson = () => {
    if (jsonDetected && phase !== 'PROCESSING') {
      console.error('[SMART] JSON detected early, fast-tracking to message send');
      phase = 'READY_FOR_MESSAGE';
      handlePhase();
    }
  };
  
  // Set timeout
  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      if (stabilityCheckInterval) clearInterval(stabilityCheckInterval);
      claude.kill();
      
      console.error('[SMART] Timeout reached. Phase:', phase);
      console.error('[SMART] Last output:', allOutput.slice(-500));
      
      // Send error response
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: `Claude CLI timeout at phase: ${phase}`,
        details: allOutput.slice(-200),
        session_id: sessionId
      }) + '\n');
      
      process.exit(1);
    }
  }, 15000);  // 15 seconds
  
  // Handle Claude output
  claude.on('data', (data) => {
    const dataStr = data.toString();
    allOutput += dataStr;
    lastOutputTime = Date.now();
    
    // Log output based on phase
    if (phase === 'WAITING_FOR_PROMPT' || phase === 'PROMPT_HANDLED') {
      console.error(`[SMART-${phase}]:`, JSON.stringify(dataStr.substring(0, 100)));
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
            console.error('[SMART] First JSON detected!');
            fastTrackJson();
          }
          
          if (!responded) {
            clearTimeout(timeout);
            responded = true;
          }
          
          // Forward the JSON event
          process.stdout.write(trimmed + '\n');
          
        } catch (e) {
          // Not valid JSON
        }
      }
    });
  });
  
  // Fallback: Send message after 2 seconds if still waiting
  setTimeout(() => {
    if (phase === 'WAITING_FOR_PROMPT' || phase === 'PROMPT_HANDLED') {
      console.error('[SMART] Fallback: forcing message send after 2s');
      phase = 'READY_FOR_MESSAGE';
      handlePhase();
    }
  }, 2000);
  
  // Handle errors
  claude.on('exit', (code) => {
    console.error('[SMART] Claude exited with code:', code);
    if (stabilityCheckInterval) clearInterval(stabilityCheckInterval);
    clearTimeout(timeout);
    
    if (!responded) {
      // Send error response with diagnostics
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system', 
        subtype: 'error',
        error: `Claude CLI exited (code ${code}) at phase: ${phase}`,
        session_id: sessionId
      }) + '\n');
    }
    
    process.exit(code || 0);
  });
  
  // Handle signals
  process.on('SIGTERM', () => {
    if (stabilityCheckInterval) clearInterval(stabilityCheckInterval);
    claude.kill();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    if (stabilityCheckInterval) clearInterval(stabilityCheckInterval);
    claude.kill();
    process.exit(0);
  });
});
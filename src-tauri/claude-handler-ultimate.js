#!/usr/bin/env node

import { spawn } from 'node-pty';
import { writeFileSync } from 'fs';
import { join } from 'path';

const DEBUG_FILE = join(process.env.HOME || '/tmp', '.claude-handler-debug.log');
const debugLog = (msg) => {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}\n`;
  console.error(logMsg.trim());
  try {
    writeFileSync(DEBUG_FILE, logMsg, { flag: 'a' });
  } catch (e) {}
};

debugLog('[ULTIMATE] Starting Claude with ultimate prompt handling...');

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
  
  debugLog(`[ULTIMATE] Message to send: ${messageToSend.substring(0, 100)}...`);
  
  // Try multiple Claude invocation strategies
  const strategies = [
    {
      name: 'bypass-all',
      args: ['--dangerously-skip-permissions', '-c', '--output-format=stream-json', '--permission-mode', 'bypassPermissions'],
      env: { CLAUDE_NO_INTERACTIVE: '1', CLAUDE_ASSUME_YES: '1' }
    },
    {
      name: 'standard',
      args: ['-c', '--output-format=stream-json', '--verbose'],
      env: {}
    },
    {
      name: 'minimal',
      args: ['-c', '--output-format=stream-json'],
      env: {}
    }
  ];
  
  let strategyIndex = 0;
  let claude = null;
  let currentStrategy = null;
  
  const tryNextStrategy = () => {
    if (claude) {
      claude.kill();
    }
    
    if (strategyIndex >= strategies.length) {
      debugLog('[ULTIMATE] All strategies exhausted');
      process.exit(1);
    }
    
    currentStrategy = strategies[strategyIndex++];
    debugLog(`[ULTIMATE] Trying strategy: ${currentStrategy.name}`);
    
    // Create PTY for Claude
    claude = spawn('claude', currentStrategy.args, {
      name: 'xterm-color',
      cols: 120,
      rows: 40,
      cwd: process.cwd(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        ...currentStrategy.env
      }
    });
    
    setupClaudeHandlers();
  };
  
  let buffer = '';
  let responded = false;
  let jsonDetected = false;
  let allOutput = '';
  let outputStableCount = 0;
  let lastOutputLength = 0;
  let promptHandled = false;
  let messageSent = false;
  let checkInterval = null;
  
  const setupClaudeHandlers = () => {
    // Reset state for new attempt
    buffer = '';
    allOutput = '';
    outputStableCount = 0;
    lastOutputLength = 0;
    promptHandled = false;
    messageSent = false;
    
    // Ultra-aggressive Enter sending for first 500ms
    const enterBlast = setInterval(() => {
      if (!jsonDetected) {
        claude.write('\r');
        claude.write('\n');
        claude.write('\r\n');
      }
    }, 25);
    
    setTimeout(() => clearInterval(enterBlast), 500);
    
    // Smart output monitoring
    checkInterval = setInterval(() => {
      const currentLength = allOutput.length;
      
      if (currentLength === lastOutputLength) {
        outputStableCount++;
      } else {
        outputStableCount = 0;
        lastOutputLength = currentLength;
      }
      
      // Output is stable for 100ms (2 checks)
      if (outputStableCount >= 2 && !jsonDetected) {
        if (!promptHandled && allOutput.length > 0) {
          debugLog(`[ULTIMATE] Output stable at prompt, sending Enter...`);
          debugLog(`[ULTIMATE] Output preview: ${JSON.stringify(allOutput.slice(-100))}`);
          
          // Send various acceptance inputs
          claude.write('\r');
          claude.write('y\r');
          claude.write('yes\r');
          claude.write(' \r');
          promptHandled = true;
        } else if (promptHandled && !messageSent) {
          debugLog('[ULTIMATE] Sending message after prompt handled');
          claude.write(messageToSend + '\r');
          messageSent = true;
        }
      }
      
      // Fallback: send message after 1 second anyway
      if (!messageSent && Date.now() - startTime > 1000) {
        debugLog('[ULTIMATE] Fallback: sending message after 1s');
        claude.write(messageToSend + '\r');
        messageSent = true;
      }
    }, 50);
    
    // Set strategy timeout
    const strategyTimeout = setTimeout(() => {
      if (!jsonDetected) {
        debugLog(`[ULTIMATE] Strategy ${currentStrategy.name} timeout, trying next...`);
        clearInterval(checkInterval);
        tryNextStrategy();
      }
    }, 5000);  // 5 seconds per strategy
    
    // Handle Claude output
    claude.on('data', (data) => {
      const dataStr = data.toString();
      allOutput += dataStr;
      
      // Only log non-JSON output
      if (!dataStr.trim().startsWith('{')) {
        debugLog(`[ULTIMATE-OUT] ${JSON.stringify(dataStr.substring(0, 100))}`);
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
              debugLog(`[ULTIMATE] JSON detected with strategy: ${currentStrategy.name}`);
              clearInterval(checkInterval);
              clearTimeout(strategyTimeout);
            }
            
            if (!responded) {
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
    
    // Handle errors
    claude.on('exit', (code) => {
      debugLog(`[ULTIMATE] Claude exited with code: ${code}`);
      clearInterval(checkInterval);
      clearTimeout(strategyTimeout);
      
      if (!jsonDetected && strategyIndex < strategies.length) {
        debugLog('[ULTIMATE] Trying next strategy...');
        tryNextStrategy();
      } else if (!responded) {
        // Send final error
        const sessionId = Date.now().toString();
        process.stdout.write(JSON.stringify({
          type: 'system',
          subtype: 'error', 
          error: 'Claude CLI failed with all strategies. Check ' + DEBUG_FILE + ' for details',
          session_id: sessionId
        }) + '\n');
        process.exit(1);
      } else {
        process.exit(0);
      }
    });
  };
  
  const startTime = Date.now();
  
  // Start with first strategy
  tryNextStrategy();
  
  // Global timeout
  setTimeout(() => {
    if (!responded) {
      debugLog('[ULTIMATE] Global timeout reached');
      if (claude) claude.kill();
      
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: 'Claude CLI global timeout. See ' + DEBUG_FILE,
        session_id: sessionId
      }) + '\n');
      
      process.exit(1);
    }
  }, 20000);  // 20 seconds total
  
  // Handle signals
  process.on('SIGTERM', () => {
    if (claude) claude.kill();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    if (claude) claude.kill(); 
    process.exit(0);
  });
});
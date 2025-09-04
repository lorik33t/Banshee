#!/usr/bin/env node

import { spawn } from 'node-pty';

console.error('[PTY-Handler] Starting Claude with interactive PTY support...');

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
  
  // Create PTY for Claude - use flags that should bypass permissions
  const claude = spawn('claude', [
    '--dangerously-skip-permissions',  // Skip permissions
    '-c',  // Continue conversation
    '--output-format=stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions'  // Also try this flag
  ], {
    name: 'xterm-color',
    cols: 120,
    rows: 40,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
      CLAUDE_NO_INTERACTIVE: '1',  // Try to disable interactive mode
      CLAUDE_ASSUME_YES: '1'        // Auto-accept prompts
    }
  });
  
  console.error('[PTY-Handler] Claude process spawned');
  
  let buffer = '';
  let responded = false;
  let promptDetected = false;
  let jsonStarted = false;
  
  // Aggressive prompt detection and auto-acceptance
  const handlePrompt = () => {
    if (!promptDetected) {
      promptDetected = true;
      console.error('[PTY-Handler] Permission prompt detected - sending Enter');
      
      // Send Enter key in multiple formats to ensure it works
      claude.write('\r');      // Carriage return
      claude.write('\n');      // Newline
      claude.write('\r\n');    // CRLF
      claude.write(' \r');     // Space + Enter (some prompts need this)
      claude.write('y\r');     // Try 'y' + Enter
      claude.write('yes\r');   // Try 'yes' + Enter
      
      // Send multiple times with delays
      setTimeout(() => {
        claude.write('\r');
        claude.write('\r\n');
      }, 50);
      
      setTimeout(() => {
        claude.write('\r');
        claude.write(' \r');
      }, 100);
      
      setTimeout(() => {
        claude.write('\r\n');
      }, 200);
    }
  };
  
  // Set timeout for response
  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      claude.kill();
      
      // Send error response in Claude's format
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: 'Claude CLI timeout - permission prompt may be blocking',
        session_id: sessionId
      }) + '\n');
      
      process.exit(1);
    }
  }, 15000);  // 15 seconds
  
  // Handle Claude output
  claude.on('data', (data) => {
    const dataStr = data.toString();
    console.error('[PTY-Raw]:', JSON.stringify(dataStr.substring(0, 200)));
    
    // Check for any prompt-like patterns
    const promptPatterns = [
      'Enter to confirm',
      'Press Enter',
      'press enter',
      'confirm',
      'Continue?',
      'proceed',
      '[Y/n]',
      '[y/N]',
      '(y/n)',
      'yes/no',
      'permission',
      'allow',
      'security',
      'Esc to exit',
      '╭─',  // Box drawing characters often used in prompts
      '┌─',
      '▸',   // Arrow indicators
      '❯',   // Prompt arrows
      '→',
      'Would you like',
      'Do you want'
    ];
    
    // Check if this looks like a prompt
    const lowerData = dataStr.toLowerCase();
    const isPrompt = promptPatterns.some(pattern => 
      lowerData.includes(pattern.toLowerCase())
    );
    
    // Also check for common prompt endings
    const endsWithPrompt = /[?:>]\s*$/.test(dataStr.trim());
    
    // If we haven't seen JSON yet and this looks like a prompt, handle it
    if (!jsonStarted && (isPrompt || endsWithPrompt)) {
      handlePrompt();
    }
    
    // Also send Enter periodically in the first second if no JSON yet
    if (!jsonStarted && !promptDetected) {
      handlePrompt();
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
          JSON.parse(trimmed);
          
          if (!responded) {
            clearTimeout(timeout);
            responded = true;
            jsonStarted = true;
          }
          
          // Forward the JSON event
          process.stdout.write(trimmed + '\n');
          console.error('[PTY-JSON]:', trimmed.substring(0, 100));
          
        } catch (e) {
          // Not valid JSON
          console.error('[PTY-NonJSON]:', trimmed.substring(0, 50));
        }
      }
    });
  });
  
  // Send message to Claude after a brief delay to ensure prompt is handled
  setTimeout(() => {
    console.error('[PTY-Handler] Sending message:', messageToSend.substring(0, 50));
    claude.write(messageToSend + '\r');
  }, 300);
  
  // Handle errors
  claude.on('exit', (code) => {
    console.error('[PTY-Handler] Claude exited with code:', code);
    clearTimeout(timeout);
    
    if (!responded) {
      // Send error response
      const sessionId = Date.now().toString();
      process.stdout.write(JSON.stringify({
        type: 'system',
        subtype: 'error',
        error: `Claude CLI exited with code ${code} - may need to run 'claude auth login'`,
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
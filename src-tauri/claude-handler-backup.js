#!/usr/bin/env node

import { spawn } from 'child_process';

// Read input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  // Parse input to get conversation history
  let messageToSend = '';
  
  try {
    const parsed = JSON.parse(input);
    if (parsed.messages && Array.isArray(parsed.messages)) {
      // Build conversation history from previous messages
      const conversationContext = parsed.messages
        .slice(-10) // Keep last 10 messages
        .map(msg => {
          if (msg.role === 'user') {
            return `Human: ${msg.content}`;
          } else if (msg.role === 'assistant') {
            return `Assistant: ${msg.content}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n');
      
      // Append the current message at the end
      if (conversationContext && parsed.currentMessage) {
        messageToSend = conversationContext + '\n\nHuman: ' + parsed.currentMessage;
      } else if (parsed.currentMessage) {
        // For single messages without history, just send the message directly
        messageToSend = parsed.currentMessage;
      } else {
        messageToSend = conversationContext || input;
      }
    } else {
      messageToSend = input;
    }
  } catch (e) {
    messageToSend = input;
  }
  
  // Use JSON output format for more reliable parsing
  const claude = spawn('claude', ['-p', '--output-format=json', messageToSend], {
    cwd: process.cwd()
  });
  
  // Handle spawn errors
  claude.on('error', (err) => {
    const errorResponse = {
      type: 'message',
      role: 'assistant',
      text: `Error: Failed to start Claude CLI: ${err.message}`
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    process.exit(1);
  });
  
  let buffer = '';
  
  // Capture output
  claude.stdout.on('data', (data) => {
    buffer += data.toString();
  });
  
  // Capture errors silently (don't write to stderr as it interferes with Tauri)
  let errorBuffer = '';
  claude.stderr.on('data', (data) => {
    errorBuffer += data.toString();
  });
  
  // Send response when done
  claude.on('close', (code) => {
    if (buffer) {
      try {
        // Try to parse JSON response
        const jsonResponse = JSON.parse(buffer.trim());
        const response = {
          type: 'message',
          role: 'assistant',
          text: jsonResponse.result || jsonResponse.text || jsonResponse.content || buffer.trim()
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (e) {
        // If not JSON, treat as plain text
        const response = {
          type: 'message',
          role: 'assistant',
          text: buffer.trim()
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } else if (errorBuffer) {
      // If we have errors but no output, send the error as a message
      const response = {
        type: 'message',
        role: 'assistant',
        text: `Error from Claude CLI: ${errorBuffer}`
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } else {
      // No output at all
      const response = {
        type: 'message',
        role: 'assistant',
        text: 'No response from Claude CLI (it may not be running or configured properly)'
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
    process.exit(code || 0);
  });
});
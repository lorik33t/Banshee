#!/usr/bin/env node

// Mock Claude handler for testing when Claude CLI is not available
import { v4 as uuidv4 } from 'uuid';

// Read input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  let messageToSend = input;
  
  try {
    const parsed = JSON.parse(input);
    if (parsed.currentMessage) {
      messageToSend = parsed.currentMessage;
    }
  } catch (e) {
    // Use raw input if not JSON
  }
  
  const sessionId = Date.now().toString();
  const messageId = 'msg_' + uuidv4();
  
  // Simulate streaming response
  const responses = [
    "Hello! I'm a mock Claude assistant running locally. ",
    "I received your message: \"" + messageToSend + "\". ",
    "The real Claude CLI seems to be having authentication issues on your system. ",
    "You can try running 'claude auth login' in your terminal to fix this, ",
    "or continue testing with this mock interface."
  ];
  
  // Send init event
  process.stdout.write(JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: sessionId
  }) + '\n');
  
  // Stream the response word by word
  let fullText = '';
  responses.forEach((part, index) => {
    fullText += part;
    
    // Send partial message events
    process.stdout.write(JSON.stringify({
      type: 'assistant',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: fullText
        }],
        stop_reason: index === responses.length - 1 ? 'end_turn' : null
      },
      session_id: sessionId
    }) + '\n');
  });
  
  process.exit(0);
});

// Handle timeout
setTimeout(() => {
  process.stderr.write('Mock handler timeout\n');
  process.exit(1);
}, 5000);
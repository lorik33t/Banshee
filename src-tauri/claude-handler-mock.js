#!/usr/bin/env node

// Mock handler for testing when Claude CLI is not working

// Read input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  let messageToSend = '';
  
  try {
    const parsed = JSON.parse(input);
    if (parsed.currentMessage) {
      messageToSend = parsed.currentMessage;
    } else {
      messageToSend = input;
    }
  } catch (e) {
    messageToSend = input;
  }
  
  // Simple mock response
  const responses = [
    "I understand you're trying to communicate, but Claude CLI appears to be having issues. This is a mock response.",
    "Hello! The Claude CLI seems to be non-responsive. This is a test message.",
    "Hi there! This is a placeholder response while we debug the Claude CLI issue."
  ];
  
  const response = {
    type: 'message',
    role: 'assistant',
    text: responses[Math.floor(Math.random() * responses.length)] + ` You said: "${messageToSend}"`
  };
  
  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
});
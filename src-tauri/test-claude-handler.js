#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync } from 'fs';

const handlerPath = process.argv[2] || './model_handlers/claude-handler.js';

if (!existsSync(handlerPath)) {
  console.error(`Error: Handler not found at ${handlerPath}`);
  console.error('Usage: ./test-claude-handler.js [path-to-handler]');
  process.exit(1);
}

console.log(`Testing handler: ${handlerPath}\n`);

const testMessage = JSON.stringify({
  currentMessage: "Hello! Can you tell me what 2+2 equals?"
});

const handler = spawn('node', [handlerPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let error = '';
let hasJson = false;
let startTime = Date.now();

handler.stdout.on('data', (data) => {
  output += data.toString();
  const lines = data.toString().split('\n');
  
  lines.forEach(line => {
    if (line.trim()) {
      if (line.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(line.trim());
          if (!hasJson) {
            hasJson = true;
            console.log(`✓ JSON response received after ${Date.now() - startTime}ms`);
            console.log(`  Type: ${parsed.type}`);
            if (parsed.message?.content) {
              const content = Array.isArray(parsed.message.content) 
                ? parsed.message.content[0]?.text 
                : parsed.message.content;
              console.log(`  Preview: ${content?.substring(0, 100)}...`);
            }
          }
        } catch (e) {
          console.log('Invalid JSON:', line);
        }
      }
    }
  });
});

handler.stderr.on('data', (data) => {
  error += data.toString();
  // Only show non-debug output
  const line = data.toString();
  if (!line.includes('[') || line.includes('Error') || line.includes('error')) {
    process.stderr.write(data);
  }
});

handler.on('close', (code) => {
  const duration = Date.now() - startTime;
  
  console.log(`\n=== Test Results ===`);
  console.log(`Handler: ${handlerPath}`);
  console.log(`Duration: ${duration}ms`);
  console.log(`Exit code: ${code}`);
  console.log(`JSON received: ${hasJson ? 'YES ✓' : 'NO ✗'}`);
  
  if (!hasJson) {
    console.log(`\nNo JSON response received. This handler may not be working.`);
    if (error) {
      console.log(`\nErrors:\n${error}`);
    }
    if (output && !output.includes('{')) {
      console.log(`\nRaw output:\n${output.substring(0, 500)}`);
    }
  } else {
    console.log(`\n✓ Handler is working correctly!`);
  }
  
  process.exit(hasJson ? 0 : 1);
});

// Send test message
handler.stdin.write(testMessage);
handler.stdin.end();

// Timeout after 20 seconds
setTimeout(() => {
  console.log('\n✗ Test timeout after 20 seconds');
  handler.kill();
}, 20000);
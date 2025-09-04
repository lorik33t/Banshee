#!/usr/bin/env node

import { spawn } from 'node-pty';
import { writeFileSync } from 'fs';

console.log('=== Claude CLI Diagnostic Tool ===\n');
console.log('This will capture exactly what Claude outputs on startup.');
console.log('Output will be saved to claude-diagnostic.log\n');

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

let allOutput = '';
let outputLog = [];
const startTime = Date.now();

console.log('Claude process started. Capturing output for 5 seconds...\n');

// Capture all output with timestamps
claude.on('data', (data) => {
  const timestamp = Date.now() - startTime;
  const entry = {
    timestamp: timestamp,
    data: data,
    hex: Buffer.from(data).toString('hex'),
    chars: data.split('').map(c => ({
      char: c,
      code: c.charCodeAt(0),
      hex: c.charCodeAt(0).toString(16)
    }))
  };
  
  outputLog.push(entry);
  allOutput += data;
  
  // Show real-time output
  console.log(`[${timestamp}ms] RAW:`, JSON.stringify(data));
  console.log(`[${timestamp}ms] HEX:`, entry.hex.substring(0, 100), '...\n');
});

// Try sending Enter at various intervals
const intervals = [50, 100, 200, 500, 1000, 1500, 2000];
intervals.forEach(ms => {
  setTimeout(() => {
    console.log(`\n[${ms}ms] Sending Enter (\\r)...`);
    claude.write('\r');
    outputLog.push({
      timestamp: ms,
      action: 'SENT_ENTER',
      data: '\\r'
    });
  }, ms);
});

// After 5 seconds, analyze and save results
setTimeout(() => {
  console.log('\n=== ANALYSIS ===\n');
  
  // Check for common prompt patterns
  const promptPatterns = [
    { pattern: /Enter to confirm/i, name: 'Enter to confirm' },
    { pattern: /Press Enter/i, name: 'Press Enter' },
    { pattern: /permission/i, name: 'Permission' },
    { pattern: /security/i, name: 'Security' },
    { pattern: /\?[\s]*$/, name: 'Question mark ending' },
    { pattern: /:[\s]*$/, name: 'Colon ending' },
    { pattern: />[\s]*$/, name: 'Greater than ending' },
    { pattern: /→/, name: 'Arrow prompt' },
    { pattern: /❯/, name: 'Chevron prompt' },
    { pattern: /╭─/, name: 'Box drawing' }
  ];
  
  console.log('Detected patterns:');
  promptPatterns.forEach(({ pattern, name }) => {
    if (pattern.test(allOutput)) {
      console.log(`  ✓ ${name}`);
    }
  });
  
  // Find where output pauses (likely waiting for input)
  console.log('\nOutput pauses (potential prompts):');
  let lastTimestamp = 0;
  outputLog.forEach(entry => {
    if (entry.timestamp && entry.data) {
      const gap = entry.timestamp - lastTimestamp;
      if (gap > 100 && lastTimestamp > 0) {
        console.log(`  - ${gap}ms pause at ${lastTimestamp}ms`);
      }
      lastTimestamp = entry.timestamp;
    }
  });
  
  // Save detailed log
  const report = {
    startTime: new Date(startTime).toISOString(),
    totalDuration: Date.now() - startTime,
    totalOutput: allOutput,
    totalLength: allOutput.length,
    entries: outputLog,
    analysis: {
      hasJson: allOutput.includes('"type"'),
      promptsDetected: promptPatterns.filter(p => p.pattern.test(allOutput)).map(p => p.name),
      firstCharCodes: allOutput.substring(0, 50).split('').map(c => c.charCodeAt(0))
    }
  };
  
  writeFileSync('claude-diagnostic.log', JSON.stringify(report, null, 2));
  console.log('\nDiagnostic complete! Check claude-diagnostic.log for full details.');
  
  // Send test message
  console.log('\nSending test message...');
  claude.write('Hello, Claude! This is a test.\r');
  
  // Wait a bit more for response
  setTimeout(() => {
    claude.kill();
    process.exit(0);
  }, 2000);
}, 5000);

// Handle exit
claude.on('exit', (code) => {
  console.log(`\nClaude exited with code: ${code}`);
});
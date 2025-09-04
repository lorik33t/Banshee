#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track modified files during this session
const modifiedFiles = new Map();

// Tools that trigger checkpoints
const CHECKPOINT_TOOLS = ['write', 'edit', 'delete', 'move', 'bash'];
const DESTRUCTIVE_BASH_PATTERNS = [
  /rm\s+/,
  /mv\s+/,
  /cp\s+/,
  />>/,
  />/,
  /git\s+(reset|revert|clean)/,
  /npm\s+(install|update|uninstall)/,
  /yarn\s+(add|remove|upgrade)/
];

// Check if a tool use should trigger a checkpoint
function shouldCheckpoint(event) {
  if (!event.tool_use) return false;
  
  const tool = event.tool_use.name?.toLowerCase();
  
  // Always checkpoint for file modification tools
  if (CHECKPOINT_TOOLS.includes(tool)) {
    // For bash commands, check if they're destructive
    if (tool === 'bash') {
      const command = event.tool_use.input?.command || '';
      return DESTRUCTIVE_BASH_PATTERNS.some(pattern => pattern.test(command));
    }
    return true;
  }
  
  return false;
}

// Track file changes
function trackFileChange(toolName, input) {
  if (toolName === 'write' || toolName === 'edit') {
    const filePath = input.file_path || input.path;
    if (filePath) {
      // Save original content if not already tracked
      if (!modifiedFiles.has(filePath)) {
        try {
          const originalContent = fs.existsSync(filePath) 
            ? fs.readFileSync(filePath, 'utf8')
            : '';
          modifiedFiles.set(filePath, {
            path: filePath,
            originalContent,
            firstModified: Date.now()
          });
        } catch (e) {
          // File might not exist yet or not readable
        }
      }
    }
  }
}

// Get current file snapshots
function getFileSnapshots() {
  const snapshots = [];
  
  for (const [filePath, info] of modifiedFiles.entries()) {
    try {
      const currentContent = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, 'utf8')
        : '';
      
      snapshots.push({
        path: filePath,
        originalContent: info.originalContent,
        currentContent
      });
    } catch (e) {
      // Skip files that can't be read
    }
  }
  
  return snapshots;
}

// Create checkpoint event
function createCheckpointEvent(trigger, toolName) {
  return {
    type: 'checkpoint:create',
    trigger: `${toolName}: ${trigger}`,
    fileSnapshots: getFileSnapshots(),
    timestamp: new Date().toISOString()
  };
}

// Wrap the original handler with checkpoint logic
export function wrapWithCheckpoint(originalHandler) {
  // Read input from stdin
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  
  process.stdin.on('end', () => {
    try {
      const parsedInput = JSON.parse(input);
      
      // Check if we need to create a checkpoint
      let checkpointCreated = false;
      
      // Look for tool use events in the stream
      if (parsedInput.events) {
        for (const event of parsedInput.events) {
          if (shouldCheckpoint(event)) {
            // Emit checkpoint event
            const checkpointEvent = createCheckpointEvent(
              event.tool_use.input?.command || event.tool_use.input?.file_path || 'unknown',
              event.tool_use.name
            );
            process.stdout.write(JSON.stringify(checkpointEvent) + '\n');
            checkpointCreated = true;
            
            // Track file changes
            trackFileChange(event.tool_use.name, event.tool_use.input || {});
            break; // Only create one checkpoint per batch
          }
        }
      }
      
      // Pass through to original handler
      const handler = spawn('node', [path.join(__dirname, originalHandler)], {
        cwd: process.cwd()
      });
      
      // Forward input to handler
      handler.stdin.write(JSON.stringify(parsedInput));
      handler.stdin.end();
      
      // Forward output from handler
      handler.stdout.on('data', (data) => {
        process.stdout.write(data);
      });
      
      handler.stderr.on('data', (data) => {
        process.stderr.write(data);
      });
      
      handler.on('close', (code) => {
        process.exit(code || 0);
      });
      
    } catch (e) {
      // If not JSON or error, pass through directly
      const handler = spawn('node', [path.join(__dirname, originalHandler)], {
        cwd: process.cwd()
      });
      
      handler.stdin.write(input);
      handler.stdin.end();
      
      handler.stdout.on('data', (data) => {
        process.stdout.write(data);
      });
      
      handler.stderr.on('data', (data) => {
        process.stderr.write(data);
      });
      
      handler.on('close', (code) => {
        process.exit(code || 0);
      });
    }
  });
}

// If called directly, wrap claude-handler.js
if (process.argv[1] === __filename) {
  wrapWithCheckpoint('claude-handler.js');
}
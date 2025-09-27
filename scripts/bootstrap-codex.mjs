#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const codexDir = resolve(root, 'vendors', 'codex');

if (!existsSync(codexDir)) {
  console.warn('[codex bootstrap] vendors/codex not present. Skip bootstrap.');
  process.exit(0);
}

if (!existsSync(resolve(codexDir, 'package.json'))) {
  console.warn('[codex bootstrap] vendors/codex does not look like the Codex repo (missing package.json). Skip.');
  process.exit(0);
}

console.log('[codex bootstrap] installing Codex dependencies...');

const install = spawn('npm', ['install'], {
  cwd: codexDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

install.on('close', (code) => {
  if (code !== 0) {
    console.error(`[codex bootstrap] npm install exited with code ${code}`);
    process.exit(code ?? 1);
  }

  console.log('[codex bootstrap] Codex dependencies installed.');
});

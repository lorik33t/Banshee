import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { stdin, stdout, execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const codexScript = resolve(__dirname, '..', 'vendors', 'codex', 'codex-cli', 'bin', 'codex.js');

const child = spawn(execPath, [codexScript, 'proto'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
  },
});

child.stderr.on('data', (chunk) => {
  stdout.write(`[codex stderr] ${chunk}`);
});

const codexRl = createInterface({ input: child.stdout });
codexRl.on('line', (line) => {
  console.log('[codex]', line);
});

const inputRl = createInterface({ input: stdin });
inputRl.on('line', (line) => {
  child.stdin.write(`${line}\n`);
});

child.on('close', (code) => {
  console.log(`[codex exited] code=${code}`);
  process.exit(code ?? 0);
});

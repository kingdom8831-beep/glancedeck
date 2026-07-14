import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('Skipping the macOS AppKit helper on this platform.');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('swiftc', [
  '-O',
  '-framework', 'AppKit',
  path.join(root, 'native', 'GlanceDeckMenuBar.swift'),
  '-o', path.join(root, 'build', 'GlanceDeckMenuBar'),
], { stdio: 'inherit' });

process.exit(result.status ?? 1);

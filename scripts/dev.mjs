import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = process.platform === 'win32' ? 'node_modules\\.bin\\electron.cmd' : 'node_modules/.bin/electron';

const vite = spawn(npmCommand, ['exec', 'vite'], {
  stdio: 'inherit',
  env: process.env,
});

async function waitForVite() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:5173');
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite dev server did not start in time.');
}

try {
  await waitForVite();
  const electron = spawn(electronCommand, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
  });

  electron.on('exit', (code) => {
    vite.kill('SIGTERM');
    process.exit(code ?? 0);
  });
} catch (error) {
  vite.kill('SIGTERM');
  console.error(error);
  process.exit(1);
}

import { mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'docs', 'screenshots');
const profileDir = path.join(root, '.capture-profile');

const shots = [
  { file: 'widget-glass.png', selected: '0.300750', delay: 7000 },
  { file: 'kline-workspace.png', panel: 'chart', mode: 'kline', selected: '0.300750', solid: true, delay: 9000 },
  { file: 'capital-flow.png', panel: 'chart', mode: 'funds', selected: '0.300750', solid: true, delay: 10000 },
  { file: 'ai-decision-chain.png', panel: 'chart', mode: 'ai', selected: '0.300750', history: true, endpoint: 'http://127.0.0.1:11434/v1', delay: 7000 },
  { file: 'holdings-alerts.png', panel: 'holdings', holdings: true, solid: true, delay: 8000 },
  { file: 'weather-forecast.png', panel: 'weather', delay: 8000 },
  { file: 'settings-reliability.png', panel: 'settings', section: 'alerts', holdings: true, solid: true, delay: 7000 },
];

rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

function capture(shot) {
  const capturePath = path.join(outputDir, shot.file);
  const env = {
    ...process.env,
    FLOATDECK_CAPTURE_PATH: capturePath,
    FLOATDECK_CAPTURE_USER_DATA: profileDir,
    FLOATDECK_CAPTURE_THEME: 'glass',
    FLOATDECK_CAPTURE_WEATHER_MANUAL: '1',
    FLOATDECK_CAPTURE_DELAY: String(shot.delay),
    ...(shot.panel ? { FLOATDECK_CAPTURE_PANEL: shot.panel } : {}),
    ...(shot.mode ? { FLOATDECK_CAPTURE_CHART_MODE: shot.mode } : {}),
    ...(shot.section ? { FLOATDECK_CAPTURE_SETTINGS_SECTION: shot.section } : {}),
    ...(shot.history ? { FLOATDECK_CAPTURE_AI_HISTORY: '1' } : {}),
    ...(shot.holdings ? { FLOATDECK_CAPTURE_SAMPLE_HOLDINGS: '1' } : {}),
    ...(shot.endpoint ? { FLOATDECK_CAPTURE_AI_ENDPOINT: shot.endpoint } : {}),
    ...(shot.selected ? { FLOATDECK_CAPTURE_SELECTED_SECID: shot.selected } : {}),
    ...(shot.solid ? { FLOATDECK_CAPTURE_SOLID: '1' } : {}),
  };

  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, ['.'], { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${shot.file} capture exited with ${code}`)));
  });
}

const requestedFiles = new Set(process.argv.slice(2));
const selectedShots = requestedFiles.size ? shots.filter((shot) => requestedFiles.has(shot.file)) : shots;
if (!selectedShots.length) throw new Error(`No matching screenshot: ${[...requestedFiles].join(', ')}`);

for (const shot of selectedShots) {
  console.log(`Capturing ${shot.file}`);
  await capture(shot);
}

rmSync(profileDir, { recursive: true, force: true });
console.log(`Saved ${selectedShots.length} screenshot${selectedShots.length === 1 ? '' : 's'} to ${outputDir}`);

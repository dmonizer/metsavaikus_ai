import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'vite';

// Uses an installed Chrome/Chromium; CHROME_BIN overrides automatic discovery.
const chrome =
  process.env.CHROME_BIN ??
  [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
if (!chrome) throw new Error('Set CHROME_BIN to an installed Chrome or Chromium executable.');
const profile = await mkdtemp(join(tmpdir(), 'metsavaikus-render-tests-'));
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
try {
  await server.listen();
  const { port } = server.httpServer.address();
  const { stdout } = await promisify(execFile)(
    chrome,
    [
      '--headless',
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      '--virtual-time-budget=10000',
      `http://127.0.0.1:${port}/tests/shelter-rendering.html`,
    ],
    { timeout: 60000, maxBuffer: 2 * 1024 * 1024 }
  );
  const result = stdout.match(/<pre id="results" data-status="([^"]+)">([\s\S]*?)<\/pre>/);
  if (!result || result[1] !== 'passed') throw new Error(result?.[2] ?? stdout);
  console.log('Shelter GPU rendering checks passed:\n' + result[2]);
} finally {
  await server.close();
  await rm(profile, { recursive: true, force: true });
}

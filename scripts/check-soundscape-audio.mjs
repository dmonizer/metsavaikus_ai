import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const chrome = process.env.CHROME_BIN ?? [
  '/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
if (!chrome) throw new Error('Set CHROME_BIN to an installed Chrome or Chromium executable.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const profile = await mkdtemp(join(tmpdir(), 'metsavaikus-audio-tests-'));
let browser;
try {
  await server.listen();
  // CDP uses real completion rather than a virtual-time deadline: audio decoding
  // and OfflineAudioContext rendering finish asynchronously on worker threads.
  browser = spawn(chrome, [
    '--headless', '--no-sandbox', `--user-data-dir=${profile}`, '--remote-debugging-pipe',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let nextId = 0, buffer = '';
  const pending = new Map();
  browser.stdio[4].on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome timed out: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.navigate', {
    url: `http://127.0.0.1:${server.httpServer.address().port}/tests/soundscape-audio.html`,
  }, sessionId);
  const deadline = Date.now() + 45000;
  let result;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const response = await send('Runtime.evaluate', {
      expression: "JSON.stringify({status:document.getElementById('results')?.dataset.status,text:document.getElementById('results')?.textContent})",
      returnByValue: true,
    }, sessionId);
    result = JSON.parse(response.result.value);
  } while (result.status !== 'passed' && result.status !== 'failed' && Date.now() < deadline);
  if (result.status !== 'passed') throw new Error(result.text || 'Audio checks did not finish.');
  console.log('Soundscape waveform checks passed:\n' + result.text);
} finally {
  if (browser && browser.exitCode === null) {
    const closed = new Promise((resolve) => browser.once('exit', resolve));
    browser.kill();
    await closed;
  }
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

// An isolated browser and a private DevTools pipe, shared by fixtures and the replay.
export async function openChrome(flags) {
  const executable = process.env.CHROME_BIN ?? [
    '/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find(existsSync);
  if (!executable) throw new Error('Set CHROME_BIN to an installed Chrome or Chromium executable.');
  const profile = await mkdtemp(join(tmpdir(), 'metsavaikus-chrome-'));
  const browser = spawn(executable, [...flags, '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const pending = new Map();
  const events = new EventEmitter();
  let nextId = 0;
  let buffer = '';
  let failure;
  const closed = new Promise(resolve => browser.once('close', resolve));
  function fail(error) {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  browser.on('error', fail);
  browser.once('exit', () => fail(new Error('Chrome exited')));
  browser.stdio[3].on('error', fail);
  browser.stdio[4].setEncoding('utf8').on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (!message.id) { events.emit(message.method, message.params); continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });

  function send(method, params = {}, sessionId) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Chrome timed out: ' + method));
      }, 60_000);
      pending.set(id, {
        resolve(value) { clearTimeout(timer); resolve(value); },
        reject(error) { clearTimeout(timer); reject(error); },
      });
      browser.stdio[3].write(JSON.stringify({ id, sessionId, method, params }) + '\0');
    });
  }
  let closing;
  function close() {
    if (!closing) {
      browser.kill();
      closing = closed.then(() => rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    }
    return closing;
  }
  try {
    const { targetInfos } = await send('Target.getTargets');
    const target = targetInfos.find(target => target.type === 'page');
    const { targetId } = target ?? await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    return { send: (method, params) => send(method, params, sessionId), events, close };
  } catch (error) { await close(); throw error; }
}

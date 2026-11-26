import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// geckodriver creates a temporary Firefox profile; the user's profile is never used.
// Browser UI access is needed to assert that Firefox's actual find bar stays closed.
const driver = process.env.GECKODRIVER_BIN ?? 'geckodriver';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
const probe = createTcpServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
let processError;
const browser = spawn(driver, ['--port', String(port), '--allow-system-access', '--log', 'warn'], {
  stdio: ['ignore', 'ignore', 'ignore'],
});
browser.on('error', error => { processError = error; });
const base = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let session;

async function request(method, path, body) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(40000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result.value));
  return result.value;
}
const command = (method, path, body) => request(method, `/session/${session}${path}`, body);
const evaluate = script => command('POST', '/execute/sync', { script, args: [] });
async function keys(...values) {
  await command('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard',
    actions: values.flatMap(value => [{ type: 'keyDown', value }, { type: 'keyUp', value }]),
  }] });
}
async function findBar(close = false) {
  await command('POST', '/moz/context', { context: 'chrome' });
  try {
    return await evaluate(`const bar=gBrowser.getCachedFindBar();
      const result={opened:!!bar&&!bar.hidden,query:bar?._findField?.value};
      ${close ? 'bar?.close();' : ''} return result;`);
  } finally { await command('POST', '/moz/context', { context: 'content' }); }
}

try {
  for (let attempt = 0; ; attempt++) {
    if (processError) throw new Error(`Cannot start ${driver}; set GECKODRIVER_BIN to geckodriver. ${processError.message}`);
    try { await request('GET', '/status'); break; }
    catch (error) { if (attempt >= 100) throw error; await delay(100); }
  }
  await server.listen();
  const result = await request('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'firefox', 'moz:firefoxOptions': {
      args: ['-headless'], ...(process.env.FIREFOX_BIN ? { binary: process.env.FIREFOX_BIN } : {}),
      prefs: {
        'accessibility.typeaheadfind': true,
        'accessibility.typeaheadfind.autostart': true,
        'accessibility.typeaheadfind.manual': true,
      },
    },
  } } });
  session = result.sessionId;
  await command('POST', '/url', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/keyboard-input.html` });
  for (let attempt = 0; !await evaluate('return !!window.keyboardTest?.ready;'); attempt++) {
    if (attempt >= 100) throw new Error('Keyboard fixture did not load');
    await delay(50);
  }

  // Prove the preference really enables the reported failure, rather than testing
  // against WebDriver's usual defaults that disable browser find-as-you-type.
  await evaluate("keyboardTest.enabled=false;document.getElementById('world').focus();");
  await keys('w');
  assert.equal((await findBar()).opened, true, 'control: uncancelled W must open Firefox quick find');
  await findBar(true);

  await evaluate("keyboardTest.enabled=true;keyboardTest.handled=[];document.getElementById('world').focus();");
  await keys('w', 'a', 's', 'd');
  assert.equal((await findBar()).opened, false, 'WASD must not open browser find');
  assert.deepEqual(await evaluate('return keyboardTest.handled;'), ['KeyW', 'KeyA', 'KeyS', 'KeyD']);
  assert.ok((await evaluate('return keyboardTest.events.slice(-4);')).every(event => event.trusted && event.prevented));

  for (const id of ['text', 'config', 'editable']) {
    await evaluate(`keyboardTest.handled=[];document.getElementById('${id}').focus();`);
    await keys('w', 'a', 's', 'd');
    assert.equal(await evaluate(`const node=document.getElementById('${id}');return node.value??node.textContent;`), 'wasd');
    assert.deepEqual(await evaluate('return keyboardTest.handled;'), []);
    assert.equal((await findBar()).opened, false);
  }
  await evaluate("keyboardTest.handled=[];document.getElementById('button').focus();");
  await keys(' ');
  assert.equal(await evaluate('return keyboardTest.buttonClicks;'), 1);
  assert.deepEqual(await evaluate('return keyboardTest.handled;'), []);
  await evaluate("document.getElementById('select').focus();");
  await keys('\uE015'); // ArrowDown
  assert.equal(await evaluate("return document.getElementById('select').selectedIndex;"), 1);

  await evaluate("keyboardTest.handled=[];document.getElementById('world').focus();");
  await command('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [
    { type: 'keyDown', value: '\uE009' }, { type: 'keyDown', value: 'f' },
    { type: 'keyUp', value: 'f' }, { type: 'keyUp', value: '\uE009' },
  ] }] });
  // WebDriver delivers the shortcut to content without invoking Firefox's UI
  // accelerator. Verify the app leaves this trusted modified event uncancelled.
  const shortcutEvents = await evaluate('return keyboardTest.events.slice(-2);');
  assert.ok(shortcutEvents.some(event => event.code === 'KeyF' && event.ctrl && event.trusted && !event.prevented));
  assert.deepEqual(await evaluate('return keyboardTest.handled;'), []);
  console.log(`Firefox ${result.capabilities.browserVersion}: quick-find control reproduced; WASD capture, text editors, buttons, selectors and uncancelled Ctrl+F passed.`);
} finally {
  if (session) await request('DELETE', `/session/${session}`).catch(() => {});
  if (browser.exitCode === null && !processError) {
    const closed = new Promise(resolve => browser.once('exit', resolve));
    browser.kill();
    await closed;
  }
  await server.close();
}

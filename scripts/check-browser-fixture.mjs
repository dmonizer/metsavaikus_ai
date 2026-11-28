import { openChrome } from './chrome-session.mjs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Both fixtures publish their real completion in #results after asynchronous browser work.
export async function checkBrowserFixture(page, label, chromeFlags = []) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } });
  let browser;
  try {
    await server.listen();
    browser = await openChrome(['--headless', '--no-sandbox', ...chromeFlags]);
    const { send } = browser;
    await send('Page.navigate', {
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/${page}`,
    });
    const deadline = Date.now() + 90000;
    let result;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const response = await send('Runtime.evaluate', {
        expression: "JSON.stringify({status:document.getElementById('results')?.dataset.status,text:document.getElementById('results')?.textContent})",
        returnByValue: true,
      });
      result = JSON.parse(response.result.value);
    } while (result.status !== 'passed' && result.status !== 'failed' && Date.now() < deadline);
    if (result.status !== 'passed') throw new Error(result.text || `${label} did not finish.`);
    console.log(label + ' passed:\n' + result.text);
  } finally {
    await browser?.close();
    await server.close();
  }
}

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
await mkdir('.local', { recursive: true });
const fixtures = JSON.parse(await readFile('tests/fixtures/c3d.json', 'utf8'));
await writeFile('.local/synthetic.c3d', Buffer.from(fixtures.intelFloat, 'base64'));
const h5Fixture = JSON.parse(await readFile('tests/fixtures/h5.json', 'utf8'));
await writeFile('.local/synthetic.h5', Buffer.from(h5Fixture.base64, 'base64'));
const development = process.env.SMOKE_MODE === 'development';
const base =
  process.env.VITE_BASE_PATH && process.env.VITE_BASE_PATH !== './'
    ? process.env.VITE_BASE_PATH
    : '/';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    ...(development ? [] : ['preview']),
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { cwd: root, windowsHide: true, stdio: 'pipe' },
);
let browser;
let serverOutput = '';
const errors = [],
  requests = [];
server.stdout.on('data', (data) => {
  serverOutput += String(data);
});
server.stderr.on('data', (data) => {
  serverOutput += String(data);
});
try {
  await new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error('Preview server timeout')), 20000);
    server.stdout.on('data', (data) => {
      if (String(data).includes('4173')) {
        clearTimeout(timeout);
        ok();
      }
    });
    server.on('error', fail);
    server.on('exit', (code) => {
      if (code) fail(new Error(`Preview exited: ${code}`));
    });
  });
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text());
  });
  page.on('request', (request) =>
    requests.push({ url: request.url(), method: request.method(), body: request.postData() }),
  );
  await page.goto(`http://127.0.0.1:4173${base}`);
  await page.getByText('Explore the synthetic demo').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(180);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert(
    Number(await page.getByRole('slider', { name: 'Frame', exact: true }).inputValue()) > 0,
    'playback advances',
  );
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await page.getByLabel('Search markers').fill('RASI');
  await page.getByRole('button', { name: 'RASI', exact: true }).click();
  assert.equal(await page.locator('.selected-marker h3').textContent(), 'RASI');
  await page.getByLabel('Show RASI', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByLabel('Search markers').fill('');
  const plotBox = await page.locator('.u-over').boundingBox();
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(await page.getByRole('slider', { name: 'Frame', exact: true }).inputValue()) > 150,
    'plot scrubbing changes timeline',
  );
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  await page.getByLabel('Marker labels', { exact: true }).check();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.screenshot({ path: '.local/screenshot.png' });
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/synthetic.c3d'));
  await page.waitForFunction(
    () =>
      document.body.textContent.includes('synthetic.c3d') &&
      !document.body.textContent.includes('Reading your recording'),
  );
  assert.equal(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('max'),
    '2',
  );
  const privatePaths = ['03_PRE_GANG12_01.c3d', '03_PRE_GANG12_01.h5', 'virtual_marker.h5']
    .map((n) => resolve('../ibo-biomech', n))
    .filter(existsSync);
  for (const path of [resolve('.local/synthetic.h5'), ...privatePaths]) {
    await page.getByLabel('Open motion file').setInputFiles(path);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0, 'reference file loads without error');
    assert(
      Number(await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('max')) >=
        2,
    );
    await page.getByRole('button', { name: 'Jump to end', exact: true }).click();
    await page.getByRole('button', { name: 'Jump to beginning', exact: true }).click();
  }
  // Bad file must leave the previous usable trial in place.
  assert.deepEqual(errors, [], 'no runtime/CSP errors while opening valid files');
  await page.getByLabel('Open motion file').setInputFiles({
    name: 'broken.c3d',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  assert.equal(await page.getByRole('slider', { name: 'Frame', exact: true }).count(), 1);
  const unexpectedErrors = errors.filter(
    (message) => !(development && message.startsWith('Error: Invalid C3D header.')),
  );
  assert.deepEqual(unexpectedErrors, [], 'no unexpected runtime/CSP errors');
  for (const request of requests) {
    const url = new URL(request.url);
    assert.equal(url.origin, 'http://127.0.0.1:4173');
    assert.equal(request.method, 'GET');
    assert.equal(request.body, null);
    if (!development) {
      assert(url.pathname.startsWith(base));
      const path = url.pathname.slice(base.length);
      assert(
        path === '' || path === 'icon.svg' || /^assets\/[\w.-]+\.(js|css)$/.test(path),
        `unexpected request ${url.pathname}`,
      );
      assert.equal(url.search, '');
    }
  }
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    caches: await caches.keys(),
    databases: await indexedDB.databases(),
  }));
  assert.deepEqual(storage, { local: 0, session: 0, caches: [], databases: [] });
  await writeFile(
    `.local/browser-report${development ? '-dev' : base === '/' ? '' : '-subpath'}.json`,
    JSON.stringify(
      {
        passed: true,
        development,
        base,
        runtimeErrors: unexpectedErrors,
        expectedDeveloperErrors: errors.filter((message) => !unexpectedErrors.includes(message)),
        requests: requests.map((r) => new URL(r.url).pathname),
        storage,
        privateFilesChecked: privatePaths.length,
      },
      null,
      2,
    ),
  );
  console.log(
    'Browser smoke passed: demo controls, local C3D/H5, errors, static-only traffic and no persistence.',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  await writeFile(
    '.local/browser-failure.json',
    JSON.stringify(
      {
        error: String(error),
        errors,
        serverOutput,
        body: page ? await page.locator('body').innerText() : '',
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill();
}

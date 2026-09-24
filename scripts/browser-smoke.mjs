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
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) > 0,
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
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) > 150,
    'plot scrubbing changes timeline',
  );
  const plotFrame = page.getByRole('slider', { name: 'Frame', exact: true });
  const frameBeforeZoom = await plotFrame.getAttribute('aria-valuenow');
  await page.mouse.move(plotBox.x + plotBox.width * 0.2, plotBox.y + plotBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.4, plotBox.y + plotBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  assert.equal(
    await plotFrame.getAttribute('aria-valuenow'),
    frameBeforeZoom,
    'zoom does not scrub',
  );
  await page.mouse.click(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  const zoomedFrame = Number(await plotFrame.getAttribute('aria-valuenow'));
  assert(zoomedFrame > 95 && zoomedFrame < 120, 'click uses the zoomed time range');
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(await plotFrame.getAttribute('aria-valuenow')) > 200,
    'reset restores full time range',
  );
  await page.mouse.move(plotBox.x + plotBox.width * 0.2, plotBox.y + plotBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.4, plotBox.y + plotBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  await page.mouse.dblclick(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(Number(await plotFrame.getAttribute('aria-valuenow')) > 200, 'double-click resets zoom');
  const beforeWheel = await plotFrame.getAttribute('aria-valuenow');
  await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  assert.equal(
    await plotFrame.getAttribute('aria-valuenow'),
    beforeWheel,
    'wheel zoom does not scrub',
  );
  await page.mouse.click(plotBox.x + plotBox.width * 0.75, plotBox.y + plotBox.height * 0.5);
  const wheelZoomed = Number(await plotFrame.getAttribute('aria-valuenow'));
  assert(wheelZoomed > 205 && wheelZoomed < 240, 'wheel zooms in around pointer');
  await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(100);
  await page.mouse.click(plotBox.x + plotBox.width * 0.75, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(await plotFrame.getAttribute('aria-valuenow')) > 260,
    'wheel zooms out to full range',
  );
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  const sidebarFrame = Number(await plotFrame.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    Number(await plotFrame.getAttribute('aria-valuenow')),
    sidebarFrame - 1,
    'frame shortcuts work after clicking a sidebar tab',
  );
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
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
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
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
      Number(
        await page
          .getByRole('slider', { name: 'Frame', exact: true })
          .getAttribute('aria-valuemax'),
      ) >= 2,
    );
    await page.getByRole('button', { name: 'Jump to end', exact: true }).click();
    await page.getByRole('button', { name: 'Jump to beginning', exact: true }).click();
  }
  // Actual worker export/download/re-import, with request and storage monitoring still active.
  for (const extension of ['c3d', 'h5']) {
    await page
      .getByLabel('Open motion file')
      .setInputFiles(resolve(`.local/synthetic.${extension}`));
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(
      await page.locator('.timeline input[type="number"]').count(),
      0,
      'no crop frame inputs',
    );
    const start = page.getByRole('slider', { name: 'Crop start', exact: true });
    const end = page.getByRole('slider', { name: 'Crop end', exact: true });
    await start.press('End');
    await end.press('Home');
    assert.equal(await start.getAttribute('aria-valuenow'), '2');
    assert.equal(await end.getAttribute('aria-valuenow'), '3', 'handles cannot cross');
    await page.getByRole('button', { name: 'Cancel crop', exact: true }).click();
    assert.equal(await start.getAttribute('aria-valuenow'), '0', 'cancel restores full range');
    const rail = await page.locator('.timeline-slider').boundingBox();
    const handle = await start.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 + rail.width / 3,
      handle.y + handle.height / 2,
      { steps: 8 },
    );
    const playhead = page.getByRole('slider', { name: 'Frame', exact: true });
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '1',
      'frame follows start handle while dragging',
    );
    await page.mouse.up();
    assert.equal(await start.getAttribute('aria-valuenow'), '1', 'drag adjusts start boundary');
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'frame shortcuts work after crop drag',
    );
    assert.equal(
      await start.getAttribute('aria-valuenow'),
      '1',
      'frame shortcut does not edit crop',
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    const endHandle = await end.boundingBox();
    await page.mouse.move(endHandle.x + endHandle.width / 2, endHandle.y + endHandle.height / 2);
    await page.mouse.down();
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'exclusive recording end previews last frame',
    );
    await page.mouse.move(
      endHandle.x + endHandle.width / 2 - rail.width / 3,
      endHandle.y + endHandle.height / 2,
      { steps: 8 },
    );
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'frame follows end handle while dragging',
    );
    await page.mouse.up();
    assert.equal(await end.getAttribute('aria-valuenow'), '2', 'end adjusts independently');
    await end.press('ArrowRight');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(80);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    assert(
      Number(
        await page
          .getByRole('slider', { name: 'Frame', exact: true })
          .getAttribute('aria-valuenow'),
      ) >= 1,
      'preview stays in crop range',
    );
    if (extension === 'h5') await page.screenshot({ path: '.local/crop-selection.png' });
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '1',
    );
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `synthetic_cropped.${extension}`);
    const downloaded = resolve(`.local/synthetic_cropped.${extension}`);
    await download.saveAs(downloaded);
    await page.getByRole('button', { name: 'Restore original', exact: true }).click();
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '2',
    );
    await page.getByLabel('Open motion file').setInputFiles(downloaded);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '1',
    );
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

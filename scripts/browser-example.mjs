import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { chooseExportFormat } from './browser-cross-format.mjs';

export async function verifyExampleFile(browser, base, development) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const events = [];
  const errors = [];
  const downloads = [];
  const analyticsURL = 'https://je-motion-analytics.jonasebbecke97.workers.dev/event';
  await page.route(analyticsURL, (route) => {
    const event = JSON.parse(route.request().postData()).event;
    assert.equal(route.request().postData(), JSON.stringify({ event }));
    events.push(event);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('.h5')) {
      assert.equal(request.method(), 'GET');
      assert.equal(request.postData(), null);
      downloads.push(request.url());
    }
    assert(
      [new URL(analyticsURL).origin, 'http://127.0.0.1:4173'].includes(
        new URL(request.url()).origin,
      ),
    );
  });
  try {
    await page.goto(`http://127.0.0.1:4173${base}`, { waitUntil: 'networkidle' });
    const button = page.getByRole('button', { name: 'Load Example File', exact: true });
    assert(await button.isVisible());
    // Development may request the asset URL module, but no H5 bytes until clicked.
    assert(downloads.every((url) => new URL(url).search.includes('import')));
    assert.deepEqual(events, ['visit']);
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route(/example_data.*\.h5(?:\?.*)?$/, async (route) => {
      await held;
      await route.continue();
    });
    const responsePromise = page.waitForResponse(
      (response) =>
        /example_data.*\.h5$/.test(new URL(response.url()).pathname) &&
        !new URL(response.url()).search.includes('import'),
    );
    await button.click();
    await page.getByRole('heading', { name: 'Loading example file', exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Loading example…', exact: true }).isDisabled());
    release();
    const response = await responsePromise;
    assert(response.ok());
    const expectedBytes = await readFile('reference-data/example_data.h5');
    const asset = await page.request.get(response.url());
    assert(asset.ok());
    assert((await asset.body()).equals(expectedBytes), 'served demo is byte-for-byte unchanged');
    await page.getByRole('slider', { name: 'Frame', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await button.count(), 0, 'demo button disappears after import');
    assert.equal(await page.locator('.scene-wrap canvas').count(), 1);
    assert.match(await page.locator('.header-file').innerText(), /example_data\.h5/);
    await page.getByRole('slider', { name: 'Frame', exact: true }).press('End');
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
      '393',
    );
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    await page.getByRole('region', { name: 'Data Explorer', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
    const cropStart = page.getByRole('slider', { name: 'Crop start', exact: true });
    await cropStart.press('ArrowRight');
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '392',
    );
    const exported = page.waitForEvent('download');
    await chooseExportFormat(page, 'H5');
    const download = await exported;
    assert.equal(download.suggestedFilename(), 'example_data_cropped.h5');
    assert.equal(await download.failure(), null, 'demo retains its source File for H5 export');
    await page.getByRole('button', { name: 'Restore original', exact: true }).click();
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '393',
    );
    assert.deepEqual(events, ['visit', 'h5_loaded'], 'exactly one event-only demo import event');
    if (!development) {
      const url = new URL(response.url());
      assert(url.pathname.startsWith(`${base}assets/`), 'asset follows the configured Vite base');
      const h5Assets = (await readdir('dist/assets')).filter((name) => name.endsWith('.h5'));
      assert.deepEqual(h5Assets, [url.pathname.split('/').at(-1)], 'only the demo H5 is built');
      assert((await readFile(`dist/assets/${h5Assets[0]}`)).equals(expectedBytes));
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

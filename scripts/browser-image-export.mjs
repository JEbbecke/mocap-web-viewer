import assert from 'node:assert/strict';

// Consume intercepted files in memory; no generated PNG artifacts are saved.
export async function captureSceneImage(page, sourceName, resolution, watermark) {
  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image', exact: true });
  await dialog.getByLabel('Image resolution', { exact: true }).selectOption(resolution);
  await dialog.getByLabel('Include JE Motion Lab watermark', { exact: true }).setChecked(watermark);
  const expected =
    resolution === '1080p'
      ? [1920, 1080]
      : resolution === '2160p'
        ? [3840, 2160]
        : await page
            .locator('.viewport canvas')
            .evaluate((canvas) => [canvas.width, canvas.height]);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const png = Buffer.concat(chunks);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'file is a PNG');
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.deepEqual(
    [png.readUInt32BE(16), png.readUInt32BE(20)],
    expected,
    'native export dimensions',
  );
  assert.equal(
    file.suggestedFilename(),
    `${sourceName.replace(/\.[^.]*$/, '')}_3d_${expected[0]}x${expected[1]}.png`,
  );
  await dialog.getByRole('status').filter({ hasText: 'Image exported.' }).waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await file.delete();
  return png;
}

async function imagePixels(page, png) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 128, 128);
    image.close();
    return Array.from(context.getImageData(0, 0, 128, 128).data);
  }, png.toString('base64'));
}

export async function verifyImageExport(page, sourceName) {
  const button = page.getByRole('button', { name: 'Export image', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Export image', exact: true });
  assert.equal(
    await dialog.getByLabel('Image resolution', { exact: true }).inputValue(),
    'viewport',
  );
  assert(await dialog.getByLabel('Include JE Motion Lab watermark', { exact: true }).isChecked());
  assert.deepEqual(await dialog.locator('option').allTextContents(), [
    'Current viewport',
    '1920 × 1080',
    '3840 × 2160',
  ]);
  await dialog.press('Escape');
  assert(
    await button.evaluate((node) => node === document.activeElement),
    'cancellation restores focus',
  );
  const before = await imageSessionUI(page);
  const plain = await captureSceneImage(page, sourceName, '1080p', false);
  const branded = await captureSceneImage(page, sourceName, '1080p', true);
  await captureSceneImage(page, sourceName, '2160p', false);
  await captureSceneImage(page, sourceName, 'viewport', false);
  assert.deepEqual(
    await imageSessionUI(page),
    before,
    'image export leaves frame, scientific edit state, history controls and viewport unchanged',
  );
  const a = await imagePixels(page, plain),
    b = await imagePixels(page, branded);
  assert.notDeepEqual(a, b, 'optional watermark changes the exported image');
  // Branding is confined to the bottom-right; scene content is identical elsewhere.
  assert.deepEqual(a.slice(0, 128 * 110 * 4), b.slice(0, 128 * 110 * 4));
  await verifyImageFailureHandling(page, sourceName);
  console.log(
    'Image export smoke passed: all resolutions, PNG/name, watermark, cancellation and session safety.',
  );
}

async function verifyImageFailureHandling(page, sourceName) {
  const before = await imageSessionUI(page);
  // Simulate an encoder allocation failure without depending on a particular GPU.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      HTMLCanvasElement.prototype.toBlob = original;
      callback(null);
    };
  });
  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image', exact: true });
  await dialog.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Image export failed.' }).waitFor();
  assert(await dialog.getByRole('button', { name: 'Export PNG', exact: true }).isEnabled());
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await captureSceneImage(page, sourceName, 'viewport', false);
  // Hold encoding briefly so a real Cancel action can interrupt the pending request.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__imageExportEncodingStarted = false;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = original;
      window.__imageExportEncodingStarted = true;
      original.call(this, (blob) => setTimeout(() => callback(blob), 1000), ...args);
    };
  });
  let exports = 0;
  const count = () => exports++;
  page.on('download', count);
  try {
    await page.getByRole('button', { name: 'Export image', exact: true }).click();
    await dialog.getByRole('button', { name: 'Export PNG', exact: true }).click();
    await page.waitForFunction(() => window.__imageExportEncodingStarted);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(1200);
    assert.equal(exports, 0, 'cancelling PNG encoding suppresses the local file export');
    assert.deepEqual(
      await imageSessionUI(page),
      before,
      'failure and cancellation preserve the viewer and scientific UI state',
    );
  } finally {
    page.off('download', count);
    await page.evaluate(() => {
      delete window.__imageExportEncodingStarted;
    });
  }
}

async function imageSessionUI(page) {
  return page.evaluate(() => ({
    frame: document
      .querySelector('[role="slider"][aria-label="Frame"]')
      ?.getAttribute('aria-valuenow'),
    file: document.querySelector('.header-file')?.textContent,
    undo: document.querySelector('[title^="Undo"]')?.disabled,
    redo: document.querySelector('[title^="Redo"]')?.disabled,
    canvas: [...document.querySelectorAll('.viewport canvas')].map((canvas) => [
      canvas.width,
      canvas.height,
    ]),
    display: [...document.querySelectorAll('.inspector input[type="checkbox"]')].map(
      (input) => input.checked,
    ),
  }));
}

export async function verifyMovingPlateImages(page, sourceName) {
  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  const plates = page.getByRole('checkbox', { name: 'Force plates', exact: true });
  await frame.press('Home');
  const first = await imagePixels(page, await captureSceneImage(page, sourceName, '1080p', false));
  await frame.press('ArrowRight');
  const second = await imagePixels(page, await captureSceneImage(page, sourceName, '1080p', false));
  assert.notDeepEqual(
    first,
    second,
    'exported plate geometry follows the current scientific frame',
  );
  await plates.uncheck();
  const empty = await imagePixels(page, await captureSceneImage(page, sourceName, '1080p', false));
  for (let i = 4; i < empty.length; i += 4)
    assert.deepEqual(
      empty.slice(i, i + 4),
      empty.slice(0, 4),
      'hidden scientific elements and DOM overlays are absent',
    );
  assert.notDeepEqual(second, empty, 'visible plate is rendered');
  await plates.check();
}

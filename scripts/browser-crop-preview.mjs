import assert from 'node:assert/strict';
import { resolve } from 'node:path';

async function middleCrop(page) {
  const start = page.getByRole('slider', { name: 'Crop start', exact: true });
  await start.press('Home');
  for (let i = 0; i < 5; i++) await start.press('ArrowRight');
  const end = page.getByRole('slider', { name: 'Crop end', exact: true });
  await end.press('Home');
  for (let i = 0; i < 9; i++) await end.press('ArrowRight');
}

export async function verifyCropPreview(page) {
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/model-aligned.h5'));
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  const primary = page.getByLabel('Signal to plot', { exact: true });
  await primary.selectOption('analog:0');
  const split = page.getByRole('button', { name: 'Split plots', exact: true });
  if ((await split.getAttribute('aria-pressed')) !== 'true') await split.click();
  await page.getByLabel('Second signal to plot', { exact: true }).selectOption('ik:0');
  await page.locator('.signal-pane').nth(1).locator('.u-legend').getByText(/IK ·/).waitFor();
  assert.equal(await page.locator('.plot-crop-muted:visible').count(), 0);
  await middleCrop(page);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.plot-crop-muted')].filter((el) => !el.hidden).length === 4,
  );
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  const search = explorer.getByLabel('Search explorer datasets');
  await search.fill('Analog');
  await explorer.locator('nav button').first().click();
  await explorer.locator('th').last().getByRole('button').click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.plot-crop-muted')].filter((el) => !el.hidden).length === 2,
  );
  assert.equal(Number(await page.locator('.plot-crop-before').getAttribute('data-end')), 0.05);
  assert.equal(Number(await page.locator('.plot-crop-after').getAttribute('data-start')), 0.15);
  const cursor = page.locator('.playhead');
  const initialCursor = await cursor.evaluate((el) => el.style.left);
  await page.getByRole('slider', { name: 'Frame', exact: true }).press('Home');
  await page.getByRole('slider', { name: 'Frame', exact: true }).press('ArrowRight');
  assert.notEqual(
    await cursor.evaluate((el) => el.style.left),
    initialCursor,
    'Explorer shares global cursor',
  );
  const explorerOver = page.locator('#signal-panel .u-over');
  const explorerBox = await explorerOver.boundingBox();
  await page.mouse.click(
    explorerBox.x + explorerBox.width * 0.1,
    explorerBox.y + explorerBox.height / 2,
  );
  assert(
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) < 5,
    'Explorer chart click scrubs outside the crop region',
  );
  await page.mouse.move(
    explorerBox.x + explorerBox.width / 2,
    explorerBox.y + explorerBox.height / 2,
  );
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(
    () => Number(document.querySelector('.plot-crop-before').dataset.start) > 0,
  );
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('.plot-crop-before').dataset.start) === 0,
  );
  await search.fill('IK Results');
  await explorer.locator('nav button').first().click();
  await explorer.locator('th').last().getByRole('button').click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.plot-crop-muted')].filter((el) => !el.hidden).length === 2,
  );
  assert.equal(Number(await page.locator('.plot-crop-before').getAttribute('data-end')), 0.05);
  assert.equal(Number(await page.locator('.plot-crop-after').getAttribute('data-start')), 0.15);
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.plot-crop-muted')].filter((el) => !el.hidden).length === 4,
  );
  for (const pane of [page.locator('.signal-pane').first(), page.locator('.signal-pane').nth(1)]) {
    assert.equal(Number(await pane.locator('.plot-crop-before').getAttribute('data-end')), 0.05);
    assert.equal(Number(await pane.locator('.plot-crop-after').getAttribute('data-start')), 0.15);
    assert(
      await pane
        .locator('.plot-crop-muted')
        .evaluateAll((els) => els.every((el) => getComputedStyle(el).pointerEvents === 'none')),
    );
  }
  const pane = page.locator('.signal-pane').first();
  const over = pane.locator('.u-over');
  const box = await over.boundingBox();
  const outside = await pane.locator('.plot-crop-before').boundingBox();
  await page.mouse.click(outside.x + outside.width / 2, outside.y + outside.height / 2);
  assert(
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) < 5,
    'scrub works over muted data',
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(
    () => Number(document.querySelector('.plot-crop-before').dataset.start) > 0,
  );
  assert.equal(Number(await pane.locator('.plot-crop-before').getAttribute('data-end')), 0.05);
  assert.equal(Number(await pane.locator('.plot-crop-after').getAttribute('data-start')), 0.15);
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('.plot-crop-before').dataset.start) === 0,
  );
  const zoomBox = await over.boundingBox();
  await page.mouse.move(zoomBox.x + zoomBox.width * 0.02, zoomBox.y + zoomBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoomBox.x + zoomBox.width * 0.12, zoomBox.y + zoomBox.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () => Number(document.querySelector('.plot-crop-before').dataset.end) < 0.05,
  );
  await over.dblclick();
  await page.waitForFunction(
    () => Number(document.querySelector('.plot-crop-before').dataset.end) === 0.05,
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  assert.equal(Number(await pane.locator('.plot-crop-after').getAttribute('data-start')), 0.15);
  await page.getByRole('button', { name: 'Cancel crop', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.plot-crop-muted')].every((el) => el.hidden),
  );
  const start = page.getByRole('slider', { name: 'Crop start', exact: true });
  await start.press('Home');
  const end = page.getByRole('slider', { name: 'Crop end', exact: true });
  await end.press('End');
  assert.equal(
    await page.locator('.plot-crop-muted:visible').count(),
    0,
    'full range has no shading',
  );
  await middleCrop(page);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.plot-crop-muted')].filter((el) => !el.hidden).length === 4,
  );
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.plot-crop-muted')].every((el) => el.hidden),
  );
  assert.equal(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
    '9',
  );
  await split.click();
  // A separate independent model clock is retained by crop, so no removal is implied.
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/model-mixed.h5'));
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await primary.selectOption('id:0');
  await page.locator('.u-legend').getByText(/ID ·/).waitFor();
  await middleCrop(page);
  assert.equal(await page.locator('.plot-crop-muted:visible').count(), 0);
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  await search.fill('ID Results');
  await explorer.locator('nav button').first().click();
  await explorer.locator('th').last().getByRole('button').click();
  await page.locator('.u-legend').getByText(/ID ·/).waitFor();
  assert.equal(
    await page.locator('.plot-crop-muted:visible').count(),
    0,
    'Explorer retains independent model clock without crop shading',
  );
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel crop', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(
    'Crop preview smoke passed: split/rate mapping, zoom/reset/resize, pointer interaction, cancel/completion and independent retention.',
  );
}

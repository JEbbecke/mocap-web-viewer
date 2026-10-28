import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import { chooseExportFormat } from './browser-cross-format.mjs';

async function contents(path, format) {
  if (format === 'C3D') return readFile(path);
  await h5.ready;
  const file = new h5.File(resolve(path), 'r');
  const visit = (item) => ({
    attrs: Object.fromEntries(
      Object.keys(item.attrs)
        .sort()
        .map((key) => [key, item.attrs[key].value]),
    ),
    ...(item instanceof h5.Group
      ? {
          children: Object.fromEntries(
            item
              .keys()
              .sort()
              .map((key) => [key, visit(item.get(key))]),
          ),
        }
      : { shape: item.shape, value: item.value }),
  });
  try {
    return JSON.stringify(visit(file), (_key, value) =>
      typeof value === 'bigint'
        ? String(value)
        : ArrayBuffer.isView(value)
          ? Array.from(value)
          : value,
    );
  } finally {
    file.close();
  }
}

/** Real pointer capture, discrete keyboard boundaries, and source-format worker round trips. */
export async function verifyFullRangeCropCancellation(page) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const start = page.getByRole('slider', { name: 'Crop start', exact: true });
  const end = page.getByRole('slider', { name: 'Crop end', exact: true });
  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  const load = async (path) => {
    await page.getByLabel('Open motion file').setInputFiles(resolve(path));
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    assert.equal(await page.getByRole('alert').count(), 0);
  };
  const inactive = async (count) => {
    assert(await button('Apply crop').isDisabled());
    assert.equal(await button('Cancel crop').count(), 0);
    assert.equal(await page.locator('.timeline-slider.has-crop-selection').count(), 0);
    assert.equal(await page.locator('.plot-crop-muted:visible').count(), 0);
    assert.equal(await start.getAttribute('aria-valuenow'), '0');
    assert.equal(await end.getAttribute('aria-valuenow'), String(count));
    assert.equal(await frame.getAttribute('aria-valuemax'), String(count - 1));
  };
  const exportTo = async (format, path) => {
    const downloading = page.waitForEvent('download');
    await chooseExportFormat(page, format);
    const download = await downloading;
    await download.saveAs(path);
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    return path;
  };
  for (const [path, format] of [
    ['reference-data/example_data.h5', 'H5'],
    ['.local/synthetic.c3d', 'C3D'],
  ]) {
    await load(path);
    await button('Data Visualizer').click();
    const count = Number(await end.getAttribute('aria-valuenow'));
    const origin = Number((await start.getAttribute('aria-valuetext')).match(/^Frame (\d+)/)[1]);
    const events = await page.getByLabel('Select event', { exact: true }).innerText();
    const signal = page.getByLabel('Signal to plot', { exact: true });
    const selectedSignal = await signal.inputValue();
    const viewport = page.viewportSize();
    for (const first of ['start', 'end']) {
      await start.press('ArrowRight');
      await end.press('ArrowLeft');
      if (first === 'end') await page.setViewportSize({ width: 1100, height: 1000 });
      assert(await button('Apply crop').isEnabled());
      await (first === 'start' ? start : end).press(first === 'start' ? 'Home' : 'End');
      assert(await button('Apply crop').isEnabled(), 'one boundary is still partial');
      await (first === 'start' ? end : start).press(first === 'start' ? 'End' : 'Home');
      await inactive(count);
    }
    await page.setViewportSize(viewport);
    // A captured pointer can hit full range and move inward again before release.
    const rail = await page.locator('.timeline-slider').boundingBox();
    for (const [boundary, direction] of [
      [start, 1],
      [end, -1],
    ]) {
      const handle = await boundary.boundingBox();
      const x = handle.x + handle.width / 2,
        y = handle.y + handle.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await inactive(count); // Merely grabbing the full-range handle is a no-op.
      await page.mouse.move(x + direction * rail.width * 0.4, y, { steps: 5 });
      assert(await button('Apply crop').isEnabled());
      await page.mouse.move(x - direction * 30, y, { steps: 5 });
      await inactive(count);
      await page.mouse.move(x + direction * rail.width * 0.4, y, { steps: 5 });
      assert(
        await button('Apply crop').isEnabled(),
        'pointer capture survives automatic cancellation',
      );
      await page.mouse.move(x - direction * 30, y);
      await page.mouse.up();
      await inactive(count);
    }
    await start.press('ArrowRight');
    await button('Cancel crop').click();
    await inactive(count);
    assert.equal(await signal.inputValue(), selectedSignal);
    assert.equal(await page.getByLabel('Select event', { exact: true }).innerText(), events);
    assert(await button('Undo').isDisabled());
    assert(await button('Redo').isDisabled());
    await frame.press('End');
    assert.equal(await frame.getAttribute('aria-valuenow'), String(count - 1));
    await frame.press('Home');
    await button('Play').click();
    await page.waitForFunction(
      () =>
        Number(document.querySelector('[aria-label="Frame"]').getAttribute('aria-valuenow')) > 0,
    );
    await button('Pause').click();
    const copy = await exportTo(format, `.local/crop-cancel-copy.${format.toLowerCase()}`);
    assert(
      (await readFile(copy)).equals(await readFile(path)),
      'cancelled provisional crop exports unchanged source bytes',
    );

    await start.press('ArrowRight');
    await button('Apply crop').click();
    await inactive(count - 1);
    assert.match(await start.getAttribute('aria-valuetext'), new RegExp(`^Frame ${origin + 1},`));
    assert(await button('Undo').isDisabled(), 'applying crop retains the existing history reset');
    const applied = await exportTo(format, `.local/crop-cancel-applied.${format.toLowerCase()}`);
    await button('Add Event').click();
    await page.getByLabel('Event label', { exact: true }).fill('Crop cancellation check');
    await button('Save event').click();
    await start.press('ArrowRight');
    await start.press('Home');
    await inactive(count - 1);
    assert(await button('Undo').isEnabled(), 'cancelling preserves edit history after a crop');
    assert.match(
      await page.getByLabel('Select event', { exact: true }).innerText(),
      /Crop cancellation check/,
    );
    await button('Undo').click();
    await button('Redo').click();
    assert.match(
      await page.getByLabel('Select event', { exact: true }).innerText(),
      /Crop cancellation check/,
    );
    await button('Undo').click();
    await start.press('ArrowRight');
    await start.press('Home');
    assert(await button('Redo').isEnabled(), 'automatic cancellation preserves redo too');
    await inactive(count - 1);
    assert.match(await start.getAttribute('aria-valuetext'), new RegExp(`^Frame ${origin + 1},`));
    const cancelled = await exportTo(format, `.local/crop-cancel-retained.${format.toLowerCase()}`);
    assert.deepEqual(
      await contents(cancelled, format),
      await contents(applied, format),
      'export retains the applied crop, all samples, events, rates and metadata',
    );
    await load(cancelled);
    await inactive(count - 1);
    assert.match(await start.getAttribute('aria-valuetext'), new RegExp(`^Frame ${origin + 1},`));
  }
  console.log(
    'Full-range crop cancellation passed: demo H5/C3D, keyboard order, pointer clamping/re-entry, explicit Cancel, playback/scrub, event undo/redo, Signal Inspector and exact source-format export/re-import contents.',
  );
}

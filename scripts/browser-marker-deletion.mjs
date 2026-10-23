import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chooseExportFormat } from './browser-cross-format.mjs';

/** Destructive checks use generated fixtures only, through the actual UI and workers. */
export async function verifyMarkerDeletion(page) {
  const viewer = page.getByLabel('3D Viewer', { exact: true });
  const menu = page.getByRole('menu', { name: /^Marker:/ });
  const read = () =>
    page.evaluate(() => {
      const s = window.cameraProbe.useSession.getState(),
        d = s.data;
      return {
        selected: s.selected,
        labels: d.markers.labels,
        ids: d.markers.sourceIndices ?? d.markers.labels.map((_, i) => i),
        positions: Array.from(d.markers.positions),
        valid: Array.from(d.markers.valid),
        timeline: d.timeline,
        analogs: d.analogs.map((a) => Array.from(a.signal.values)),
        events: d.events.map(({ label, context, time }) => ({ label, context, time })),
      };
    });
  const select = async (name) => page.locator(`.marker-row button[title="${name}"]`).click();
  const load = async (path) => {
    const revision = await page.evaluate(
      () => window.cameraProbe.useSession.getState().camera.revision,
    );
    await page.getByLabel('Open motion file').setInputFiles(resolve(path));
    await page.waitForFunction((previous) => {
      const s = window.cameraProbe.useSession.getState();
      return !s.busy && s.camera.revision > previous;
    }, revision);
    const heading = page.locator('.data-section-heading').filter({ hasText: /^Markers/ });
    if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
    await page.evaluate(() => window.cameraProbe.settleControls());
  };
  const save = async (format, name, sourceFormat) => {
    const download = page.waitForEvent('download');
    await chooseExportFormat(page, format);
    if (format !== sourceFormat) {
      const dialog = page.getByRole('dialog', { name: `Export as ${format}`, exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('alert').count(), 0);
      await dialog.getByRole('button', { name: `Export ${format}`, exact: true }).click();
    }
    const result = await download;
    const path = resolve(`.local/${name}.${format.toLowerCase()}`);
    await result.saveAs(path);
    return path;
  };
  const compare = (actual, expected, tolerance) => {
    assert.deepEqual(actual.labels, expected.labels);
    assert.deepEqual(actual.valid, expected.valid);
    assert.deepEqual(actual.timeline, expected.timeline);
    assert.deepEqual(actual.analogs, expected.analogs);
    assert.equal(actual.positions.length, expected.positions.length);
    actual.positions.forEach((v, i) =>
      assert(
        Math.abs(v - expected.positions[i]) <= tolerance ||
          (Number.isNaN(v) && Number.isNaN(expected.positions[i])),
        `remaining sample ${i}`,
      ),
    );
    assert.equal(actual.events.length, expected.events.length);
    actual.events.forEach((event, i) => {
      assert.equal(event.label, expected.events[i].label);
      assert.equal(event.context, expected.events[i].context);
      assert(Math.abs(event.time - expected.events[i].time) < 1e-5);
    });
  };
  await load('.local/camera-m.h5');
  const original = await read();
  const point = await page.evaluate(() => window.cameraProbe.markerPoint(1));
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await menu.waitFor();
  await menu.getByRole('menuitem', { name: /Delete marker/ }).click();
  const deleted = await read();
  assert.equal(deleted.labels.length, original.labels.length - 1);
  assert(!deleted.labels.includes(original.labels[1]));
  assert.equal(deleted.selected, -1);
  assert.equal(await menu.count(), 0);
  assert.equal(await page.locator('.marker-row').count(), deleted.labels.length);
  assert.equal(await page.locator('.marker-row.selected').count(), 0);
  await viewer.focus();
  await page.keyboard.press('Control+z');
  assert.deepEqual((await read()).labels, original.labels);
  assert.equal((await read()).selected, 1);
  await page.keyboard.press('Control+y');
  assert.deepEqual((await read()).labels, deleted.labels);
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const search = page.getByLabel('Search explorer datasets');
  await search.fill(original.labels[1]);
  assert.equal(
    await page
      .locator('.explorer-navigation button[title]')
      .filter({ hasText: original.labels[1] })
      .count(),
    0,
  );
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  await select(original.labels[3]);
  await page.keyboard.press('Delete');
  assert.equal((await read()).labels.length, original.labels.length - 2);
  assert.equal((await read()).selected, -1);
  await select(original.labels[0]);
  const beforeRepeat = await read();
  await viewer.dispatchEvent('keydown', { key: 'Delete', repeat: true, bubbles: true });
  assert.deepEqual((await read()).labels, beforeRepeat.labels);
  const field = page.getByLabel('Search data');
  await field.fill('abc');
  await field.press('Home');
  await field.press('Delete');
  assert.equal(await field.inputValue(), 'bc');
  assert.deepEqual((await read()).labels, beforeRepeat.labels);
  await field.fill('');
  await page.screenshot({ path: '.local/marker-deletion.png' });
  const expected = await read();
  const converted = await save('C3D', 'deletion-converted', 'H5');
  const sourceH5 = await save('H5', 'deletion-source', 'H5');
  await load(sourceH5);
  compare(await read(), expected, 0);
  await load(converted);
  compare(await read(), expected, 0.005);
  const c3dBefore = await read();
  await select(c3dBefore.labels[0]);
  await page.keyboard.press('Delete');
  const c3dExpected = await read();
  assert.equal(c3dExpected.labels.length, c3dBefore.labels.length - 1);
  const sourceC3D = await save('C3D', 'deletion-source', 'C3D');
  const convertedH5 = await save('H5', 'deletion-converted', 'C3D');
  await load(sourceC3D);
  compare(await read(), c3dExpected, 0);
  await load(convertedH5);
  compare(await read(), c3dExpected, 0);

  // Last-marker guard is exercised through the same menu and key dispatcher.
  while ((await read()).labels.length > 1) {
    await select((await read()).labels[0]);
    await page.keyboard.press('Delete');
  }
  await select((await read()).labels[0]);
  await viewer.focus();
  await page.keyboard.press('Shift+F10');
  await menu.waitFor();
  const lastDelete = menu.getByRole('menuitem', { name: /Delete marker/ });
  assert(await lastDelete.isDisabled());
  assert.match(await lastDelete.getAttribute('title'), /at least one/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  assert.equal((await read()).labels.length, 1);
  await load('.local/camera-m.h5');
  console.log(
    'Marker deletion browser checks passed: menu/key/undo/redo, Inspector/Explorer, text/repeats, last-marker guard and all four C3D/H5 export paths.',
  );
}

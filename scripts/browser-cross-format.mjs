import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';

/** Wholly synthetic plate with COP shifted away from its wrench reconstruction. */
export function createCorrectedCopFixture() {
  const file = new h5.File(resolve('.local/cross-corrected-cop.h5'), 'w');
  try {
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 100);
    const labeled = trajectories.create_group('Labeled');
    labeled.create_attribute('Labels', ['Synthetic marker']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({ name: 'Data', data: new Float64Array(8).fill(1), shape: [1, 4, 2] });
    file.create_group('MetaData').create_group('Project');
    const plate = file.create_group('ForcePlates').create_group('0');
    for (const [key, value] of Object.entries({
      Name: 'Corrected plate',
      CoordinateSystem: 1,
      FreeMomentFrame: 'global',
      SamplingFrequency: 100,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
    }))
      plate.create_attribute(key, value);
    for (const [name, values] of Object.entries({
      Force: [10, 10, 20, 20, 100, 100],
      Moment: [500, 500, -1000, -1000, 200, 200],
      COP: [20, 20, 0, 0, 0, 0],
      Tz: [500, 500, 1000, 1000, -200, -200],
    }))
      plate.create_dataset({ name, data: new Float64Array(values), shape: [3, 2] });
    plate.create_dataset({
      name: 'Corners',
      data: new Float64Array([100, -100, -100, 100, 100, 100, -100, -100, 0, 0, 0, 0]),
      shape: [3, 4, 1],
    });
    const surveyed = file.get('ForcePlates').create_group('1');
    for (const [key, value] of Object.entries({
      Name: 'Surveyed plate',
      CoordinateSystem: 1,
      FreeMomentFrame: 'global',
      SamplingFrequency: 100,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
    }))
      surveyed.create_attribute(key, value);
    for (const [name, values] of Object.entries({
      Force: [10, 10, 20, 20, 100, 100],
      Moment: [500, 500, -1000, -1000, 200, 200],
      COP: [10.25, 10.25, 4.75, 4.75, 0.125, 0.125],
      Tz: [0, 0, 0, 0, 50, 50],
    }))
      surveyed.create_dataset({ name, data: new Float64Array(values), shape: [3, 2] });
    surveyed.create_dataset({
      name: 'Corners',
      data: new Float64Array([100, -100, -99, 100, 100, 100, -101, -100, 0, 0, 0.5, 0]),
      shape: [3, 4, 1],
    });
  } finally {
    file.close();
  }
}

async function markerValues(page) {
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  await explorer.getByLabel('Search explorer datasets').fill('Trajectories');
  await explorer.locator('nav button').first().click();
  const cells = await explorer.locator('tbody tr[data-row="0"] td').allTextContents();
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
  return { currentFrame: cells[1], sourceFrame: Number(cells[2]), values: cells.slice(3, 8) };
}

export async function verifyCrossFormat(page, analyticsEvents) {
  assert.equal(await page.getByLabel('Export format', { exact: true }).inputValue(), 'C3D');
  const before = await markerValues(page);
  const file = await page.locator('.header-file').innerText();
  const undo = await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled();
  const redo = await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled();
  const priorEvents = analyticsEvents();
  for (const target of ['H5', 'C3D']) {
    await page.getByLabel('Export format', { exact: true }).selectOption(target);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Export as ${target}`, exact: true });
    await dialog.waitFor();
    assert((await dialog.innerText()).includes('Will export'));
    assert((await dialog.innerText()).includes('Omitted or changed'));
    if (target === 'H5') {
      await page.keyboard.press('Escape');
      assert.equal(
        await page.getByRole('dialog').count(),
        0,
        'Escape cancels the conversion review',
      );
      assert.equal(await page.locator('.header-file').innerText(), file);
      assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), undo);
      assert.equal(await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled(), redo);
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await dialog.waitFor();
    }
    const prior = analyticsEvents();
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: `Download ${target}`, exact: true }).click();
    const download = await downloadPromise;
    const name = target === 'H5' ? 'synthetic.h5' : 'cross-browser.c3d';
    assert.equal(download.suggestedFilename(), name);
    const path = resolve(`.local/cross-browser.${target.toLowerCase()}`);
    await download.saveAs(path);
    assert.deepEqual(analyticsEvents(), prior, 'conversion sends no analytics event');
    if (target === 'H5') assert.deepEqual(analyticsEvents(), priorEvents);
    await page.getByLabel('Open motion file').setInputFiles(path);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(
      await page.getByLabel('Export format', { exact: true }).inputValue(),
      target,
      'new files default to source format',
    );
    const actual = await markerValues(page);
    assert.deepEqual(
      actual.values,
      before.values,
      'normalized clock, XYZ and validity remain visible after conversion',
    );
    assert.equal(actual.currentFrame, before.currentFrame);
    assert.equal(actual.sourceFrame, before.sourceFrame - (target === 'H5' ? 1 : 0));
  }
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/cross-corrected-cop.h5'));
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await page.getByLabel('Export format', { exact: true }).selectOption('C3D');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const corrected = page.getByRole('dialog', { name: 'Export as C3D', exact: true });
  const report = await corrected.innerText();
  assert(report.includes('2 derived force platforms'));
  assert(report.includes('Surveyed plate: measured corners deviate slightly'));
  assert(report.includes('Original corner order and coordinates are retained'));
  assert(report.includes('stored COP is inconsistent'));
  assert(report.includes('Stored COP is omitted from the exported C3D'));
  assert(report.includes('Stored free moment is omitted'));
  assert(!report.includes('Corrected plate omitted:'));
  assert.equal(
    await corrected.getByRole('button', { name: 'Download C3D', exact: true }).isEnabled(),
    true,
  );
  const downloadPromise = page.waitForEvent('download');
  const prior = analyticsEvents();
  await corrected.getByRole('button', { name: 'Download C3D', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'cross-corrected-cop.c3d');
  const correctedPath = resolve('.local/cross-corrected-cop.c3d');
  await download.saveAs(correctedPath);
  assert.deepEqual(analyticsEvents(), prior, 'corrected-COP export sends no analytics event');
  await page.getByLabel('Open motion file').setInputFiles(correctedPath);
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  await explorer.getByLabel('Search explorer datasets').fill('Corrected plate');
  assert(
    (await explorer.innerText()).includes('Corrected plate'),
    'exported plate remains available after re-import',
  );
  for (const [field, expected] of [
    ['Force', [10, 20, 100]],
    ['Moment', [0.5, -1, 0.2]],
    ['COP', [10, 5, 0]],
    ['Free moment', [0, 0, 0.05]],
  ]) {
    await explorer
      .locator(`nav button[title="Force Platforms / Corrected plate / ${field}"]`)
      .click();
    const cells = await explorer.locator('tbody tr[data-row="0"] td').allTextContents();
    const actual = cells.slice(2).map(Number);
    assert.equal(actual.length, 3);
    actual.forEach((value, axis) =>
      assert(Math.abs(value - expected[axis]) < 1e-6, `${field} reconstructed values`),
    );
  }
  await explorer.getByLabel('Search explorer datasets').fill('Surveyed plate');
  await explorer.locator('nav button[title="Force Platforms / Surveyed plate / COP"]').click();
  const surveyedCop = (await explorer.locator('tbody tr[data-row="0"] td').allTextContents())
    .slice(2)
    .map(Number);
  assert.deepEqual(surveyedCop, [10.25, 4.75, 0.125]);
  await explorer
    .locator('nav button[title="Force Platforms / Surveyed plate / Geometry / Corners"]')
    .click();
  const surveyedCorners = (await explorer.locator('tbody tr[data-row="0"] td').allTextContents())
    .slice(1)
    .map(Number);
  assert.deepEqual(surveyedCorners, [100, 100, 0, -100, 100, 0, -99, -101, 0.5, 100, -100, 0]);
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/cross-incompatible.h5'));
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await page.getByLabel('Export format', { exact: true }).selectOption('C3D');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: 'Export as C3D', exact: true });
  assert((await blocked.getByRole('alert').innerText()).includes('sample count'));
  assert.equal(
    await blocked.getByRole('button', { name: 'Download C3D', exact: true }).isEnabled(),
    false,
  );
  await blocked.getByRole('button', { name: 'Cancel', exact: true }).click();
}

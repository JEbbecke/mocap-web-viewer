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
    trajectories.create_attribute('GlobalCoordinateSystem', 'X anterior, Y left, Z up');
    const metadata = file.create_group('MetaData');
    const project = metadata.create_group('Project');
    project.create_attribute('Project', 'Synthetic export metadata');
    project.create_attribute('SubjectID', ['META-1', 'META-2']);
    project.create_attribute('SubjectGroup', ['Control', 'Repeat']);
    project.create_attribute('Condition', 'Long synthetic condition '.repeat(20));
    metadata.create_group('FileInfo').create_attribute('OriginalFiles', ['synthetic-input.h5']);
    const location = metadata.create_group('Location');
    location.create_attribute('Lat', 52.5);
    location.create_attribute('Lon', 13.4);
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
    // Both plates have original channels. The corrected plate needs the fallback;
    // the surveyed plate reconstructs its stored values and reuses these channels.
    const analog = file.create_group('Analog');
    analog.create_attribute('Labels', ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz']);
    analog.create_attribute('Units', ['N', 'N', 'N', 'Nmm', 'Nmm', 'Nmm']);
    analog.create_attribute('Channels', new BigInt64Array([0n, 1n, 2n, 3n, 4n, 5n]));
    analog.create_attribute('SamplingFrequency', 100);
    analog.create_dataset({
      name: 'Data',
      shape: [6, 2],
      data: new Float64Array([10, 10, 20, 20, 100, 100, 500, 500, -1000, -1000, 200, 200]),
    });
    const original = metadata.create_group('C3DParameters');
    original.create_group('POINT').create_group('UNITS').create_attribute('value', ['mm']);
    const analogParameters = original.create_group('ANALOG');
    const fp = original.create_group('FORCE_PLATFORM');
    const parameter = (group, name, values, shape) =>
      group.create_group(name).create_attribute('value', new Float64Array(values), shape);
    parameter(analogParameters, 'USED', [6], [1]);
    parameter(analogParameters, 'GEN_SCALE', [1], [1]);
    parameter(analogParameters, 'SCALE', Array(6).fill(1), [6]);
    parameter(analogParameters, 'OFFSET', Array(6).fill(0), [6]);
    parameter(fp, 'USED', [2], [1]);
    parameter(fp, 'TYPE', [2, 2], [2]);
    parameter(fp, 'CHANNEL', [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6], [6, 2]);
    parameter(fp, 'ORIGIN', Array(6).fill(0), [3, 2]);
    const originalCorners = [
      [100, -100, -100, 100, 100, 100, -100, -100, 0, 0, 0, 0],
      [100, -100, -99, 100, 100, 100, -101, -100, 0, 0, 0.5, 0],
    ];
    parameter(
      fp,
      'CORNERS',
      Array.from({ length: 24 }, (_, i) => originalCorners[i % 2][Math.floor(i / 2)]),
      [3, 4, 2],
    );
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

export async function chooseExportFormat(page, format) {
  await page.locator('header').getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: `Export ${format}`, exact: true }).click();
}

export async function verifyExportToolbar(page) {
  const trigger = page.locator('header').getByRole('button', { name: 'Export', exact: true });
  const menu = page.getByRole('menu', { name: 'Export', exact: true });
  assert.equal(await page.getByLabel('Export format', { exact: true }).count(), 0);
  assert.equal(
    await page
      .locator('.timeline-actions')
      .getByRole('button', { name: 'Add Event', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.locator('.timeline-actions').getByLabel('Select event', { exact: true }).count(),
    1,
  );
  await trigger.focus();
  await trigger.press('ArrowDown');
  assert(
    await page
      .getByRole('menuitem', { name: 'Export H5', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.keyboard.press('ArrowUp');
  assert(
    await page
      .getByRole('menuitem', { name: 'Export C3D', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.keyboard.press('Home');
  assert(
    await page
      .getByRole('menuitem', { name: 'Export H5', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0);
  assert(await trigger.evaluate((el) => el === document.activeElement));
  await trigger.press('ArrowUp');
  assert(
    await page
      .getByRole('menuitem', { name: 'Export C3D', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.keyboard.press('Tab');
  assert.equal(await menu.count(), 0);
  assert(
    await page
      .locator('header')
      .getByRole('button', { name: 'Open file' })
      .evaluate((el) => el === document.activeElement),
  );
  await trigger.click();
  await page.locator('.time-labels').click();
  assert.equal(await menu.count(), 0, 'clicking outside closes the menu');
  const originalViewport = page.viewportSize();
  for (const width of [1440, 1100, 820, 768, 760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const header = document.querySelector('header');
      const timeline = document.querySelector('.timeline');
      const actions = [...document.querySelector('.file-actions').children].map((el) =>
        el.getBoundingClientRect(),
      );
      return {
        headerFits: header.scrollWidth <= header.clientWidth + 1,
        timelineFits: timeline.scrollWidth <= timeline.clientWidth + 1,
        adjacent:
          Math.abs(actions[0].top - actions[1].top) < 1 && actions[0].right < actions[1].left,
        height: timeline.getBoundingClientRect().height,
      };
    });
    assert(layout.headerFits, `header fits at ${width}px`);
    assert(layout.timelineFits, `timeline fits at ${width}px`);
    assert(layout.adjacent, 'Export stays next to Open file');
    if (width === 1440)
      assert(layout.height <= 112, `event controls fit the compact timeline (${layout.height}px)`);
    await trigger.click();
    const bounds = await menu.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width, `export menu fits at ${width}px`);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `.local/export-toolbar-${width}.png` });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize(originalViewport);
  await trigger.evaluate((el) => el.blur());
}

async function verifySourceFormat(page, format) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  assert.match(
    await page.getByRole('menuitem').first().innerText(),
    new RegExp(`Export ${format}.*source`, 's'),
  );
  await page.keyboard.press('Escape');
}

export async function verifyCrossFormat(page, analyticsEvents) {
  await verifySourceFormat(page, 'C3D');
  const before = await markerValues(page);
  const file = await page.locator('.header-file').innerText();
  const undo = await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled();
  const redo = await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled();
  const priorEvents = analyticsEvents();
  for (const target of ['H5', 'C3D']) {
    await chooseExportFormat(page, target);
    const dialog = page.getByRole('dialog', { name: `Export as ${target}`, exact: true });
    await dialog.waitFor();
    assert((await dialog.innerText()).includes('Will export'));
    assert((await dialog.innerText()).includes('Changed or omitted'));
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
      await chooseExportFormat(page, target);
      await dialog.waitFor();
    }
    const prior = analyticsEvents();
    const exportPromise = page.waitForEvent('download');
    // Keep a failed click/report observable instead of an early unhandled rejection.
    exportPromise.catch(() => {});
    await dialog.getByRole('button', { name: `Export ${target}`, exact: true }).click();
    const exportedFile = await exportPromise;
    const name = target === 'H5' ? 'synthetic.h5' : 'cross-browser.c3d';
    assert.equal(exportedFile.suggestedFilename(), name);
    const path = resolve(`.local/cross-browser.${target.toLowerCase()}`);
    await exportedFile.saveAs(path);
    assert.deepEqual(analyticsEvents(), prior, 'conversion sends no analytics event');
    if (target === 'H5') assert.deepEqual(analyticsEvents(), priorEvents);
    await page.getByLabel('Open motion file').setInputFiles(path);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    await verifySourceFormat(page, target);
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
  await chooseExportFormat(page, 'C3D');
  const corrected = page.getByRole('dialog', { name: 'Export as C3D', exact: true });
  const report = await corrected.innerText();
  assert(report.includes('1 derived force platforms (6 additional analog channels)'));
  assert(
    report.includes(
      '1 force platforms using existing analog channels and original C3D definitions',
    ),
  );
  assert(report.includes('Recording and subject metadata in C3D parameters'));
  assert(!report.includes('Project/file/location metadata'));
  assert(!report.includes('Subject group, multi-valued demographics'));
  assert(!report.includes('measured corners deviate slightly'));
  assert(!report.includes('Surveyed plate omitted:'));
  assert(report.includes('stored COP is inconsistent'));
  assert(report.includes('Stored COP is omitted from the exported C3D'));
  assert(report.includes('Stored free moment is omitted'));
  assert(!report.includes('Corrected plate omitted:'));
  assert.equal(
    await corrected.getByRole('button', { name: 'Export C3D', exact: true }).isEnabled(),
    true,
  );
  const exportPromise = page.waitForEvent('download');
  const prior = analyticsEvents();
  await corrected.getByRole('button', { name: 'Export C3D', exact: true }).click();
  const exportedFile = await exportPromise;
  assert.equal(exportedFile.suggestedFilename(), 'cross-corrected-cop.c3d');
  const correctedPath = resolve('.local/cross-corrected-cop.c3d');
  await exportedFile.saveAs(correctedPath);
  assert.deepEqual(analyticsEvents(), prior, 'corrected-COP export sends no analytics event');
  await page.getByLabel('Open motion file').setInputFiles(correctedPath);
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await page.getByRole('tab', { name: 'File Info', exact: true }).click();
  const info = await page.getByRole('tabpanel', { name: 'File Info', exact: true }).innerText();
  for (const value of [
    'Synthetic export metadata',
    'META-1',
    'META-2',
    'Control',
    'Repeat',
    'synthetic-input.h5',
    'X anterior, Y left, Z up',
    '52.5',
    '13.4',
  ])
    assert(info.includes(value), `exported metadata remains visible: ${value}`);
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
  await chooseExportFormat(page, 'C3D');
  const blocked = page.getByRole('dialog', { name: 'Export as C3D', exact: true });
  assert((await blocked.getByRole('alert').innerText()).includes('sample count'));
  assert.equal(
    await blocked.getByRole('button', { name: 'Export C3D', exact: true }).isEnabled(),
    false,
  );
  await blocked.getByRole('button', { name: 'Cancel', exact: true }).click();
}

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import { createRotationBrowserFixture } from './browser-rotation.mjs';
import { chooseExportFormat } from './browser-cross-format.mjs';

async function createWarningFixtures() {
  await createRotationBrowserFixture();
  const multiple = await readFile('.local/rotation-browser.c3d');
  // Remove POINT:LABELS using the independent Rotation encoder's first LABELS record.
  const labels = multiple.indexOf('LABELS');
  assert(labels > 0);
  multiple.write('NOLBLS', labels);
  await writeFile('.local/warnings-multiple.c3d', multiple);
  const standard = JSON.parse(await readFile('tests/fixtures/c3d.json', 'utf8'));
  await writeFile('.local/warnings-standard.c3d', Buffer.from(standard.intelFloat, 'base64'));
  await h5.ready;
  for (const incompatible of [false, true]) {
    const file = new h5.File(
      resolve(`.local/warnings-${incompatible ? 'incompatible' : 'unresolved'}.h5`),
      'w',
    );
    try {
      file.create_group('MetaData').create_group('Project');
      const trajectories = file.create_group('Trajectories');
      trajectories.create_attribute('SamplingFrequency', 100);
      const labeled = trajectories.create_group('Labeled');
      labeled.create_attribute('Labels', ['Synthetic marker']);
      labeled.create_attribute('Unit', 'mm');
      labeled.create_dataset({ name: 'Data', shape: [1, 4, 2], data: new Float64Array(8).fill(1) });
      const plates = file.create_group('ForcePlates');
      for (let index = 0; index < 2; index++) {
        const plate = plates.create_group(String(index));
        for (const [key, value] of Object.entries({
          Name: `Unresolved plate ${index + 1}`,
          CoordinateSystem: 0,
          SamplingFrequency: 100,
          unit_force: 'N',
          unit_moment: 'Nmm',
          unit_position: 'mm',
        }))
          plate.create_attribute(key, value);
        for (const name of ['Force', 'Moment', 'COP'])
          plate.create_dataset({ name, shape: [3, 2], data: new Float64Array(6) });
      }
      if (incompatible) {
        const analog = file.create_group('Analog');
        analog.create_attribute('Labels', ['Independent analog']);
        analog.create_attribute('Units', ['V']);
        analog.create_attribute('SamplingFrequency', 100);
        analog.create_dataset({ name: 'Data', shape: [1, 3], data: new Float64Array([1, 2, 3]) });
      }
    } finally {
      file.close();
    }
  }
}

export async function verifyWarningBanners(page) {
  await createWarningFixtures();
  const load = async (name) => {
    await page.getByLabel('Open motion file').setInputFiles(resolve(`.local/${name}`));
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    assert.equal(
      await page.getByRole('alert').count(),
      0,
      await page.getByRole('alert').allTextContents(),
    );
  };
  const banner = page.locator('.warnings');
  const dismissAll = page.getByRole('button', { name: 'Dismiss all import warnings', exact: true });
  const dismissNote = () => page.getByRole('button', { name: 'Dismiss warning', exact: true });
  const trigger = page.locator('header').getByRole('button', { name: 'Export', exact: true });
  const review = async (target) => {
    await chooseExportFormat(page, target);
    const dialog = page.getByRole('dialog', { name: `Export as ${target}`, exact: true });
    await dialog.waitFor();
    return dialog;
  };

  await load('rotation-browser.c3d');
  assert(await banner.isVisible());
  assert(await dismissAll.isVisible(), 'collapsed banner has an accessible dismiss button');
  const reports = {};
  for (const target of ['C3D', 'H5']) {
    const dialog = await review(target);
    reports[target] = await dialog.locator('.conversion-details').innerText();
    assert.match(reports[target], /Changed or omitted[\s\S]*2 rotation signals not imported/);
    assert.equal(await dialog.getByRole('button', { name: /Dismiss/ }).count(), 0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await dismissAll.click();
  assert.equal(await banner.count(), 0);
  // Every new review retains its complete loss disclosures and confirmation action.
  for (const target of ['C3D', 'H5', 'C3D']) {
    const dialog = await review(target);
    assert.equal(await dialog.locator('.conversion-details').innerText(), reports[target]);
    const action = dialog.getByRole('button', { name: `Export ${target}`, exact: true });
    assert(await action.isEnabled());
    const download = page.waitForEvent('download');
    await action.click();
    await download;
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    assert.equal(await banner.count(), 0, 'export does not reset the import presentation');
  }
  for (const key of ['Enter', 'Space']) {
    await load('rotation-browser.c3d');
    assert(await banner.isVisible(), 're-importing the same file shows its warning again');
    await dismissAll.focus();
    await dismissAll.press(key);
    assert.equal(await banner.count(), 0, `${key} dismisses the warning`);
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 0);
  }

  await load('warnings-multiple.c3d');
  await banner.locator('summary').click();
  assert.equal(await dismissNote().count(), 2);
  assert.match(await banner.innerText(), /2 rotation signals were not imported/);
  assert.match(await banner.innerText(), /numbered labels were assigned/);
  await dismissNote().first().click();
  assert.equal(await dismissNote().count(), 1);
  assert.doesNotMatch(await banner.innerText(), /2 rotation signals were not imported/);
  assert.match(await banner.innerText(), /numbered labels were assigned/);
  for (const workspace of ['Data Explorer', 'Data Visualizer']) {
    await page.getByRole('button', { name: workspace, exact: true }).click();
    assert.equal(await dismissNote().count(), 1, 'workspace changes preserve dismissal');
  }
  // Applying a crop must not revive an already dismissed warning.
  await page.getByRole('slider', { name: 'Crop start', exact: true }).press('ArrowRight');
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  assert.equal(await dismissNote().count(), 1);
  await dismissNote().press('Space');
  assert.equal(await banner.count(), 0);
  await load('warnings-multiple.c3d');
  await banner.locator('summary').click();
  assert.equal(await dismissNote().count(), 2, 'all warnings reappear for the next import');

  const viewport = page.viewportSize();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await banner.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('button')];
      return {
        fits: element.scrollWidth <= element.clientWidth + 1,
        controlsFit: controls.every((button) => {
          const box = button.getBoundingClientRect();
          return box.width >= 24 && box.height >= 24 && box.right <= bounds.right;
        }),
        textFits: [...element.querySelectorAll('.warning-note > span')].every((text) => {
          const box = text.getBoundingClientRect();
          return box.right <= text.nextElementSibling.getBoundingClientRect().left;
        }),
      };
    });
    assert(layout.fits && layout.controlsFit && layout.textFits, `warning layout at ${width}px`);
    await page.screenshot({ path: `.local/warnings-${width}.png` });
  }
  await page.setViewportSize(viewport);
  await load('warnings-standard.c3d');
  assert.equal(await banner.count(), 0, 'another file does not retain stale warnings');

  await load('warnings-unresolved.h5');
  await banner.locator('summary').click();
  assert.equal(await dismissNote().count(), 2, 'H5 notes are individually dismissible too');
  await dismissNote().last().click();
  assert.match(await banner.innerText(), /Unresolved plate 1/);
  assert.doesNotMatch(await banner.innerText(), /Unresolved plate 2/);
  await dismissAll.click();
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  const confirmation = page.getByRole('checkbox', { name: /I confirm unresolved force\/COP/ });
  assert(await confirmation.isVisible(), 'scientific confirmation remains available');
  assert(!(await confirmation.isChecked()), 'dismissal does not confirm coordinate assumptions');
  await load('warnings-incompatible.h5');
  await dismissAll.click();
  const blocked = await review('C3D');
  assert.match(await blocked.getByRole('alert').innerText(), /Cannot convert/);
  assert(await blocked.getByRole('button', { name: 'Export C3D', exact: true }).isDisabled());
  assert.equal(await blocked.getByRole('button', { name: /Dismiss/ }).count(), 0);
  await blocked.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(await trigger.isEnabled());
  await page.getByLabel('Open motion file').setInputFiles({
    name: 'broken.c3d',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Operation could not be completed/);
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await load('warnings-standard.c3d');
  console.log(
    'Warning banners passed: mouse/Enter/Space, independent C3D/H5 notes, repeat imports, workspace/crop state, responsive layout, repeated export disclosures/downloads, coordinate confirmation and blocking errors.',
  );
}

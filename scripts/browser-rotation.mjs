import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { chooseExportFormat } from './browser-cross-format.mjs';

/** Reuse the tiny independent test encoder; no private vendor file is required. */
export async function createRotationBrowserFixture() {
  const source = await readFile('tests/helpers/rotationC3d.ts', 'utf8');
  const { code } = await transformWithEsbuild(source, 'rotationC3d.ts');
  const { rotationFixture } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  await writeFile('.local/rotation-browser.c3d', Buffer.from(rotationFixture()));
}

/** Exercise partial-import review and real export/re-import workers in the built app. */
export async function verifyRotationExport(page, analyticsEvents) {
  const load = async (path) => {
    await page.getByLabel('Open motion file').setInputFiles(resolve(path));
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    assert.equal(await page.getByRole('alert').count(), 0);
  };
  const near = (actual, expected) =>
    assert(Math.abs(Number(actual) - expected) < 1e-12, `${actual} vs ${expected}`);
  const inspect = async (format, start) => {
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
    const search = explorer.getByLabel('Search explorer datasets');
    const rows = () =>
      explorer
        .locator('tbody tr[data-row]')
        .evaluateAll((elements) =>
          elements.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.title)),
        );
    await search.fill('Trajectories');
    const names = await explorer.locator('nav button').allTextContents();
    assert.equal(names.length, 2);
    assert(names[0].startsWith('Alpha') && names[1].startsWith('Beta'));
    for (let marker = 0; marker < 2; marker++) {
      await explorer.locator('nav button').nth(marker).click();
      const values = await rows();
      assert.equal(values.length, 3 - start);
      for (const [local, row] of values.entries()) {
        const frame = local + start;
        assert.equal(Number(row[1]), local + 1);
        assert.equal(Number(row[2]), 36 + frame + (format === 'C3D' ? 1 : 0));
        near(row[3], local / 100);
        assert.deepEqual(
          row.slice(4, 7).map(Number),
          marker ? [1000 + frame * 10, 200, 300] : [10 + frame * 10, 20, 30],
        );
        assert.equal(row[7], !marker && frame === 1 ? 'No' : 'Yes');
        assert.equal(Number(row[8]), marker ? 15 : frame === 1 ? -1 : 25);
      }
      await explorer.getByRole('button', { name: 'Details', exact: true }).click();
      assert.match(
        await page.getByRole('dialog', { name: /dataset details$/ }).innerText(),
        /100 Hz/,
      );
      await page.keyboard.press('Escape');
    }
    await search.fill('Analog');
    assert.equal(await explorer.locator('nav button').count(), 2);
    for (let channel = 0; channel < 2; channel++) {
      await explorer.locator('nav button').nth(channel).click();
      const values = await rows();
      assert.equal(values.length, (3 - start) * 2);
      for (const [sample, row] of values.entries()) {
        const original = sample + start * 2;
        const raw = (channel ? 220 : 110) + Math.floor(original / 2) * 10 + (original % 2);
        near(row[1], sample / 200);
        assert.equal(Number(row[2]), channel ? (raw - 20) * -0.75 : (raw - 10) * 0.5);
      }
      await explorer.getByRole('button', { name: 'Details', exact: true }).click();
      assert.match(
        await page.getByRole('dialog', { name: /dataset details$/ }).innerText(),
        /200 Hz/,
      );
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
    assert.match(
      await page.getByLabel('Select event', { exact: true }).innerText(),
      /Events \(1\).*Step/s,
    );
  };
  for (const start of [0, 1]) {
    for (const target of ['C3D', 'H5']) {
      await load('.local/rotation-browser.c3d');
      assert.match(
        await page.locator('.warnings summary').innerText(),
        /rotation data was not imported/,
      );
      await page.locator('.warnings summary').click();
      assert.match(
        await page.locator('.warnings').innerText(),
        /2 rotation signals were not imported/,
      );
      if (start) {
        await page.getByRole('slider', { name: 'Crop start', exact: true }).press('ArrowRight');
        await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
      }
      await inspect('C3D', start);
      const priorEvents = analyticsEvents();
      await chooseExportFormat(page, target);
      const dialog = page.getByRole('dialog', { name: `Export as ${target}`, exact: true });
      await dialog.waitFor();
      const report = await dialog.innerText();
      assert.match(report, /Will export/);
      assert.match(report, /Changed or omitted/);
      assert.match(report, /2 rotation signals not imported/);
      if (target === 'H5') assert.match(report, /fourth component is unspecified/);
      const action = dialog.getByRole('button', { name: `Export ${target}`, exact: true });
      assert(await action.isEnabled(), 'source omission does not block valid supported data');
      const downloadPromise = page.waitForEvent('download');
      await action.click();
      const download = await downloadPromise;
      if (target === 'C3D')
        assert.equal(
          download.suggestedFilename(),
          `rotation-browser_${start ? 'cropped' : 'exported'}.c3d`,
        );
      const path = `.local/rotation-browser-${start ? 'crop' : 'full'}.${target.toLowerCase()}`;
      await download.saveAs(path);
      assert.deepEqual(analyticsEvents(), priorEvents, 'export emits no analytics event');
      if (target === 'C3D')
        assert(
          !(await readFile(path)).includes(Buffer.from('ROTATION')),
          'no stale Rotation parameter group',
        );
      await load(path);
      assert.equal(
        await page.locator('.warnings').count(),
        0,
        'supported subset has no stale omission claims',
      );
      await inspect(target, start);
    }
  }
  console.log(
    'Rotation subset passed: persistent notes, both nonblocking export previews, full/cropped C3D/H5 re-imports, exact marker/residual/validity/analog values, units, rates and nonzero source frames.',
  );
}

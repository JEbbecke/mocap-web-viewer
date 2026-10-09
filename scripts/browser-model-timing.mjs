import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';

export function createModelTimingFixtures() {
  for (const independent of [false, true]) {
    const file = new h5.File(resolve(`.local/model-${independent ? 'mixed' : 'aligned'}.h5`), 'w');
    try {
      file.create_group('MetaData').create_group('Project');
      const trajectory = file.create_group('Trajectories');
      trajectory.create_attribute('SamplingFrequency', 100);
      trajectory.create_attribute('StartFrame', 700);
      trajectory.create_attribute('EndFrame', 719);
      const labeled = trajectory.create_group('Labeled');
      labeled.create_attribute('Labels', ['Synthetic marker']);
      labeled.create_attribute('Unit', 'mm');
      labeled.create_dataset({
        name: 'Data',
        shape: [1, 4, 20],
        data: new Float64Array(80).fill(1),
      });
      labeled.create_dataset({
        name: 'Time',
        data: Float64Array.from({ length: 20 }, (_, i) => 7 + i / 100),
      });
      const analog = file.create_group('Analog');
      analog.create_attribute('Labels', ['Synthetic analog']);
      analog.create_attribute('Units', ['V']);
      analog.create_attribute('SamplingFrequency', 200);
      analog.create_attribute('StartFrame', 1400);
      analog.create_dataset({
        name: 'Data',
        shape: [1, 40],
        data: Float64Array.from({ length: 40 }, (_, i) => i),
      });
      for (const kind of ['IK', 'ID']) {
        const group = file.create_group(`${kind}Results`);
        const rate = independent && kind === 'ID' ? 120 : 100;
        group.create_attribute('Labels', [`Synthetic ${kind} variable`]);
        group.create_attribute('Units', [kind === 'IK' ? 'deg' : 'Nm']);
        group.create_attribute('SamplingFrequency', rate);
        group.create_attribute('NumSamples', 20);
        group.create_dataset({
          name: 'Data',
          shape: [1, 20],
          data: Float64Array.from({ length: 20 }, (_, i) => i),
        });
        group.create_dataset({
          name: 'Time',
          data: Float64Array.from({ length: 20 }, (_, i) => 7 + i / rate),
        });
      }
    } finally {
      file.close();
    }
  }
}

async function verifyGeometry(page, independent) {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const primary = page.getByLabel('Signal to plot', { exact: true });
    let bottom;
    for (const selection of ['analog:0', 'ik:0', 'id:0']) {
      await primary.selectOption(selection);
      const pane = page.locator('.signal-pane').first();
      await pane.locator('.uplot').waitFor();
      if (selection.startsWith('i'))
        await pane
          .locator('.u-legend')
          .getByText(new RegExp(selection.slice(0, 2).toUpperCase() + ' ·'))
          .waitFor();
      await page.waitForFunction(() => {
        const target = document.querySelector('.plot-target');
        const chart = target?.querySelector('.uplot');
        return (
          chart && chart.getBoundingClientRect().bottom <= target.getBoundingClientRect().bottom + 1
        );
      });
      const geometry = await pane.evaluate((el) => {
        const note = el.querySelector('.signal-model-note');
        const trigger = el.querySelector('.signal-selector-trigger');
        return {
          bottom: el.querySelector('.uplot').getBoundingClientRect().bottom,
          footer: document.querySelector('footer').getBoundingClientRect().top,
          panel: document.querySelector('.plot-panel').getBoundingClientRect().bottom,
          noteHeight: note.getBoundingClientRect().height,
          noteWhiteSpace: getComputedStyle(note).whiteSpace,
          triggerHeight: trigger.getBoundingClientRect().height,
          triggerWhiteSpace: getComputedStyle(trigger).whiteSpace,
          message: note.textContent,
        };
      });
      assert(geometry.bottom <= geometry.footer, 'chart remains above footer');
      assert(geometry.bottom <= geometry.panel + 1, 'chart remains inside signal panel');
      assert.equal(geometry.noteHeight, 18);
      assert.equal(geometry.noteWhiteSpace, 'nowrap');
      assert.equal(geometry.triggerWhiteSpace, 'nowrap');
      assert.equal(geometry.triggerHeight, 23);
      if (bottom !== undefined)
        assert(
          Math.abs(geometry.bottom - bottom) <= 1,
          'signal choice does not shift chart bottom',
        );
      bottom = geometry.bottom;
      assert.equal(
        geometry.message.includes('Independent model timeline'),
        independent && selection === 'id:0',
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

export async function verifyModelTiming(page) {
  for (const independent of [false, true]) {
    await page
      .getByLabel('Open motion file')
      .setInputFiles(resolve(`.local/model-${independent ? 'mixed' : 'aligned'}.h5`));
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    await page.getByLabel('Signal to plot', { exact: true }).waitFor();
    await verifyGeometry(page, independent);
    const start = page.getByRole('slider', { name: 'Crop start', exact: true });
    await start.press('Home');
    for (let i = 0; i < 5; i++) await start.press('ArrowRight');
    const end = page.getByRole('slider', { name: 'Crop end', exact: true });
    await end.press('Home');
    for (let i = 0; i < 9; i++) await end.press('ArrowRight');
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    await verifyGeometry(page, independent);
    await page.getByLabel('Signal to plot', { exact: true }).selectOption('ik:0');
    await page.locator('.u-legend').getByText(/IK ·/).waitFor();
    const frame = page.getByRole('slider', { name: 'Frame', exact: true });
    await frame.press('Home');
    const cursor = await page.locator('.playhead').getAttribute('style');
    await frame.press('End');
    await page.waitForFunction(
      (previous) => document.querySelector('.playhead')?.getAttribute('style') !== previous,
      cursor,
    );
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
    for (const kind of ['IK', 'ID']) {
      await explorer.getByLabel('Search explorer datasets').fill(`${kind} Results`);
      await explorer.locator('nav button').first().click();
      const count = independent && kind === 'ID' ? 20 : 10;
      await explorer
        .locator('.explorer-pagination')
        .getByText(`1–${count} of ${count} samples`)
        .waitFor();
      const firstTime = Number(
        await explorer.locator('tr[data-row="0"] td').nth(2).getAttribute('title'),
      );
      assert(Math.abs(firstTime - (independent && kind === 'ID' ? 7 : 0)) < 1e-10);
    }
    await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
  }
  console.log(
    'Model timing smoke passed: alignment, crop, independent retention, shared cursor and desktop/laptop plot bounds.',
  );
}

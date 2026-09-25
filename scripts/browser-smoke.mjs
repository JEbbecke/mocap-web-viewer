import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
await mkdir('.local', { recursive: true });
const fixtures = JSON.parse(await readFile('tests/fixtures/c3d.json', 'utf8'));
await writeFile('.local/synthetic.c3d', Buffer.from(fixtures.intelFloat, 'base64'));
const h5Fixture = JSON.parse(await readFile('tests/fixtures/h5.json', 'utf8'));
await writeFile('.local/synthetic.h5', Buffer.from(h5Fixture.base64, 'base64'));
const populatedH5 = JSON.parse(await readFile('tests/fixtures/institute-h5.json', 'utf8'));
await writeFile('.local/populated.h5', Buffer.from(populatedH5.base64, 'base64'));
const development = process.env.SMOKE_MODE === 'development';
const base =
  process.env.VITE_BASE_PATH && process.env.VITE_BASE_PATH !== './'
    ? process.env.VITE_BASE_PATH
    : '/';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    ...(development ? [] : ['preview']),
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { cwd: root, windowsHide: true, stdio: 'pipe' },
);
let browser;
let serverOutput = '';
const errors = [],
  requests = [];
server.stdout.on('data', (data) => {
  serverOutput += String(data);
});
server.stderr.on('data', (data) => {
  serverOutput += String(data);
});
try {
  await new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error('Preview server timeout')), 20000);
    server.stdout.on('data', (data) => {
      if (String(data).includes('4173')) {
        clearTimeout(timeout);
        ok();
      }
    });
    server.on('error', fail);
    server.on('exit', (code) => {
      if (code) fail(new Error(`Preview exited: ${code}`));
    });
  });
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text());
  });
  page.on('request', (request) =>
    requests.push({ url: request.url(), method: request.method(), body: request.postData() }),
  );
  await page.goto(`http://127.0.0.1:4173${base}`);
  await page.getByText('Explore the synthetic demo').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(180);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert(
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) > 0,
    'playback advances',
  );
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await page.getByLabel('Search markers').fill('RASI');
  await page.getByRole('button', { name: 'RASI', exact: true }).click();
  assert.equal(await page.locator('.selected-marker h3').textContent(), 'RASI');
  await page.getByLabel('Show RASI', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByLabel('Search markers').fill('');
  const plotBox = await page.locator('.u-over').boundingBox();
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) > 150,
    'plot scrubbing changes timeline',
  );
  const plotFrame = page.getByRole('slider', { name: 'Frame', exact: true });
  const frameBeforeZoom = await plotFrame.getAttribute('aria-valuenow');
  await page.mouse.move(plotBox.x + plotBox.width * 0.2, plotBox.y + plotBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.4, plotBox.y + plotBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  assert.equal(
    await plotFrame.getAttribute('aria-valuenow'),
    frameBeforeZoom,
    'zoom does not scrub',
  );
  await page.mouse.click(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  const zoomedFrame = Number(await plotFrame.getAttribute('aria-valuenow'));
  assert(zoomedFrame > 95 && zoomedFrame < 120, 'click uses the zoomed time range');
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(await plotFrame.getAttribute('aria-valuenow')) > 200,
    'reset restores full time range',
  );
  await page.mouse.move(plotBox.x + plotBox.width * 0.2, plotBox.y + plotBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.4, plotBox.y + plotBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  await page.mouse.dblclick(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(Number(await plotFrame.getAttribute('aria-valuenow')) > 200, 'double-click resets zoom');
  const beforeWheel = await plotFrame.getAttribute('aria-valuenow');
  await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  assert.equal(
    await plotFrame.getAttribute('aria-valuenow'),
    beforeWheel,
    'wheel zoom does not scrub',
  );
  await page.mouse.click(plotBox.x + plotBox.width * 0.75, plotBox.y + plotBox.height * 0.5);
  const wheelZoomed = Number(await plotFrame.getAttribute('aria-valuenow'));
  assert(wheelZoomed > 205 && wheelZoomed < 240, 'wheel zooms in around pointer');
  await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(100);
  await page.mouse.click(plotBox.x + plotBox.width * 0.75, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(await plotFrame.getAttribute('aria-valuenow')) > 260,
    'wheel zooms out to full range',
  );
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  const sidebarFrame = Number(await plotFrame.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    Number(await plotFrame.getAttribute('aria-valuenow')),
    sidebarFrame - 1,
    'frame shortcuts work after clicking a sidebar tab',
  );
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await page.getByLabel('Marker labels', { exact: true }).check();
  await page.getByLabel('Force plate numbers', { exact: true }).uncheck();
  assert.equal(await page.getByLabel('Force plates', { exact: true }).isChecked(), true);
  await page.getByLabel('Force plate numbers', { exact: true }).check();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.screenshot({ path: '.local/plate-numbers-top.png' });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 2, 'split view creates two plots');
  await page.getByLabel('Second signal to plot', { exact: true }).selectOption('marker:1');
  assert.equal(await page.getByLabel('Signal to plot', { exact: true }).inputValue(), 'marker');
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  const secondPlot = page.getByRole('group', { name: 'Second plot', exact: true });
  const secondBox = await secondPlot.locator('.u-over').boundingBox();
  await page.mouse.click(secondBox.x + secondBox.width * 0.4, secondBox.y + secondBox.height * 0.5);
  const splitFrame = Number(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
  );
  assert(splitFrame > 135 && splitFrame < 150, 'second plot scrubs shared playback');
  const fractions = await page
    .locator('.u-over')
    .evaluateAll((plots) =>
      plots.map(
        (plot) => parseFloat(plot.querySelector('.playhead').style.left) / plot.clientWidth,
      ),
    );
  assert(Math.abs(fractions[0] - fractions[1]) < 0.01, 'both plots show the shared cursor');
  await page.mouse.move(secondBox.x + secondBox.width * 0.2, secondBox.y + secondBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width * 0.6, secondBox.y + secondBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  const zoomFractions = await page
    .locator('.u-over')
    .evaluateAll((plots) =>
      plots.map(
        (plot) => parseFloat(plot.querySelector('.playhead').style.left) / plot.clientWidth,
      ),
    );
  assert(
    Math.abs(zoomFractions[0] - fractions[0]) < 0.01,
    'zooming second plot leaves first plot unchanged',
  );
  assert(Math.abs(zoomFractions[1] - fractions[1]) > 0.05, 'second plot has independent zoom');
  await page.getByRole('button', { name: 'Reset second plot zoom', exact: true }).click();
  await page.screenshot({ path: '.local/split-plots.png' });
  await page.getByRole('button', { name: 'Hide plot panel', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 0);
  await page.getByRole('button', { name: 'Show plot panel', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 2);
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 1, 'single view releases the second chart');
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  assert.equal(
    await page.getByLabel('Second signal to plot', { exact: true }).inputValue(),
    'marker:1',
  );
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  await page.screenshot({ path: '.local/screenshot.png' });
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/synthetic.c3d'));
  await page.getByRole('button', { name: 'Add Event', exact: true }).click();
  await page.getByLabel('Event label', { exact: true }).fill('Synthetic added event');
  await page.getByLabel('Time (s)', { exact: true }).fill('0.015');
  await page.getByLabel('Context', { exact: true }).fill('Right');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.getByRole('button', { name: 'Edit event Synthetic added event', exact: true }).click();
  await page.getByLabel('Event label', { exact: true }).fill('Synthetic edited event');
  await page.getByLabel('Time (s)', { exact: true }).fill('0.02');
  await page.screenshot({ path: '.local/event-editor.png' });
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  const eventDownload = page.waitForEvent('download');
  // Compare the arrow's geometric tip with the playback axis, including a scroll gutter.
  const alignment = await page.evaluate(() => {
    const marker = document.querySelector(
      '[aria-label="Edit event Synthetic edited event"] .event-pin',
    );
    const slider = document.querySelector('.timeline-slider');
    const strip = document.querySelector('.event-scroll');
    const offset = () => {
      const pin = marker.getBoundingClientRect(),
        rail = slider.getBoundingClientRect();
      return pin.left + pin.width / 2 - (rail.left + (rail.width * 2) / 3);
    };
    const normal = offset();
    const previous = strip.style.maxHeight;
    strip.style.maxHeight = '6px';
    const scrolling = offset();
    strip.style.maxHeight = previous;
    return { normal, scrolling };
  });
  assert(Math.abs(alignment.normal) < 0.1, 'event tip aligns with its frame');
  assert(Math.abs(alignment.scrolling) < 0.1, 'event scrolling preserves the time axis');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const eventFile = await eventDownload;
  assert.equal(eventFile.suggestedFilename(), 'synthetic_edited.c3d');
  await eventFile.saveAs(resolve('.local/events-edited.c3d'));
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/events-edited.c3d'));
  await page
    .getByRole('button', { name: 'Edit event Synthetic edited event', exact: true })
    .click();
  assert(
    Math.abs(Number(await page.getByLabel('Time (s)', { exact: true }).inputValue()) - 0.02) < 1e-6,
  );
  assert.equal(await page.getByLabel('Context', { exact: true }).inputValue(), 'Right');
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete event', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit event Synthetic edited event', exact: true })
      .count(),
    0,
  );
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/synthetic.c3d'));
  await page.waitForFunction(
    () =>
      document.body.textContent.includes('synthetic.c3d') &&
      !document.body.textContent.includes('Reading your recording'),
  );
  assert.equal(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
    '2',
  );
  const privatePaths = ['03_PRE_GANG12_01.c3d', '03_PRE_GANG12_01.h5', 'virtual_marker.h5']
    .map((n) => resolve('../ibo-biomech', n))
    .filter(existsSync);
  for (const path of [resolve('.local/synthetic.h5'), ...privatePaths]) {
    await page.getByLabel('Open motion file').setInputFiles(path);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0, 'reference file loads without error');
    assert(
      Number(
        await page
          .getByRole('slider', { name: 'Frame', exact: true })
          .getAttribute('aria-valuemax'),
      ) >= 2,
    );
    await page.getByRole('button', { name: 'Jump to end', exact: true }).click();
    await page.getByRole('button', { name: 'Jump to beginning', exact: true }).click();
  }
  // Populated schema, actual import/export workers, events and no-op byte identity.
  for (const [label, path] of [
    ['populated', resolve('.local/populated.h5')],
    ['authoritative', resolve('reference-data/authoritative_reference.h5')],
  ].filter(([, p]) => existsSync(p))) {
    const open = async (file) => {
      await page.getByLabel('Open motion file').setInputFiles(file);
      await page.waitForFunction(
        () => !document.body.textContent.includes('Reading your recording'),
      );
      assert.equal(await page.getByRole('alert').count(), 0);
    };
    const save = async (suffix) => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const downloaded = await pending,
        target = resolve(`.local/h5-validation/${label}-browser-${suffix}.h5`);
      await downloaded.saveAs(target);
      return target;
    };
    await mkdir('.local/h5-validation', { recursive: true });
    await open(path);
    assert.equal(
      await page.getByRole('button', { name: 'Add Event', exact: true }).isEnabled(),
      true,
    );
    const copy = await save('unchanged');
    assert.deepEqual(
      await readFile(copy),
      await readFile(path),
      'unchanged H5 worker export is byte-identical',
    );
    const options = await page
      .getByLabel('Signal to plot', { exact: true })
      .locator('option')
      .allTextContents();
    for (const group of ['EMG', 'RigidBodies'])
      assert(
        options.some((o) => o.includes(group)),
        `${group} signals exposed`,
      );
    const signalSelect = page.getByLabel('Signal to plot', { exact: true });
    for (const group of ['IKResults', 'IDResults']) {
      assert(!options.some((o) => o.includes(group)), `${group} signals ignored`);
      assert(
        !(await page.locator('body').innerText()).includes(`${group}:`),
        `${group} has no import notes`,
      );
    }
    for (const group of ['EMG', 'RigidBodies']) {
      await signalSelect.selectOption({ index: options.findIndex((o) => o.includes(group)) });
      await page.waitForTimeout(50);
    }
    await signalSelect.selectOption('plate:0:freeMoment');
    await page.getByRole('slider', { name: 'Frame', exact: true }).press('PageUp');
    await page.screenshot({ path: `.local/h5-validation/${label}-view.png` });
    await page.getByLabel('Select event', { exact: true }).selectOption('0');
    await page.getByLabel('Event label', { exact: true }).fill('Browser edited event');
    await page.getByLabel('Description', { exact: true }).fill('Browser event description');
    await page.getByLabel('Time (s)', { exact: true }).fill('0.1');
    assert.equal(
      await page.getByLabel('Context', { exact: true }).count(),
      0,
      'unsupported context is not offered',
    );
    await page.getByRole('button', { name: 'Save event', exact: true }).click();
    const edited = await save('edited');
    await open(edited);
    assert(
      (await page.getByLabel('Select event').locator('option').allTextContents()).some((o) =>
        o.includes('Browser edited event'),
      ),
    );
    await page.getByRole('button', { name: 'Add Event', exact: true }).click();
    await page.getByLabel('Event label', { exact: true }).fill('Browser added event');
    await page.getByLabel('Time (s)', { exact: true }).fill('0.2');
    await page.getByRole('button', { name: 'Save event', exact: true }).click();
    const added = await save('added');
    await open(added);
    const choices = await page.getByLabel('Select event').locator('option').allTextContents();
    const row = choices.findIndex((o) => o.includes('Browser added event'));
    assert(row > 0);
    await page.getByLabel('Select event').selectOption({ index: row });
    await page.getByRole('button', { name: 'Delete event', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm delete event', exact: true }).click();
    const deleted = await save('deleted');
    await open(deleted);
    assert(
      !(await page.getByLabel('Select event').locator('option').allTextContents()).some((o) =>
        o.includes('Browser added event'),
      ),
    );
    await page.getByRole('slider', { name: 'Crop start', exact: true }).press('ArrowRight');
    await page.getByRole('slider', { name: 'Crop end', exact: true }).press('Home');
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    const cropped = await save('cropped');
    await open(cropped);
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '0',
    );
  }
  // Actual worker export/download/re-import, with request and storage monitoring still active.
  for (const extension of ['c3d', 'h5']) {
    await page
      .getByLabel('Open motion file')
      .setInputFiles(resolve(`.local/synthetic.${extension}`));
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(
      await page.locator('.timeline input[type="number"]').count(),
      0,
      'no crop frame inputs',
    );
    const start = page.getByRole('slider', { name: 'Crop start', exact: true });
    const end = page.getByRole('slider', { name: 'Crop end', exact: true });
    await start.press('End');
    await end.press('Home');
    assert.equal(await start.getAttribute('aria-valuenow'), '2');
    assert.equal(await end.getAttribute('aria-valuenow'), '3', 'handles cannot cross');
    await page.getByRole('button', { name: 'Cancel crop', exact: true }).click();
    assert.equal(await start.getAttribute('aria-valuenow'), '0', 'cancel restores full range');
    const rail = await page.locator('.timeline-slider').boundingBox();
    const handle = await start.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 + rail.width / 3,
      handle.y + handle.height / 2,
      { steps: 8 },
    );
    const playhead = page.getByRole('slider', { name: 'Frame', exact: true });
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '1',
      'frame follows start handle while dragging',
    );
    await page.mouse.up();
    assert.equal(await start.getAttribute('aria-valuenow'), '1', 'drag adjusts start boundary');
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'frame shortcuts work after crop drag',
    );
    assert.equal(
      await start.getAttribute('aria-valuenow'),
      '1',
      'frame shortcut does not edit crop',
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    const endHandle = await end.boundingBox();
    await page.mouse.move(endHandle.x + endHandle.width / 2, endHandle.y + endHandle.height / 2);
    await page.mouse.down();
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'exclusive recording end previews last frame',
    );
    await page.mouse.move(
      endHandle.x + endHandle.width / 2 - rail.width / 3,
      endHandle.y + endHandle.height / 2,
      { steps: 8 },
    );
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'frame follows end handle while dragging',
    );
    await page.mouse.up();
    assert.equal(await end.getAttribute('aria-valuenow'), '2', 'end adjusts independently');
    await end.press('ArrowRight');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(80);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    assert(
      Number(
        await page
          .getByRole('slider', { name: 'Frame', exact: true })
          .getAttribute('aria-valuenow'),
      ) >= 1,
      'preview stays in crop range',
    );
    if (extension === 'h5') await page.screenshot({ path: '.local/crop-selection.png' });
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '1',
    );
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `synthetic_cropped.${extension}`);
    const downloaded = resolve(`.local/synthetic_cropped.${extension}`);
    await download.saveAs(downloaded);
    await page.getByRole('button', { name: 'Restore original', exact: true }).click();
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '2',
    );
    await page.getByLabel('Open motion file').setInputFiles(downloaded);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '1',
    );
  }
  // Created by the moving-plate tests: real H5 with marker-rate global corners,
  // independently sampled forces and a translating/tilting pose.
  if (existsSync('.local/moving-plates.h5')) {
    await page.getByLabel('Open motion file').setInputFiles(resolve('.local/moving-plates.h5'));
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Top', exact: true }).click();
    await page.getByRole('tab', { name: 'Display', exact: true }).click();
    for (const name of [
      'Markers',
      'Marker connections',
      'Force plate numbers',
      'Ground reaction forces',
      'Centre of pressure',
      'Marker labels',
      'Ground grid',
      'Coordinate axes',
    ])
      await page.getByRole('checkbox', { name, exact: true }).uncheck();
    const plates = page.getByRole('checkbox', { name: 'Force plates', exact: true });
    const frame = page.getByRole('slider', { name: 'Frame', exact: true });
    const canvas = page.locator('.viewport canvas');
    await frame.press('Home');
    await plates.uncheck();
    await page.waitForTimeout(250);
    const empty = await canvas.screenshot();
    await plates.check();
    await page.waitForTimeout(100);
    const first = await canvas.screenshot({ path: '.local/moving-plate-frame-0.png' });
    assert(!first.equals(empty), 'moving H5 plate surface is visible without force or markers');
    await frame.press('ArrowRight');
    await page.waitForTimeout(100);
    const middle = await canvas.screenshot({ path: '.local/moving-plate-frame-1.png' });
    assert(!middle.equals(empty), 'translated and tilted plate remains visible');
    assert(!middle.equals(first), 'plate surface follows its geometry frame');
    await frame.press('ArrowRight');
    await page.waitForTimeout(100);
    const last = await canvas.screenshot({ path: '.local/moving-plate-frame-2.png' });
    assert(!last.equals(empty), 'final plate frame remains in camera bounds');
    assert(!last.equals(middle), 'plate advances to final geometry frame');
  }
  // Bad file must leave the previous usable trial in place.
  assert.deepEqual(errors, [], 'no runtime/CSP errors while opening valid files');
  await page.getByLabel('Open motion file').setInputFiles({
    name: 'broken.c3d',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  assert.equal(await page.getByRole('slider', { name: 'Frame', exact: true }).count(), 1);
  const unexpectedErrors = errors.filter(
    (message) => !(development && message.startsWith('Error: Invalid C3D header.')),
  );
  assert.deepEqual(unexpectedErrors, [], 'no unexpected runtime/CSP errors');
  for (const request of requests) {
    const url = new URL(request.url);
    assert.equal(url.origin, 'http://127.0.0.1:4173');
    assert.equal(request.method, 'GET');
    assert.equal(request.body, null);
    if (!development) {
      assert(url.pathname.startsWith(base));
      const path = url.pathname.slice(base.length);
      assert(
        path === '' || path === 'icon.svg' || /^assets\/[\w.-]+\.(js|css)$/.test(path),
        `unexpected request ${url.pathname}`,
      );
      assert.equal(url.search, '');
    }
  }
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    caches: await caches.keys(),
    databases: await indexedDB.databases(),
  }));
  assert.deepEqual(storage, { local: 0, session: 0, caches: [], databases: [] });
  await writeFile(
    `.local/browser-report${development ? '-dev' : base === '/' ? '' : '-subpath'}.json`,
    JSON.stringify(
      {
        passed: true,
        development,
        base,
        runtimeErrors: unexpectedErrors,
        expectedDeveloperErrors: errors.filter((message) => !unexpectedErrors.includes(message)),
        requests: requests.map((r) => new URL(r.url).pathname),
        storage,
        privateFilesChecked: privatePaths.length,
      },
      null,
      2,
    ),
  );
  console.log(
    'Browser smoke passed: demo controls, local C3D/H5, errors, static-only traffic and no persistence.',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  await writeFile(
    '.local/browser-failure.json',
    JSON.stringify(
      {
        error: String(error),
        errors,
        serverOutput,
        body: page ? await page.locator('body').innerText() : '',
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill();
}

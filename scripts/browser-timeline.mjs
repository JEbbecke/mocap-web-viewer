import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyEventEditor } from './browser-event-editor.mjs';

export function createTimelineFixture(
  filename = '.local/timeline-ui.h5',
  firstFrame = 120,
  edges = false,
) {
  const file = new h5.File(resolve(filename), 'w');
  try {
    file.create_group('MetaData').create_group('Project');
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 100);
    trajectories.create_attribute('StartFrame', firstFrame);
    const labeled = trajectories.create_group('Labeled');
    labeled.create_attribute('Labels', ['Synthetic marker']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({
      name: 'Data',
      data: new Float64Array(400).fill(1),
      shape: [1, 4, 100],
    });
    const events = file.create_group('Events');
    const times = [0.2, ...Array.from({ length: 8 }, (_, i) => 0.5 + i * 0.0001), 0.8];
    const names = ['A', ...Array.from({ length: 8 }, (_, i) => `Close ${i}`), 'B'];
    if (edges) {
      times.unshift(0);
      times.push(0.99);
      names.unshift('Start edge');
      names.push('End edge');
    }
    for (const [name, data] of Object.entries({
      Name: names,
      Context: times.map((_, i) => (i % 2 ? 'Left' : 'Right')),
      Description: times.map(() => 'Description'),
      Subject: times.map(() => 'Synthetic'),
      Time: Float64Array.from(times, (time) => firstFrame / 100 + time),
      Frame: Int32Array.from(times, (time) => firstFrame + Math.round(time * 100)),
      GenericFlag: new Int32Array(times.length),
      IconID: new Int32Array(times.length),
    }))
      events.create_dataset({ name, data, shape: [times.length] });
  } finally {
    file.close();
  }
}

export async function verifyTimelineLayout(page) {
  const originalViewport = page.viewportSize();
  const reports = [];
  const showSidebar = page.getByRole('button', { name: 'Show right sidebar', exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  const load = async () => {
    await page.getByLabel('Open motion file').setInputFiles(resolve('.local/timeline-ui.h5'));
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    await page.waitForFunction(
      () =>
        document.querySelector('.header-file')?.textContent.includes('timeline-ui.h5') &&
        document.querySelector('[aria-label="Frame"]')?.getAttribute('aria-valuemax') === '99',
    );
    await page.getByRole('button', { name: 'Add Event', exact: true }).waitFor();
    await page.locator('.workspace').evaluate((el) => {
      el.scrollTop = 0;
    });
  };
  const button = (name) => page.getByRole('button', { name, exact: true });
  const editor = page.locator('.event-editor');
  const start = page.getByRole('slider', { name: 'Crop start', exact: true });
  const end = page.getByRole('slider', { name: 'Crop end', exact: true });
  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  const geometry = async () => {
    // Compare viewport coordinates at one scroll position across all states.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector('.workspace').scrollTop = 0;
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    return page.locator('.timeline').evaluate((row) => {
      const selectors = [
        '.transport',
        '.time-labels',
        '.timeline-slider',
        '.timeline-rail',
        '.event-scroll',
        '.speed-label',
        '.playback-settings .inline-check',
        '.crop-actions',
        '.event-toolbar',
      ];
      return Object.fromEntries(
        selectors.map((selector) => {
          const bounds = row.querySelector(selector).getBoundingClientRect();
          return [selector, [bounds.x, bounds.y, bounds.width, bounds.height]];
        }),
      );
    });
  };
  const layout = async (state) => {
    const result = await page.locator('.timeline').evaluate((panel) => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      };
      const rect = (selector) => box(panel.querySelector(selector));
      const bounds = box(panel);
      const groups = [
        '.transport',
        '.scrubber',
        '.playback-settings',
        '.crop-actions',
        '.event-toolbar',
      ].map(rect);
      const problems = [];
      const inside = (r) =>
        r.x >= bounds.x - 1 &&
        r.right <= bounds.right + 1 &&
        r.y >= bounds.y - 1 &&
        r.bottom <= bounds.bottom + 1;
      for (const group of groups) if (!inside(group)) problems.push('control group escapes panel');
      for (let i = 0; i < groups.length; i++)
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i],
            b = groups[j];
          if (
            Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1
          )
            problems.push('primary groups overlap');
        }
      for (const control of panel.querySelectorAll('button, select, input, [role="slider"]')) {
        if (control.closest('.event-scroll')) continue;
        const r = box(control);
        if (!inside(r))
          problems.push(
            `${control.getAttribute('aria-label') || control.textContent.trim()} escapes panel`,
          );
        if (control.tagName === 'BUTTON' && r.h < 24)
          problems.push('button target shrank below 24px');
      }
      for (const selector of ['.time-labels > *', '.crop-readout > span']) {
        const text = [...panel.querySelectorAll(selector)].map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return box(range);
        });
        const scrubber = rect('.scrubber');
        for (const r of text)
          if (r.x < scrubber.x - 1 || r.right > scrubber.right + 1 || r.h > 17)
            problems.push('axis labels wrap or escape');
        for (let i = 1; i < text.length; i++)
          if (text[i - 1].right > text[i].x + 1) problems.push('axis labels overlap');
      }
      const center = (r) => r.y + r.h / 2;
      const rail = rect('.timeline-rail');
      const speed = rect('[aria-label="Playback speed"]');
      const loop = rect('[aria-label="Loop playback"]');
      const crop = rect('.crop-actions > button');
      const add = rect('.event-toolbar > button');
      const secondary = rect('.crop-secondary');
      const select = rect('.event-toolbar > select');
      const errors = {
        playback: Math.abs(center(rect('.play-button')) - center(bounds.w > 500 ? rail : speed)),
        speedLoop: Math.abs(center(speed) - center(loop)),
        actionTop: Math.abs(crop.y - add.y),
        actionBottom: Math.abs(secondary.y - select.y),
        actionHeight: Math.max(Math.abs(crop.h - add.h), Math.abs(secondary.h - select.h)),
      };
      for (const [name, error] of Object.entries(errors))
        if (error > 1) problems.push(`${name} alignment ${error}px`);
      const strip = rect('.event-scroll');
      const visiblePins = [...panel.querySelectorAll('.event-pin')]
        .map(box)
        .filter((r) => r.y >= strip.y && r.bottom <= strip.bottom);
      const markerGap = visiblePins.length
        ? rail.y - Math.max(...visiblePins.map((r) => r.bottom))
        : null;
      if (markerGap !== null && (markerGap < 0 || markerGap > 16))
        problems.push(`markers too far from bar (${markerGap}px)`);
      if (bounds.w > 900 && bounds.h > 96)
        problems.push(`desktop height ${bounds.h}px exceeds compact baseline`);
      if (panel.scrollWidth > panel.clientWidth + 1 || document.body.scrollWidth > innerWidth + 1)
        problems.push('horizontal overflow');
      return { bounds, errors, markerGap, problems, railY: rail.y };
    });
    reports.push({ viewport: page.viewportSize(), state, ...result });
    assert.deepEqual(
      result.problems,
      [],
      `${state} at ${page.viewportSize().width}px: ${JSON.stringify(result)}`,
    );
  };
  const stable = async (before, state) => {
    const after = await geometry();
    await layout(state);
    for (const selector of Object.keys(before))
      for (let i = 0; i < 4; i++)
        assert(
          Math.abs(before[selector][i] - after[selector][i]) <= 1,
          `${state}: ${selector}[${i}] ${before[selector][i]} -> ${after[selector][i]}`,
        );
  };
  const fits = async () => {
    assert(
      await page
        .locator('.timeline-section')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    assert(await page.locator('body').evaluate((el) => el.scrollWidth <= innerWidth + 1));
    const controls = page.locator('.event-editor-actions button');
    const boxes = await controls.evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        assert(
          boxes[i].right <= boxes[j].x ||
            boxes[j].right <= boxes[i].x ||
            boxes[i].bottom <= boxes[j].y ||
            boxes[j].bottom <= boxes[i].y,
          'editor actions do not overlap',
        );
  };
  for (const [width, height] of [
    [1600, 1000],
    [1440, 1000],
    [1366, 768],
    [1280, 900],
    [1024, 768],
    [900, 768],
    [800, 900],
    [600, 900],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await load();
    const before = await geometry();
    await layout('normal');
    await page.screenshot({ path: `.local/timeline-${width}-normal.png` });
    assert.equal(await editor.count(), 0);
    assert(await button('Apply crop').isDisabled());
    assert.equal(await start.getAttribute('aria-valuetext'), 'Frame 120, 0.000 seconds');
    await frame.press('ArrowRight');
    await stable(before, 'normal frame navigation');
    await start.press('ArrowRight');
    assert(
      await page
        .locator('.timeline-slider')
        .evaluate((el) => el.classList.contains('has-crop-selection')),
    );
    assert(await button('Apply crop').isEnabled());
    await stable(before, 'crop selection');
    if (width === 1366) await page.screenshot({ path: '.local/timeline-crop.png' });
    await button('Cancel crop').click();
    await stable(before, 'cancel crop');
    await button('Add Event').click();
    assert(await editor.isVisible());
    await stable(before, 'new event');
    await page.getByLabel('Event label', { exact: true }).fill('Draft');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Select event', { exact: true }).selectOption('0');
    await stable(before, 'selected event');
    const editorHeight = (await editor.boundingBox()).height;
    await button('Delete event').click();
    assert((await editor.getByRole('status').innerText()) === 'Delete “A”?');
    assert(await button('Keep event').isVisible());
    assert(
      await button('Keep event').evaluate((el) => el === document.activeElement),
      'keyboard focus stays on the non-destructive action',
    );
    assert.equal(
      await page.getByLabel('Select event', { exact: true }).locator('option').count(),
      11,
      'first delete click changes no data',
    );
    await stable(before, 'pending delete');
    if (width >= 1024)
      assert.equal(
        (await editor.boundingBox()).height,
        editorHeight,
        'desktop confirmation adds no editor row',
      );
    if (width === 1366) {
      const sidebar = await page.locator('.inspector').boundingBox();
      await page.locator('.workspace').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      assert.equal((await page.locator('.inspector').boundingBox()).y, sidebar.y);
      await stable(before, 'workspace scroll');
      await page.locator('.workspace').evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({ path: '.local/timeline-delete.png' });
    }
    await fits();
    await button('Keep event').press('Enter');
    assert(await button('Delete event').isVisible());
    await button('Delete event').click();
    await page.getByLabel('Select event', { exact: true }).selectOption('9');
    assert.equal(
      await button('Confirm delete event').count(),
      0,
      'selection changes cancel deletion',
    );
    assert.equal(await page.getByLabel('Event label', { exact: true }).inputValue(), 'B');
    await button('Delete event').click();
    await button('Keep event').click();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Select event', { exact: true }).selectOption('0');
    assert.equal(
      await button('Confirm delete event').count(),
      0,
      'closed editors discard pending deletion',
    );
    // A locator screenshot scrolls the panel into view, changing viewport geometry.
    await page.screenshot({ path: `.local/timeline-${width}.png` });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await stable(before, 'editor close');
    await start.press('ArrowRight');
    await button('Apply crop').click();
    assert.equal(await frame.getAttribute('aria-valuemax'), '98');
    await stable(before, 'applied crop');
    assert.equal(await button('Cancel crop').count(), 0);
    assert.equal(
      await button('Restore original').getAttribute('title'),
      'Restore original recording',
    );
    await start.press('ArrowRight');
    assert(await button('Cancel crop').isVisible());
    assert.equal(await button('Restore original').count(), 0);
    await stable(before, 'new selection on cropped recording');
    await button('Cancel crop').click();
    await stable(before, 'cancel selection on cropped recording');
    await button('Restore original').click();
    await stable(before, 'restored range');
  }
  createTimelineFixture('.local/timeline-long-frames.h5', 120000000);
  for (const width of [1280, 800, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByLabel('Open motion file')
      .setInputFiles(resolve('.local/timeline-long-frames.h5'));
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    const before = await geometry();
    await layout('long source-frame labels');
    await start.press('ArrowRight');
    await stable(before, 'long source-frame crop');
    await button('Cancel crop').click();
  }
  createTimelineFixture('.local/timeline-edge-events.h5', 120, true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByLabel('Open motion file')
    .setInputFiles(resolve('.local/timeline-edge-events.h5'));
  await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
  for (const name of ['Start edge', 'End edge']) {
    const marker = button(`Edit event ${name}`);
    await marker.focus();
    const correct = await marker.evaluate((el) => {
      const pin = el.querySelector('.event-pin').getBoundingClientRect();
      const rail = document.querySelector('.timeline-slider').getBoundingClientRect();
      return (
        Math.abs(
          pin.x + pin.width / 2 - (rail.x + (rail.width * parseFloat(el.style.left)) / 100),
        ) < 0.1
      );
    });
    assert(correct, 'focusing an edge marker preserves its time-to-pixel position');
    assert(
      await marker.evaluate((el) => {
        const pin = el.querySelector('.event-pin').getBoundingClientRect();
        const strip = el.closest('.event-scroll');
        const clip = strip.getBoundingClientRect();
        return (
          pin.left >= clip.left && pin.right <= clip.right - (strip.offsetWidth - strip.clientWidth)
        );
      }),
      'edge marker triangles are fully visible',
    );
    assert.equal(await page.locator('.event-scroll').evaluate((el) => el.scrollLeft), 0);
  }
  await layout('edge event focus');
  await page.setViewportSize({ width: 1024, height: 900 });
  await load();
  await page.getByRole('button', { name: 'Hide right sidebar', exact: true }).click();
  const expanded = await geometry();
  await layout('collapsed Inspector');
  await button('Add Event').click();
  await stable(expanded, 'editor with collapsed Inspector');
  await page.setViewportSize({ width: 800, height: 900 });
  const resized = await geometry();
  await layout('resized open editor');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await stable(resized, 'close editor after resize');
  await button('Add Event').click();
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const switched = await geometry();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await stable(switched, 'close editor after workspace switch');
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  await showSidebar.click();
  await page.setViewportSize(originalViewport);
  await load();
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByLabel('Search explorer datasets').fill('Metadata');
  await page.locator('.data-explorer nav button').first().click();
  assert((await page.locator('.explorer-scroll').boundingBox()).height > 250);
  const plotBounds = await page.locator('#signal-panel').boundingBox();
  const footerBounds = await page.locator('footer').boundingBox();
  assert(plotBounds.y + plotBounds.height <= footerBounds.y + 1);
  await page.setViewportSize(originalViewport);
  const explorerLayout = await geometry();
  await page.getByLabel('Select event', { exact: true }).selectOption('0');
  await stable(explorerLayout, 'Explorer event editing');
  await button('Delete event').click();
  await stable(explorerLayout, 'Explorer pending delete');
  await button('Add Event').click();
  assert.equal(await button('Confirm delete event').count(), 0);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await stable(explorerLayout, 'Explorer editor close');
  await page.getByLabel('Select event', { exact: true }).selectOption('0');
  await button('Delete event').click();
  await load();
  assert.equal(await editor.count(), 0, 'opening a recording closes a pending confirmation');
  await page.getByLabel('Select event', { exact: true }).selectOption('0');
  assert.equal(await button('Confirm delete event').count(), 0);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  // Exact source-frame edits and all original event fields keep their existing semantics.
  await page.getByLabel('Select event', { exact: true }).selectOption('0');
  await page.getByLabel('Source frame', { exact: true }).fill('145');
  assert.equal(Number(await page.getByLabel('Time (s)', { exact: true }).inputValue()), 0.25);
  await page.getByLabel('Event label', { exact: true }).fill('Edited A');
  for (const [name, value] of [
    ['Context', 'Right'],
    ['Description', 'Changed description'],
    ['Subject', 'Subject'],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await button('Save event').click();
  await page.getByLabel('Select event', { exact: true }).selectOption('0');
  for (const [name, value] of [
    ['Event label', 'Edited A'],
    ['Context', 'Right'],
    ['Description', 'Changed description'],
    ['Subject', 'Subject'],
  ])
    assert.equal(await page.getByLabel(name, { exact: true }).inputValue(), value);
  await button('Delete event').click();
  await button('Confirm delete event').click();
  assert.equal(await editor.count(), 0);
  assert.equal(
    await page.getByLabel('Select event', { exact: true }).locator('option').count(),
    10,
  );
  const remaining = await page
    .getByLabel('Select event', { exact: true })
    .locator('option')
    .allTextContents();
  assert(remaining.some((label) => label.startsWith('B ·')));
  assert(!remaining.some((label) => label.startsWith('Edited A ·')));
  await button('Undo').click();
  assert.equal(
    await page.getByLabel('Select event', { exact: true }).locator('option').count(),
    11,
  );
  await button('Redo').click();
  assert.equal(
    await page.getByLabel('Select event', { exact: true }).locator('option').count(),
    10,
  );
  await button('Restore original').click();
  const alignment = await page.locator('.event-markers').evaluate((strip) => {
    const rail = document.querySelector('.timeline-slider').getBoundingClientRect();
    return [...strip.querySelectorAll('button')].every((marker) => {
      const pin = marker.querySelector('.event-pin').getBoundingClientRect();
      return (
        Math.abs(
          pin.left +
            pin.width / 2 -
            (rail.left + (rail.width * parseFloat(marker.style.left)) / 100),
        ) < 0.1
      );
    });
  });
  assert(alignment, 'close marker lanes keep their temporal positions');
  const denseMarker = page.getByRole('button', { name: 'Edit event Close 7', exact: true });
  await denseMarker.focus();
  const markerBounds = await denseMarker.boundingBox();
  const stripBounds = await page.locator('.event-scroll').boundingBox();
  assert(
    markerBounds.y >= stripBounds.y &&
      markerBounds.y + markerBounds.height <= stripBounds.y + stripBounds.height,
    'dense marker lanes remain keyboard accessible',
  );
  await layout('focused dense marker');
  await writeFile('.local/timeline-layout-report.json', JSON.stringify(reports, null, 2));
  console.log(
    'Timeline UI passed: six states, crop/cancel/restore, inline safe deletion, source frames, fields/history and marker geometry.',
  );
}

// A focused run shortens feedback for browser geometry, using the same production build.
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await mkdir('.local', { recursive: true });
  await h5.ready;
  createTimelineFixture();
  const server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4174',
      '--strictPort',
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  let browser;
  try {
    await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('Timeline preview timeout')), 20000);
      server.stdout.on('data', (chunk) => {
        if (String(chunk).includes('4174')) {
          clearTimeout(timer);
          ok();
        }
      });
      server.on('error', fail);
    });
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'chrome',
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('https://je-motion-analytics.jonasebbecke97.workers.dev/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });
    try {
      if (!process.argv.includes('--editor-only')) await verifyTimelineLayout(page);
      await verifyEventEditor(page);
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: '.local/timeline-failure.png', fullPage: true });
      throw error;
    }
  } finally {
    await browser?.close();
    server.kill();
  }
}

// Live layout checks; all probe code and screenshots stay in ignored .local/.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.local', { recursive: true });
await writeFile(
  '.local/resize-probe.ts',
  `
import { _roots } from '@react-three/fiber';
import { useSession } from '../src/state/session';
export * from '../src/state/session';
export function camera() {
  const root = _roots.get(document.querySelector('.viewport canvas')).store.getState();
  for (let i = 0; i < 240; i++) root.controls.update();
  return { position: root.camera.position.toArray(), target: root.controls.target.toArray(),
    zoom: root.camera.zoom, aspect: root.camera.aspect, size: root.size,
    revision: useSession.getState().camera.revision };
}
`,
);
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4182', '--strictPort'],
  { windowsHide: true, stdio: 'pipe' },
);
let output = '',
  browser;
server.stdout.on('data', (chunk) => (output += chunk));
server.stderr.on('data', (chunk) => (output += chunk));
const errors = [];
const results = [];
try {
  await new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error(`Vite timeout: ${output}`)), 20000);
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('4182')) {
        clearTimeout(timeout);
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
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(() => {
    window.resizeObservers = new Set();
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer {
      observe(...args) {
        window.resizeObservers.add(this);
        super.observe(...args);
      }
      disconnect() {
        window.resizeObservers.delete(this);
        super.disconnect();
      }
    };
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://je-motion-analytics.jonasebbecke97.workers.dev/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('http://127.0.0.1:4182', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Load Example File', exact: true }).click();
  await page.locator('.inspector').waitFor({ timeout: 60000 });
  await page.locator('.uplot').waitFor();
  await page.evaluate(async () => (window.resizeProbe = await import('/.local/resize-probe.ts')));
  const settle = () => page.waitForTimeout(180);
  const separator = (name) => page.getByRole('separator', { name, exact: true });
  const box = (selector) => page.locator(selector).boundingBox();
  const drag = async (name, x, y) => {
    const handle = await separator(name).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + x, handle.y + handle.height / 2 + y, {
      steps: 8,
    });
    await page.mouse.up();
    await settle();
  };
  const near = (actual, expected, label) =>
    assert(Math.abs(actual - expected) < 2, `${label}: ${actual} vs ${expected}`);
  await page.screenshot({ path: '.local/resize-default.png' });
  near((await box('.inspector')).width, 310, 'default width');
  await drag('Trial Inspector width', -100, 0);
  near((await box('.inspector')).width, 410, 'drag width');
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  near((await box('.inspector')).width, 410, 'tab width');
  await page.getByRole('button', { name: 'Hide right sidebar', exact: true }).click();
  assert.equal(await separator('Trial Inspector width').count(), 0);
  await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click();
  near((await box('.inspector')).width, 410, 'expanded width');
  await separator('Trial Inspector width').press('ArrowLeft');
  near((await box('.inspector')).width, 420, 'keyboard width');
  await page.evaluate(() => window.resizeProbe.setFrame(100));
  await separator('Trial Inspector width').press('Home');
  assert.equal(
    await page.evaluate(() => window.resizeProbe.useSession.getState().frame),
    100,
    'separator reset does not invoke Timeline Home',
  );
  near((await box('.inspector')).width, 310, 'keyboard reset');
  await drag('Trial Inspector width', -100, 0);
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  await drag('Explorer navigation width', 80, 0);
  near((await box('.explorer-navigation')).width, 330, 'Explorer width');
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  near((await box('.inspector')).width, 410, 'Visualizer preference');
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  near((await box('.explorer-navigation')).width, 330, 'Explorer preference');
  await separator('Explorer navigation width').dblclick();
  near((await box('.explorer-navigation')).width, 250, 'Explorer reset');
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  results.push(
    'Phase A: sidebar drag, tabs, keyboard/reset, collapse/expand and separate workspace preferences',
  );
  if (process.env.RESIZE_PHASE !== 'A') {
    const before = await box('.scene-wrap');
    const pose = await page.evaluate(() => window.resizeProbe.camera());
    await drag('Signal Inspector height', 0, -100);
    near((await box('#signal-panel')).height, 354, 'plot height');
    near(
      (await box('.scene-wrap')).height,
      before.height - 100,
      'viewer receives remaining height',
    );
    await page.getByRole('button', { name: 'Add Event', exact: true }).click();
    near((await box('#signal-panel')).height, 354, 'editor preserves plot height');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    near((await box('#signal-panel')).height, 354, 'closing editor preserves plot height');
    // Closing the editor changes available height. Wait for R3F's asynchronous
    // ResizeObserver update before reading canvas geometry and camera aspect.
    await page.waitForFunction(() => {
      const scene = document.querySelector('.scene-wrap').getBoundingClientRect();
      const canvas = document.querySelector('.scene-wrap canvas').getBoundingClientRect();
      return Math.abs(canvas.width - scene.width) < 2 && Math.abs(canvas.height - scene.height) < 2;
    });
    const after = await page.evaluate(() => window.resizeProbe.camera());
    for (const key of ['position', 'target'])
      pose[key].forEach((value, i) =>
        assert(Math.abs(after[key][i] - value) < 1e-6, `camera ${key}`),
      );
    assert.equal(after.revision, pose.revision);
    assert.equal(after.zoom, pose.zoom);
    near(after.aspect, after.size.width / after.size.height, 'camera aspect');
    near(
      (await box('.scene-wrap canvas')).height,
      (await box('.scene-wrap')).height,
      'canvas height',
    );
    await page.getByRole('button', { name: 'Hide plot panel', exact: true }).click();
    assert.equal(await separator('Signal Inspector height').count(), 0);
    await page.getByRole('button', { name: 'Show plot panel', exact: true }).click();
    near((await box('#signal-panel')).height, 354, 'expanded plot height');
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    const defaultExplorerHeight = (await box('#signal-panel')).height;
    await drag('Signal Inspector height', 0, -40);
    near((await box('#signal-panel')).height, defaultExplorerHeight + 40, 'Explorer plot height');
    await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
    near((await box('#signal-panel')).height, 354, 'separate Visualizer height');
    await separator('Signal Inspector height').press('Home');
    near((await box('#signal-panel')).height, 254, 'reset plot height');
    await page.setViewportSize({ width: 1366, height: 768 });
    await drag('Signal Inspector height', 0, -10000);
    const shortHeight = (await box('#signal-panel')).height;
    await page.getByRole('button', { name: 'Add Event', exact: true }).click();
    assert((await box('#signal-panel')).height <= shortHeight, 'short viewport clamps for editor');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    near(
      (await box('#signal-panel')).height,
      shortHeight,
      'editor close restores constrained preference',
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    await separator('Signal Inspector height').press('Home');
    results.push(
      'Phase B: vertical drag, viewer/canvas sizing, camera pose, Event Editor and plot collapse/expand',
    );
  }
  if (!process.env.RESIZE_PHASE) {
    await page.getByRole('button', { name: 'Split plots', exact: true }).click();
    await settle();
    let left = await box('.signal-pane:first-child'),
      right = await box('.signal-pane:last-child');
    near(left.width, right.width, 'default equal split');
    await page.locator('select[aria-label="Second signal to plot"]').selectOption('analog:0');
    await settle();
    const selection = await page.locator('select[aria-label="Second signal to plot"]').inputValue();
    const chart = await page.locator('.uplot').first().elementHandle();
    const secondChart = await page.locator('.uplot').last().elementHandle();
    await page.evaluate(() => {
      const state = window.resizeProbe.useSession.getState();
      window.resizeBefore = Object.fromEntries(
        [
          'data',
          'originalData',
          'history',
          'dirty',
          'cropSelection',
          'speed',
          'sourceFile',
          'plot',
        ].map((key) => [key, state[key]]),
      );
      window.resizeSamples = JSON.stringify([
        Array.from(state.data.markers.positions),
        state.data.events,
        state.data.analogs.map((a) => Array.from(a.signal.values)),
      ]);
    });
    await drag('Split plot widths', 160, 0);
    left = await box('.signal-pane:first-child');
    right = await box('.signal-pane:last-child');
    assert(left.width > right.width + 300);
    const ratio = left.width / (left.width + right.width);
    assert(
      await chart.evaluate((node) => node === document.querySelector('.uplot')),
      'resize retains the chart instance',
    );
    assert(
      await secondChart.evaluate((node) => node === document.querySelectorAll('.uplot')[1]),
      'resize retains the second chart instance',
    );
    const savedLeft = left.width;
    await page.getByRole('button', { name: 'Split plots', exact: true }).click();
    await page.getByRole('button', { name: 'Split plots', exact: true }).click();
    await settle();
    near((await box('.signal-pane:first-child')).width, savedLeft, 'toggle preserves ratio');
    assert.equal(
      await page.locator('select[aria-label="Second signal to plot"]').inputValue(),
      selection,
    );
    await drag('Trial Inspector width', -50, 0);
    await drag('Signal Inspector height', 0, -60);
    const width = (await box('.plot-panes')).width;
    near(
      (await box('.signal-pane:first-child')).width,
      width * ratio,
      'nested resize preserves ratio',
    );
    await separator('Split plot widths').press('Home');
    near(
      (await box('.signal-pane:first-child')).width,
      (await box('.signal-pane:last-child')).width,
      'split reset',
    );
    await drag('Split plot widths', -10000, 0);
    near((await box('.signal-pane:first-child')).width, 250, 'left minimum beyond viewport');
    await drag('Split plot widths', 10000, 0);
    near((await box('.signal-pane:last-child')).width, 250, 'right minimum beyond viewport');
    await separator('Split plot widths').dblclick();
    const handle = separator('Trial Inspector width');
    let h = await handle.boundingBox();
    await page.mouse.move(h.x + 4, h.y + 40);
    await page.mouse.down();
    await page.mouse.move(h.x - 20, h.y + 40);
    await settle();
    await handle.dispatchEvent('pointercancel', { pointerId: 1 });
    assert.equal(
      await page.locator('html').getAttribute('data-panel-resize'),
      null,
      'pointer cancel cleans drag',
    );
    const cancelled = (await box('.inspector')).width;
    await page.mouse.move(h.x - 100, h.y + 40);
    await page.mouse.up();
    near((await box('.inspector')).width, cancelled, 'cancel stops resizing');
    h = await handle.boundingBox();
    await page.mouse.move(h.x + 4, h.y + 40);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(
      await page.locator('html').getAttribute('data-panel-resize'),
      null,
      'blur cleans drag',
    );
    await page.mouse.up();
    h = await handle.boundingBox();
    await page.mouse.move(h.x + 4, h.y + 40);
    await page.mouse.down();
    await page
      .getByRole('button', { name: 'Data Explorer', exact: true })
      .evaluate((button) => button.click());
    assert.equal(
      await page.locator('html').getAttribute('data-panel-resize'),
      null,
      'unmount cleans drag',
    );
    await page.mouse.up();
    await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
    await settle();
    const observers = await page.evaluate(() => window.resizeObservers.size);
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Split plots', exact: true }).click();
      await page.getByRole('button', { name: 'Split plots', exact: true }).click();
    }
    await settle();
    assert.equal(
      await page.evaluate(() => window.resizeObservers.size),
      observers,
      'observers cleaned between chart mounts',
    );
    assert(
      await page.evaluate(() => {
        const state = window.resizeProbe.useSession.getState();
        return (
          Object.entries(window.resizeBefore).every(([key, value]) => state[key] === value) &&
          window.resizeSamples ===
            JSON.stringify([
              Array.from(state.data.markers.positions),
              state.data.events,
              state.data.analogs.map((a) => Array.from(a.signal.values)),
            ])
        );
      }),
      'layout preserves scientific buffers, events, speed, crop and history',
    );
    results.push(
      'Phase C: unequal split, both minima, nested resize, selections, ratio restoration, reset, pointer cancellation/blur/unmount, observer cleanup and data invariance',
    );
    await handle.press('Home');
    await drag('Trial Inspector width', -100, 0);
    await separator('Signal Inspector height').press('Home');
    await drag('Signal Inspector height', 0, -60);
    const preferredHeight = (await box('#signal-panel')).height;
    await drag('Split plot widths', 120, 0);
    const responsiveRatio =
      (await box('.signal-pane:first-child')).width / (await box('.plot-panes')).width;
    for (const viewport of [
      { width: 2560, height: 1440 },
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 900, height: 768 },
      { width: 760, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await settle();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `no page overflow at ${viewport.width}`,
      );
      if (viewport.width > 760) {
        near(
          (await box('.scene-wrap canvas')).width,
          (await box('.scene-wrap')).width,
          'responsive canvas width',
        );
        assert((await box('.scene-wrap')).height >= 210);
        assert((await box('#signal-panel')).height >= 180);
      } else {
        assert.equal(await separator('Trial Inspector width').count(), 0);
        assert.equal(await separator('Signal Inspector height').count(), 0);
      }
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.plot-target')].every((target) => {
          const plot = target.querySelector('.uplot');
          return (
            plot && Math.abs(plot.getBoundingClientRect().width - (target.clientWidth - 20)) < 2
          );
        }),
      );
      const plotGeometry = await page.locator('.plot-target').evaluateAll((targets) =>
        targets.map((target) => {
          const plot = target.querySelector('.uplot');
          const legend = target.querySelector('.u-legend');
          const r = target.getBoundingClientRect(),
            p = plot.getBoundingClientRect(),
            l = legend.getBoundingClientRect();
          return {
            width: p.width,
            available: target.clientWidth - 20,
            legendBottom: l.bottom,
            bottom: r.bottom,
          };
        }),
      );
      plotGeometry.forEach((g) => {
        near(g.width, g.available, 'independent chart width');
        assert(g.legendBottom <= g.bottom + 2, 'legend fits vertically');
      });
      assert(
        await page
          .locator('.signal-selector')
          .first()
          .evaluate((element) => element.clientWidth >= 120),
        'split selectors remain usable at minimum chart widths',
      );
      await page.screenshot({
        path: `.local/resize-visualizer-${viewport.width}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
      await settle();
      if (viewport.width === 2560) {
        await page.getByLabel('Search explorer datasets').fill('Trajectories');
        await page.locator('.explorer-navigation button').first().click();
        await page.getByRole('button', { name: 'X [mm]', exact: true }).click();
        await page.locator('.uplot').waitFor();
        const explorerChart = await page.locator('.uplot').elementHandle();
        await drag('Explorer navigation width', 40, 0);
        await drag('Signal Inspector height', 0, 30);
        assert(
          await explorerChart.evaluate((node) => node === document.querySelector('.uplot')),
          'Explorer resize preserves chart and selected columns',
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'X [mm]', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
        await page.getByLabel('Search explorer datasets').fill('');
      }
      await page.waitForFunction(() => {
        const target = document.querySelector('.plot-target'),
          plot = target?.querySelector('.u-wrap');
        return (
          !plot || Math.abs(plot.getBoundingClientRect().width - (target.clientWidth - 20)) < 2
        );
      });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Explorer fits at ${viewport.width}`,
      );
      await page.screenshot({
        path: `.local/resize-explorer-${viewport.width}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await settle();
    near((await box('.inspector')).width, 410, 'restores width after narrow viewports');
    near(
      (await box('#signal-panel')).height,
      preferredHeight,
      'restores height after narrow viewports',
    );
    near(
      (await box('.signal-pane:first-child')).width,
      (await box('.plot-panes')).width * responsiveRatio,
      'restores split ratio after narrow viewports',
    );
    await page.setViewportSize({ width: 900, height: 768 });
    await drag('Signal Inspector height', 0, 10000);
    near((await box('#signal-panel')).height, 180, 'minimum plot height');
    assert(
      await page
        .locator('.plot-target')
        .evaluateAll((targets) =>
          targets.every(
            (target) =>
              target.querySelector('.u-legend').getBoundingClientRect().bottom <=
              target.getBoundingClientRect().bottom + 2,
          ),
        ),
      'legends fit at minimum plot height and width',
    );
    await page.screenshot({ path: '.local/resize-minimum.png' });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await separator('Signal Inspector height').press('Home');
    await drag('Signal Inspector height', 0, 254 - preferredHeight);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('slider', { name: 'Frame', exact: true }).press('ArrowRight');
    const stage = await box('.scene-wrap');
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2 + 60, stage.y + stage.height / 2 + 20, {
      steps: 6,
    });
    await page.mouse.up();
    await page.mouse.wheel(0, -100);
    await settle();
    const pose = await page.evaluate(() => window.resizeProbe.camera());
    await drag('Trial Inspector width', 40, 0);
    await drag('Signal Inspector height', 0, -30);
    const resizedPose = await page.evaluate(() => window.resizeProbe.camera());
    for (const key of ['position', 'target'])
      pose[key].forEach((value, i) =>
        assert(Math.abs(resizedPose[key][i] - value) < 1e-6, `manual camera ${key} unchanged`),
      );
    assert.equal(pose.revision, resizedPose.revision);
    const sidebarWidth = (await box('.inspector')).width,
      plotHeight = (await box('#signal-panel')).height;
    await page.getByLabel('Open motion file').setInputFiles('reference-data/example_data.h5');
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    await settle();
    near((await box('.inspector')).width, sidebarWidth, 'new file retains width');
    near((await box('#signal-panel')).height, plotHeight, 'new file retains height');
    results.push(
      'Responsive: 2560x1440, 1920x1080, 1366x768, 900px, 760px, 390px and 320px; both workspaces, chart/legend sizing, preference restoration, playback/scrub, manual orbit/zoom and file switching',
    );
  }
  assert.deepEqual(errors, []);
  await writeFile('.local/resize-results.json', JSON.stringify({ results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  await page?.screenshot({ path: '.local/resize-failure.png', fullPage: true });
  throw error;
} finally {
  await browser?.close();
  server.kill();
}

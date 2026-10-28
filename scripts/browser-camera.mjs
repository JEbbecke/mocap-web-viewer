// Focused live R3F checks. The probe is generated under ignored .local/ and is
// served only by this test's Vite dev server; production has no camera test API.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as h5 from 'h5wasm/node';
import { verifyMarkerInteractions } from './browser-marker-interactions.mjs';
import { verifyMarkerDeletion } from './browser-marker-deletion.mjs';
const browserChannel = process.env.BROWSER_CHANNEL || 'chrome';

await mkdir('.local', { recursive: true });
await writeFile(
  '.local/camera-probe.ts',
  `
import { _roots } from '@react-three/fiber';
import { Vector3 } from 'three';
import { CameraController } from '../src/viewer/cameraController';
import { dataCameraBounds } from '../src/viewer/cameraBounds';
import { useSession } from '../src/state/session';
import { markerScenePosition } from '../src/viewer/markerPosition';
export * from '../src/state/session';
export * from '../src/state/markerCommands';
export function markerPoint(marker) {
  const root = _roots.get(document.querySelector('.viewport canvas')).store.getState();
  const s = useSession.getState();
  const point = markerScenePosition(s.data, s.frame, marker);
  if (!point) return null;
  const world = point.toArray();
  const ndc = point.project(root.camera);
  const rect = root.gl.domElement.getBoundingClientRect();
  return { world, x: rect.left + (ndc.x + 1) * rect.width / 2,
    y: rect.top + (1 - ndc.y) * rect.height / 2 };
}
export const attempts = [];
export function settleControls() {
  const { controls } = _roots.get(document.querySelector('.viewport canvas')).store.getState();
  // Advance controls deterministically on slow software WebGL runners.
  for(let i = 0; i < 240; i++) controls.update();
}
const reset = CameraController.prototype.resetCameraView;
CameraController.prototype.resetCameraView = function(...args) {
  attempts.push(useSession.getState().camera.revision);
  return reset.apply(this, args);
};
export function snapshot() {
  const root = _roots.get(document.querySelector('.viewport canvas')).store.getState();
  const { camera, controls } = root;
  const state = useSession.getState();
  const bounds = state.data && dataCameraBounds(state.data, state.frame);
  const corners = [];
  if (bounds) for(const x of [bounds.min.x,bounds.max.x])
    for(const y of [bounds.min.y,bounds.max.y]) for(const z of [bounds.min.z,bounds.max.z])
      corners.push(new Vector3(x,y,z).project(camera).toArray());
  return {
    position: camera.position.toArray(), target: controls.target.toArray(),
    enableDamping: controls.enableDamping,
    direction: camera.getWorldDirection(new Vector3()).toArray(),
    aspect: camera.aspect, size: [root.size.width,root.size.height],
    near: camera.near, far: camera.far, corners, attempts: attempts.length,
    frame: state.frame, revision: state.camera.revision,
    center: bounds?.getCenter(new Vector3()).toArray(),
  };
}
`,
);
await h5.ready;
for (const unit of ['mm', 'm']) {
  const file = new h5.File(resolve(`.local/camera-${unit}.h5`), 'w');
  try {
    file.create_group('MetaData').create_group('Project');
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 100);
    trajectories.create_attribute('StartFrame', 120);
    const labeled = trajectories.create_group('Labeled');
    const pose = [
      [-300, -200, 100],
      [350, 250, 1900],
      [-200, 200, 1400],
      [300, -200, 1400],
      [-100, 0, 500],
      [100, 0, 500],
      [-50, 0, 1800],
      [50, 0, 1800],
    ];
    labeled.create_attribute(
      'Labels',
      pose.map((_, i) => `Camera ${i}`),
    );
    labeled.create_attribute('Unit', unit);
    const frames = 100;
    const values = new Float64Array(pose.length * 4 * frames);
    for (let m = 0; m < pose.length; m++)
      for (let f = 0; f < frames; f++)
        for (let a = 0; a < 4; a++)
          values[(m * 4 + a) * frames + f] =
            a === 3
              ? 1
              : (pose[m][a] + [15000 + f * 10, -12000, 2000][a]) * (unit === 'm' ? 0.001 : 1);
    labeled.create_dataset({ name: 'Data', shape: [pose.length, 4, frames], data: values });
    const events = file.create_group('Events');
    events.create_dataset({ name: 'Name', shape: [1], data: ['Camera event'] });
    events.create_dataset({ name: 'Context', shape: [1], data: ['Left'] });
    events.create_dataset({ name: 'Description', shape: [1], data: ['Camera lifecycle check'] });
    events.create_dataset({ name: 'Subject', shape: [1], data: ['Synthetic'] });
    events.create_dataset({ name: 'GenericFlag', shape: [1], data: new Int32Array([0]) });
    events.create_dataset({ name: 'IconID', shape: [1], data: new Int32Array([0]) });
    events.create_dataset({ name: 'Time', shape: [1], data: new Float64Array([1.5]) });
    events.create_dataset({ name: 'Frame', shape: [1], data: new Int32Array([150]) });
  } finally {
    file.close();
  }
}
const c3d = JSON.parse(await readFile('tests/fixtures/c3d.json', 'utf8'));
await writeFile('.local/camera-small.c3d', Buffer.from(c3d.intelFloat, 'base64'));
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4175', '--strictPort'],
  { windowsHide: true, stdio: 'pipe' },
);
let output = '';
server.stdout.on('data', (chunk) => {
  output += chunk;
});
server.stderr.on('data', (chunk) => {
  output += chunk;
});
let browser;
const errors = [];
const results = [];
try {
  await new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error(`Vite timeout: ${output}`)), 20000);
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('4175')) {
        clearTimeout(timeout);
        ok();
      }
    });
    server.on('error', fail);
    server.on('exit', (code) => {
      if (code) fail(new Error(`Vite exited ${code}: ${output}`));
    });
  });
  browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('https://je-motion-analytics.jonasebbecke97.workers.dev/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4175', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    window.cameraProbe = await import('/.local/camera-probe.ts');
  });
  assert.equal(
    await page
      .locator('.viewport canvas')
      .evaluate((canvas) =>
        canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      ),
    false,
    'canvas suppresses native menu before a file is loaded',
  );
  const snapshot = () => page.evaluate(() => window.cameraProbe.snapshot());
  const settle = async () => {
    await page.waitForTimeout(200);
    await page.evaluate(() => window.cameraProbe.settleControls());
    await page.waitForTimeout(100);
  };
  const load = async (file, expectedError) => {
    const before = await page.evaluate(
      () => window.cameraProbe.useSession.getState().camera.revision,
    );
    await page.getByLabel('Open motion file').setInputFiles(resolve(file));
    await page.waitForFunction((revision) => {
      const state = window.cameraProbe.useSession.getState();
      return !state.busy && (state.camera.revision > revision || state.error);
    }, before);
    await settle();
    if (expectedError) {
      assert.match(await page.getByRole('alert').innerText(), expectedError);
      await page.getByRole('button', { name: 'Dismiss error' }).click();
    } else assert.equal(await page.getByRole('alert').count(), 0);
  };
  const equalPose = (a, b, label) => {
    for (const key of ['position', 'target'])
      a[key].forEach((v, i) =>
        assert(Math.abs(v - b[key][i]) < 1e-6, `${label}: ${key}[${i}] changed`),
      );
    assert.equal(a.attempts, b.attempts, `${label}: no fit request`);
  };
  const framed = (state) => {
    assert(state.corners.length === 8);
    assert(state.position.every(Number.isFinite) && state.target.every(Number.isFinite));
    state.target.forEach((v, i) =>
      assert(Math.abs(v - state.center[i]) < 1e-6, 'orbit target is pose center'),
    );
    for (const [x, y, z] of state.corners) {
      assert(
        Math.abs(x) <= 1 / 1.2 + 1e-5 && Math.abs(y) <= 1 / 1.2 + 1e-5,
        'pose fits with margin',
      );
      assert(Math.abs(z) <= 1, 'pose is between clipping planes');
    }
    assert(
      Math.abs(state.aspect - state.size[0] / state.size[1]) < 1e-8,
      'projection matches canvas',
    );
  };
  await load('.local/camera-mm.h5');
  const first = await snapshot();
  assert.equal(first.enableDamping, false, 'camera damping is disabled');
  framed(first);
  assert.equal(first.attempts, 1, 'one automatic fit including StrictMode effect replay');
  assert(first.target[0] > 14 && first.target[1] < -11, 'off-origin pose, no source-frame offset');
  await page.screenshot({ path: '.local/camera-initial-wide.png' });
  const canvas = page.locator('.viewport canvas');
  const box = await canvas.boundingBox();
  const x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 30, { steps: 10 });
  const orbitDrag = await snapshot();
  assert.notDeepEqual(orbitDrag.direction, first.direction, 'orbit responds during mouse drag');
  await page.mouse.up();
  equalPose(orbitDrag, await snapshot(), 'orbit release');
  await settle();
  const rotated = await snapshot();
  equalPose(orbitDrag, rotated, 'orbit has no residual movement');
  assert.notDeepEqual(rotated.direction, first.direction, 'mouse orbit changes orientation');
  rotated.target.forEach((v, i) =>
    assert(Math.abs(v - first.target[i]) < 1e-6, 'orbit keeps fitted pivot'),
  );
  await page.mouse.wheel(0, -150);
  await settle();
  const zoomed = await snapshot();
  assert.notDeepEqual(zoomed.position, rotated.position, 'wheel zoom works');
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 50, y + 20, { steps: 10 });
  const panDrag = await snapshot();
  assert.notDeepEqual(panDrag.target, zoomed.target, 'pan responds during mouse drag');
  await page.mouse.up({ button: 'right' });
  equalPose(panDrag, await snapshot(), 'pan release');
  await settle();
  const manual = await snapshot();
  equalPose(panDrag, manual, 'pan has no residual movement');
  assert.notDeepEqual(manual.target, first.target, 'right drag pans');
  await page.evaluate(() => window.cameraProbe.togglePlay());
  await page.waitForTimeout(200);
  await page.evaluate(() => window.cameraProbe.togglePlay());
  await settle();
  equalPose(manual, await snapshot(), 'playback');
  await page.getByRole('slider', { name: 'Frame', exact: true }).press('End');
  await settle();
  equalPose(manual, await snapshot(), 'timeline scrub');
  await page.evaluate(() => window.cameraProbe.openSessionEvent(0));
  await settle();
  equalPose(manual, await snapshot(), 'event selection/editor resize');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    window.cameraProbe.renameSessionMarker(0, 'Renamed camera marker');
    window.cameraProbe.toggleMarker(1);
  });
  await settle();
  equalPose(manual, await snapshot(), 'marker edit/visibility');
  await page.setViewportSize({ width: 1100, height: 1500 });
  await settle();
  const resized = await snapshot();
  equalPose(manual, resized, 'resize');
  assert.notEqual(resized.aspect, manual.aspect);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await settle();
  const reset = await snapshot();
  framed(reset);
  assert.equal(reset.attempts, 2);
  await page.screenshot({ path: '.local/camera-reset-narrow.png' });
  // Equivalent declared metre source must produce the same view at frame zero.
  await page.getByRole('slider', { name: 'Frame', exact: true }).press('Home');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await settle();
  const mm = await snapshot();
  await load('.local/camera-m.h5');
  const metres = await snapshot();
  framed(metres);
  for (const key of ['position', 'target'])
    mm[key].forEach((v, i) => assert(Math.abs(v - metres[key][i]) < 1e-6));
  await verifyMarkerInteractions(page);
  await verifyMarkerDeletion(page);
  for (const [i, file] of [
    'reference-data/example_data.h5',
    '.local/camera-small.c3d',
    'reference-data/QTM_Example.c3d',
  ].entries()) {
    if (!existsSync(file)) continue;
    await page.setViewportSize(
      i % 2 === 0 ? { width: 1440, height: 1000 } : { width: 1100, height: 1500 },
    );
    await load(file);
    const state = await snapshot();
    framed(state);
    await page.screenshot({ path: `.local/camera-fixture-${i}.png` });
    results.push({
      fixture: file.split('/').at(-1),
      aspect: state.aspect,
      attempts: state.attempts,
    });
  }
  if (existsSync('reference-data/XSENSE_example.c3d')) {
    await load('reference-data/XSENSE_example.c3d');
    framed(await snapshot());
    assert.equal(
      await page.evaluate(
        () => window.cameraProbe.useSession.getState().data.source.partialImport?.omitted,
      ),
      'C3D_ROTATION',
    );
    assert.match(await page.locator('body').innerText(), /rotation data was not imported/);
    results.push({
      fixture: 'XSENSE_example.c3d',
      partialImport: 'existing C3D_ROTATION limitation preserved',
      warningVisible: true,
    });
  }
  assert.deepEqual(errors, [], 'no runtime errors');
  await writeFile(
    `.local/camera-browser-${browserChannel}-report.json`,
    JSON.stringify(
      {
        passed: true,
        browser: browserChannel,
        errors,
        results,
        checked: [
          'automatic fit',
          'pose center/padding/clipping',
          'orbit/zoom/pan',
          'immediate orbit/pan without damping or residual movement',
          'canvas native menu suppression with custom marker menu and outside menus preserved',
          'playback',
          'scrub',
          'event selection',
          'marker edit/visibility',
          'resize without refit',
          'Reset',
          'mm/m equivalence',
          'H5/C3D switching',
          'StrictMode once-only fit',
          'marker focus/context menu/rename/shortcuts',
          'full marker deletion/history/C3D/H5 round trips',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Camera browser checks passed; screenshots/report in .local/.');
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: '.local/camera-browser-failure.png' }).catch(() => {});
  await writeFile(
    '.local/camera-browser-failure.json',
    JSON.stringify(
      {
        error: String(error),
        errors,
        output,
        body: page ? await page.locator('body').innerText() : '',
        session: page
          ? await page.evaluate(() => {
              const state = window.cameraProbe?.useSession.getState();
              return (
                state && {
                  busy: state.busy,
                  error: state.error,
                  camera: state.camera,
                  hasData: !!state.data,
                }
              );
            })
          : null,
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

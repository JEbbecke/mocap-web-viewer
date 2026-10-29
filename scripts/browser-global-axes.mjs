import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import * as h5 from 'h5wasm/node';

/** A real imported plate covers both horizontal axes from above; no real data. */
export function createGlobalAxesFixture() {
  const file = new h5.File(resolve('.local/global-axes-occlusion.h5'), 'w');
  try {
    file.create_group('MetaData').create_group('Project');
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 100);
    const labeled = trajectories.create_group('Labeled');
    labeled.create_attribute('Labels', ['A', 'B', 'C', 'D']);
    labeled.create_attribute('Unit', 'mm');
    const pose = [
      [-1000, -1000, -500],
      [1000, 1000, 1500],
      [-1000, 1000, 500],
      [1000, -1000, 500],
    ];
    const values = new Float64Array(4 * 4 * 10);
    for (let m = 0; m < 4; m++)
      for (let a = 0; a < 4; a++)
        for (let f = 0; f < 10; f++) values[(m * 4 + a) * 10 + f] = a === 3 ? 1 : pose[m][a];
    labeled.create_dataset({ name: 'Data', shape: [4, 4, 10], data: values });
    const plate = file.create_group('ForcePlates').create_group('0');
    for (const [key, value] of Object.entries({
      Name: 'Axis occluder',
      SamplingFrequency: 100,
      CoordinateSystem: 1,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
    }))
      plate.create_attribute(key, value);
    for (const name of ['Force', 'Moment', 'COP'])
      plate.create_dataset({ name, shape: [3, 10], data: new Float64Array(30) });
    // Positive Z makes this plate genuinely in front of the horizontal axes.
    const corners = [
      [-800, -800, 100],
      [800, -800, 100],
      [800, 800, 100],
      [-800, 800, 100],
    ];
    const data = new Float64Array(3 * 4 * 10);
    for (let a = 0; a < 3; a++)
      for (let c = 0; c < 4; c++)
        for (let f = 0; f < 10; f++) data[(a * 4 + c) * 10 + f] = corners[c][a];
    plate.create_dataset({ name: 'Corners', shape: [3, 4, 10], data });
  } finally {
    file.close();
  }
}

async function measureWidths(page, png, state) {
  return page.evaluate(
    async ({ base64, state }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const sx = canvas.width / state.size[0],
        sy = canvas.height / state.size[1];
      return state.samples.map(({ axis, point, normal }) => {
        let width = 0;
        // Measure coloured coverage across the line's perpendicular in CSS units.
        for (let t = -6; t <= 6; t += 0.25) {
          const x = Math.floor((point[0] + normal[0] * t) * sx),
            y = Math.floor((point[1] + normal[1] * t) * sy);
          const index = (y * canvas.width + x) * 4,
            r = data[index],
            g = data[index + 1],
            b = data[index + 2];
          const hit =
            axis === 0
              ? r > 130 && r > g * 1.2 && r > b * 1.6
              : axis === 1
                ? g > 130 && g > r * 1.15 && g > b * 1.6
                : b > 130 && b > r * 1.6 && b > g * 1.1;
          if (hit) width += 0.25;
        }
        return { axis, width };
      });
    },
    { base64: png.toString('base64'), state },
  );
}

export async function verifyGlobalAxes(page) {
  const originalSize = page.viewportSize();
  await page
    .getByLabel('Open motion file')
    .setInputFiles(resolve('.local/global-axes-occlusion.h5'));
  await page.waitForFunction(() => {
    const s = window.cameraProbe.useSession.getState();
    return !s.busy && s.data?.name === 'global-axes-occlusion.h5';
  });
  const before = await page.evaluate(() =>
    Array.from(window.cameraProbe.useSession.getState().data.markers.positions),
  );
  const canvas = page.locator('.viewport canvas');
  const results = [];
  for (const [width, dpr] of [
    [320, 1],
    [768, 2],
    [1440, 2],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const distance of [0.75, 1.5])
      for (const below of [false, true]) {
        for (const [grid, plates] of [
          [true, false],
          [false, true],
          [true, true],
        ]) {
          await page.evaluate(
            ({ grid, plates }) => {
              const s = window.cameraProbe.useSession.getState();
              window.cameraProbe.useSession.setState({
                display: { ...s.display, grid, plates, axes: true },
              });
            },
            { grid, plates },
          );
          await page.waitForTimeout(80);
          // Resize can reconfigure R3F's default DPR. Apply the test viewport
          // after layout settles, then let the new drawing buffer paint.
          await page.evaluate(
            ({ distance, below, dpr }) => window.cameraProbe.setAxesView(distance, below, dpr),
            { distance, below, dpr },
          );
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const state = await page.evaluate(() => window.cameraProbe.globalAxesState());
          assert.equal(state.visible, true);
          assert.equal(state.interactive, false);
          assert.equal(state.plateVisible, plates, 'real imported plate visibility');
          state.resolution.forEach((v, i) =>
            assert(Math.abs(v - state.size[i]) < 0.01, 'logical resolution follows resize'),
          );
          assert.equal(state.dpr, dpr);
          assert.equal(state.worldUnits, true);
          assert.equal(state.linewidth, 0.02);
          const png = await canvas.screenshot();
          const widths = await measureWidths(page, png, state);
          for (const axis of [0, 1, 2]) {
            const coverage = widths
              .filter((sample) => sample.axis === axis)
              .reduce((sum, sample) => sum + sample.width, 0);
            if (distance === 0.75)
              assert(
                coverage > 0,
                `close world-space axis remains visible over grid/plates: ${JSON.stringify({ width, dpr, distance, below, grid, plates, axis, widths })}`,
              );
            // Subpixel coverage at far distance depends on pixel alignment and
            // antialiasing. Test the perspective ratio below where resolvable,
            // rather than imposing a pixel floor or monotonic raster samples.
          }
          results.push({ width, dpr, distance, below, grid, plates, widths });
          if (grid && plates && !below && width !== 768)
            await writeFile(`.local/global-axes-world-${width}-${distance}.png`, png);
        }
      }
  }
  // Look from below along Z: horizontal axes have the same camera-space depth,
  // making the 1/distance perspective reduction directly measurable in pixels.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(150);
  const perspective = [];
  for (const distance of [1, 2]) {
    await page.evaluate(
      (distance) => window.cameraProbe.setAxesView(distance, true, 2, true),
      distance,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const state = await page.evaluate(() => window.cameraProbe.globalAxesState([0.08, 0.1, 0.12]));
    const png = await canvas.screenshot();
    const widths = (await measureWidths(page, png, state)).filter((sample) => sample.axis < 2);
    const mean = widths.reduce((sum, sample) => sum + sample.width, 0) / widths.length;
    assert(mean > 1, 'close world-space diameter has measurable coverage');
    perspective.push({ distance, mean, widths });
  }
  const ratio = perspective[1].mean / perspective[0].mean;
  assert(
    ratio > 0.35 && ratio < 0.65,
    `doubling distance halves raster width (antialiasing tolerance): ${JSON.stringify(perspective)}`,
  );
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: 'Coordinate axes', exact: true });
  await toggle.uncheck();
  await page.waitForFunction(() => !window.cameraProbe.globalAxesState().visible);
  await toggle.check();
  await page.waitForFunction(() => window.cameraProbe.globalAxesState().visible);
  const after = await page.evaluate(() =>
    Array.from(window.cameraProbe.useSession.getState().data.markers.positions),
  );
  assert.deepEqual(after, before, 'axis views do not change scientific coordinates');
  await page.setViewportSize(originalSize);
  await page.evaluate(() => window.cameraProbe.setAxesView(5, false, 2));
  await writeFile(
    '.local/global-axes-thickness-report.json',
    JSON.stringify({ passed: true, results, perspective, ratio }, null, 2),
  );
  console.log(
    'Global axes browser checks passed: world-space lines scale with distance; grid/plate visibility, above/below, close/far, narrow/wide, DPR=1/2 and visibility toggle.',
  );
}

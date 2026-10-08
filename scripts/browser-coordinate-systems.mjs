import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import { captureSceneImage } from './browser-image-export.mjs';
import { captureSceneVideo } from './browser-video-export.mjs';

/** Wholly synthetic current H5, with explicit asymmetric local-to-lab poses. */
export function createCoordinateSystemsFixture() {
  const file = new h5.File(resolve('.local/local-coordinate-systems.h5'), 'w');
  try {
    const metadata = file.create_group('MetaData');
    metadata.create_group('Project');
    const definition = metadata.create_group('C3DParameters').create_group('FORCE_PLATFORM');
    definition.create_group('USED').create_attribute('value', new Int32Array([1]));
    definition.create_group('TYPE').create_attribute('value', new Int32Array([3]));
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 10);
    const labeled = trajectories.create_group('Labeled');
    labeled.create_attribute('Labels', ['Synthetic marker']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({
      name: 'Data',
      shape: [1, 4, 3],
      data: new Float64Array([0, 0, 0, 0, 0, 0, 500, 500, 500, 1, 1, 1]),
    });
    const plate = file.create_group('ForcePlates').create_group('0');
    for (const [key, value] of Object.entries({
      Name: 'Synthetic moving plate',
      SamplingFrequency: 20,
      CoordinateSystem: 1,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
    }))
      plate.create_attribute(key, value);
    for (const name of ['Force', 'Moment', 'COP'])
      plate.create_dataset({ name, shape: [3, 6], data: new Float64Array(18) });
    const body = file.create_group('RigidBodies').create_group('0');
    body.create_attribute('Name', 'Synthetic moving body');
    body.create_attribute('Unit', 'mm');
    const platePosition = new Float64Array(9),
      bodyPosition = new Float64Array(9),
      plateRotation = new Float64Array(27),
      bodyRotation = new Float64Array(27),
      corners = new Float64Array(36);
    const local = [
      [200, 150, 0],
      [-200, 150, 0],
      [-200, -150, 0],
      [200, -150, 0],
    ];
    for (let f = 0; f < 3; f++) {
      const a = 0.4 + f * 0.6,
        b = -0.3 + f * 0.4,
        c = Math.cos(a),
        s = Math.sin(a),
        u = Math.cos(b),
        v = Math.sin(b);
      const r = [c, -s * u, s * v, s, c * u, -c * v, 0, v, u];
      r.forEach((value, j) => {
        // Plate Z faces down; body orientation remains independently defined.
        plateRotation[j * 3 + f] = j % 3 === 0 ? value : -value;
        bodyRotation[j * 3 + f] = value;
      });
      const center = [300 + f * 250, -150 + f * 100, 100 + f * 100];
      center.forEach((value, j) => {
        platePosition[j * 3 + f] = value;
        bodyPosition[j * 3 + f] = [-250 + f * 120, 300 - f * 100, 400 + f * 50][j];
      });
      local.forEach((corner, j) => {
        for (let k = 0; k < 3; k++)
          corners[(k * 4 + j) * 3 + f] =
            center[k] + r[k * 3] * corner[0] + r[k * 3 + 1] * corner[1];
      });
    }
    plate.create_dataset({ name: 'Corners', shape: [3, 4, 3], data: corners });
    plate.create_dataset({ name: 'Position', shape: [3, 3], data: platePosition });
    plate.create_dataset({ name: 'Rotation', shape: [3, 3, 3], data: plateRotation });
    plate.create_dataset({
      name: 'Origin',
      shape: [3, 1],
      data: new Float64Array([120, 100, -50]),
    });
    body.create_dataset({ name: 'Position', shape: [3, 3], data: bodyPosition });
    body.create_dataset({ name: 'Rotation', shape: [3, 3, 3], data: bodyRotation });
  } finally {
    file.close();
  }
}

// Broad foreground/colour checks, without antialiasing snapshots or retained images.
async function axesContent(page, png) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const result = { count: 0, red: 0, green: 0, blue: 0, x: 0, y: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      if (Math.max(Math.abs(r - 17), Math.abs(g - 28), Math.abs(b - 38)) <= 3) continue;
      result.count++;
      result.x += (i / 4) % canvas.width;
      result.y += Math.floor(i / 4 / canvas.width);
      if (r > g + 20 && r > b + 20) result.red++;
      if (g > r + 20 && g > b + 20) result.green++;
      if (b > r + 20 && b > g + 20) result.blue++;
    }
    return result;
  }, png.toString('base64'));
}

// WebM is lossy: ignore small background RGB changes when checking decoded scene content.
function decodedContent(pixels, width) {
  const result = { count: 0, x: 0, y: 0 };
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      Math.max(
        Math.abs(pixels[i] - 17),
        Math.abs(pixels[i + 1] - 28),
        Math.abs(pixels[i + 2] - 38),
      ) <= 12
    )
      continue;
    result.count++;
    result.x += (i / 4) % width;
    result.y += Math.floor(i / 4 / width);
  }
  return result;
}

export async function verifyCoordinateSystems(page) {
  await page
    .getByLabel('Open motion file')
    .setInputFiles(resolve('.local/local-coordinate-systems.h5'));
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  const plate = page.getByRole('checkbox', {
    name: 'Force platform coordinate systems',
    exact: true,
  });
  const body = page.getByRole('checkbox', { name: 'Rigid body coordinate systems', exact: true });
  assert.equal(await plate.isChecked(), true, 'platform helper defaults on');
  assert.equal(await body.isChecked(), true, 'body helper defaults on');
  const checkboxes = page.locator('.display-options input');
  const settings = await checkboxes.evaluateAll((inputs) => inputs.map((input) => input.checked));
  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  const scientificUI = () =>
    page.evaluate(() => ({
      file: document.querySelector('.header-file')?.textContent,
      undo: document.querySelector('[title^="Undo"]')?.disabled,
      redo: document.querySelector('[title^="Redo"]')?.disabled,
    }));
  const before = await scientificUI();
  for (let i = 0; i < (await checkboxes.count()); i++) await checkboxes.nth(i).uncheck();
  // PNG capture reads the current scene after a completed live frame and excludes DOM overlays.
  const content = async () =>
    axesContent(
      page,
      await captureSceneImage(page, 'local-coordinate-systems.h5', 'viewport', false),
    );
  assert.equal((await content()).count, 0, 'disabled helpers leave only the background');
  for (const toggle of [plate, body]) {
    await frame.press('Home');
    await toggle.check();
    assert.equal(
      await (toggle === plate ? body : plate).isChecked(),
      false,
      'independent controls',
    );
    const first = await content();
    assert(first.red > 0 && first.green > 0 && first.blue > 0, 'XYZ have conventional colours');
    await frame.press('ArrowRight');
    const second = await content();
    assert(second.count > 0, 'helper remains visible on the next pose');
    assert.notDeepEqual(first, second, 'timeline changes move/rotate the helper');
    await toggle.uncheck();
    assert.equal((await content()).count, 0, 'turning helper off hides it');
  }
  await plate.check();
  await body.check();
  const shown = await axesContent(
    page,
    await captureSceneImage(page, 'local-coordinate-systems.h5', 'viewport', false),
  );
  assert(shown.count > 0, 'image export includes visible helpers');
  const video = await captureSceneVideo(page, 'local-coordinate-systems.h5', 0.2, {
    fps: 30,
    resolution: 'viewport',
    // Preserve the thin 100 mm axes when inspecting lossy decoded frames.
    decodedSampleSize: 256,
  });
  const decoded = video.playable.samples.map((pixels) =>
    decodedContent(pixels, video.playable.sampleSize),
  );
  assert(
    decoded.every((sample) => sample.count > 0),
    'video includes visible helpers',
  );
  assert.notDeepEqual(decoded[0], decoded[1], 'video helpers follow their source poses');
  await plate.uncheck();
  await body.uncheck();
  const hidden = await axesContent(
    page,
    await captureSceneImage(page, 'local-coordinate-systems.h5', 'viewport', false),
  );
  assert.equal(hidden.count, 0, 'image export omits disabled helpers');
  const hiddenVideo = await captureSceneVideo(page, 'local-coordinate-systems.h5', 0.2, {
    fps: 30,
    resolution: 'viewport',
    decodedSampleSize: 256,
  });
  assert(
    hiddenVideo.playable.samples.every(
      (pixels) => decodedContent(pixels, hiddenVideo.playable.sampleSize).count === 0,
    ),
    'hidden helpers stay absent from video',
  );
  assert.deepEqual(
    await scientificUI(),
    before,
    'display/media operations preserve clean state and history',
  );
  for (let i = 0; i < settings.length; i++) await checkboxes.nth(i).setChecked(settings[i]);
}

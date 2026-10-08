import assert from 'node:assert/strict';
import { inspectWebm } from './webm-inspect.mjs';
import { captureSceneImage, openMediaWorkflow } from './browser-image-export.mjs';

const uiSnapshot = (page) =>
  page.evaluate(() => ({
    frame: document
      .querySelector('[role="slider"][aria-label="Frame"]')
      ?.getAttribute('aria-valuenow'),
    file: document.querySelector('.header-file')?.textContent,
    undo: document.querySelector('[title^="Undo"]')?.disabled,
    redo: document.querySelector('[title^="Redo"]')?.disabled,
    canvas: [...document.querySelectorAll('.viewport canvas')].map((canvas) => [
      canvas.width,
      canvas.height,
    ]),
  }));

export async function captureSceneVideo(
  page,
  sourceName,
  physicalDuration,
  { fps = 30, speed = 1, watermark = false, resolution = '1080p', decodedSampleSize = 64 } = {},
) {
  await openMediaWorkflow(page, 'video');
  const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
  await dialog.getByLabel('Video resolution', { exact: true }).selectOption(resolution);
  await dialog.getByLabel('Frame rate', { exact: true }).selectOption(String(fps));
  await dialog.getByLabel('Playback speed', { exact: true }).selectOption(String(speed));
  await dialog.getByLabel('Include JE Motion Lab watermark', { exact: true }).setChecked(watermark);
  const download = page.waitForEvent('download', { timeout: 120000 });
  await dialog.getByRole('button', { name: 'Export video', exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert(bytes.length > 0, 'video is not empty');
  assert.equal(file.suggestedFilename(), `${sourceName.replace(/\.[^.]*$/, '')}_3d_${fps}fps.webm`);
  const parsed = inspectWebm(bytes);
  assert(['V_VP8', 'V_VP9'].includes(parsed.codecID));
  assert(
    Math.abs(parsed.durationSeconds - physicalDuration / speed) <= 1e-6,
    'physical/video duration mapping',
  );
  const exactCount = (physicalDuration / speed) * fps;
  const expectedCount =
    Math.abs(exactCount - Math.round(exactCount)) < 1e-9
      ? Math.round(exactCount)
      : Math.ceil(exactCount);
  assert.equal(parsed.packets.length, expectedCount, 'no omitted/duplicated video frames');
  for (let i = 0; i < parsed.packets.length; i++)
    assert.equal(parsed.packets[i].timestamp, Math.round((i / fps) * 1e6));
  if (resolution === '1080p') assert.deepEqual([parsed.width, parsed.height], [1920, 1080]);
  await dialog.getByRole('status').filter({ hasText: 'Video exported.' }).waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await file.delete();
  // Validate the exported file in a blank local page: the app deliberately blocks embedded Blob media.
  const playbackPage = await page.context().browser().newPage();
  let playable;
  try {
    playable = await playbackPage.evaluate(
      async ({ base64, sampleSize }) => {
        const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([data], { type: 'video/webm' }));
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Video decoding timed out')), 10000);
            video.onloadeddata = () => {
              clearTimeout(timer);
              resolve();
            };
            video.onerror = () => {
              clearTimeout(timer);
              reject(new Error('Exported WebM cannot play'));
            };
            video.src = url;
          });
          const canvas = document.createElement('canvas');
          canvas.width = sampleSize;
          canvas.height = sampleSize;
          const context = canvas.getContext('2d');
          context.drawImage(video, 0, 0, sampleSize, sampleSize);
          const pixels = Array.from(context.getImageData(0, 0, sampleSize, sampleSize).data);
          const samples = [];
          for (const time of [0, video.duration * 0.5, video.duration - 1e-6]) {
            if (time > 0)
              await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Video seek timed out')), 10000);
                video.onseeked = () => {
                  clearTimeout(timer);
                  resolve();
                };
                video.currentTime = time;
              });
            context.drawImage(video, 0, 0, sampleSize, sampleSize);
            samples.push(Array.from(context.getImageData(0, 0, sampleSize, sampleSize).data));
          }
          return {
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            pixels,
            samples,
            sampleSize,
          };
        } finally {
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(url);
        }
      },
      { base64: bytes.toString('base64'), sampleSize: decodedSampleSize },
    );
  } finally {
    await playbackPage.close();
  }
  assert.equal(playable.width, parsed.width);
  assert.equal(playable.height, parsed.height);
  assert(
    Math.abs(playable.duration - parsed.durationSeconds) < 0.001,
    'browser decodes the declared duration',
  );
  return { parsed, playable };
}

export async function verifyVideoExport(page, sourceName, duration) {
  assert.equal(await page.getByRole('button', { name: 'Export media', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Export image', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Export media', exact: true }).click();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), [
    'Export image…',
    'Export video…',
  ]);
  await page.waitForFunction(
    () => !document.body.textContent.includes('Checking video export support…'),
  );
  const supported = await page
    .getByRole('menuitem', { name: 'Export video…', exact: true })
    .isEnabled();
  assert(await page.getByRole('menuitem', { name: 'Export image…', exact: true }).isEnabled());
  await page.getByRole('menu').press('Escape');
  if (!supported) {
    await captureSceneImage(page, sourceName, 'viewport', false);
    console.log('Video unavailable: image fallback passed.');
    return;
  }
  await openMediaWorkflow(page, 'video');
  const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
  assert.equal(await page.getByRole('dialog', { name: 'Export image', exact: true }).count(), 0);
  assert.equal(await dialog.getByLabel('Frame rate', { exact: true }).inputValue(), '30');
  assert.equal(await dialog.getByLabel('Playback speed', { exact: true }).inputValue(), '1');
  assert.equal(await dialog.getByLabel('Video resolution', { exact: true }).inputValue(), '1080p');
  assert(await dialog.getByLabel('Include JE Motion Lab watermark', { exact: true }).isChecked());
  await dialog.press('Escape');
  const before = await uiSnapshot(page);
  await captureSceneVideo(page, sourceName, duration, { watermark: true });
  await captureSceneVideo(page, sourceName, duration, {
    fps: 60,
    speed: 0.5,
    resolution: 'viewport',
  });
  assert.deepEqual(
    await uiSnapshot(page),
    before,
    'successful video export preserves viewer/timeline/history',
  );
  // Delay a real native encoder flush so cancellation can be inspected reliably even on tiny clips.
  await page.evaluate(() => {
    const original = VideoEncoder.prototype.flush;
    window.__videoExportRestoreFlush = () => {
      VideoEncoder.prototype.flush = original;
    };
    window.__videoExportFlushStarted = false;
    VideoEncoder.prototype.flush = async function () {
      window.__videoExportFlushStarted = true;
      await original.call(this);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    };
  });
  let exported = 0;
  const count = () => exported++;
  page.on('download', count);
  try {
    await openMediaWorkflow(page, 'video');
    await dialog.getByRole('button', { name: 'Export video', exact: true }).click();
    await page.waitForFunction(() => window.__videoExportFlushStarted);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(1200);
    assert.equal(exported, 0, 'cancelled video is never offered as a complete file');
    assert.deepEqual(await uiSnapshot(page), before, 'cancellation restores the video workflow');
  } finally {
    page.off('download', count);
    await page.evaluate(() => {
      window.__videoExportRestoreFlush();
      delete window.__videoExportRestoreFlush;
      delete window.__videoExportFlushStarted;
    });
  }
  // Simulate a browser without WebCodecs: only the video menu item is disabled.
  await page.evaluate(() => {
    window.__savedVideoEncoder = window.VideoEncoder;
    window.VideoEncoder = undefined;
  });
  try {
    await page.getByRole('button', { name: 'Export media', exact: true }).click();
    await page
      .getByRole('status')
      .filter({ hasText: 'does not expose a supported video encoder' })
      .waitFor();
    assert(await page.getByRole('menuitem', { name: 'Export video…', exact: true }).isDisabled());
    assert(await page.getByRole('menuitem', { name: 'Export image…', exact: true }).isEnabled());
    await page.getByRole('menuitem', { name: 'Export image…', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Export image', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
  } finally {
    await page.evaluate(() => {
      window.VideoEncoder = window.__savedVideoEncoder;
      delete window.__savedVideoEncoder;
    });
  }
  await captureSceneImage(page, sourceName, 'viewport', false);
  console.log(
    'Video/media smoke passed: native WebM playback, explicit timestamps/duration, 30/60 fps, slow motion, cancellation, unsupported fallback and unchanged state.',
  );
}
export async function verifyMovingPlateVideo(page) {
  const before = await uiSnapshot(page);
  const result = await captureSceneVideo(page, 'moving-plates.h5', 0.02, {
    fps: 60,
    speed: 0.25,
    resolution: 'viewport',
  });
  assert.notDeepEqual(
    result.playable.samples[0],
    result.playable.samples[2],
    'decoded video follows moving geometry instead of repeating the live frame',
  );
  assert.deepEqual(
    await uiSnapshot(page),
    before,
    'moving-plate video leaves the selected live frame unchanged',
  );
}

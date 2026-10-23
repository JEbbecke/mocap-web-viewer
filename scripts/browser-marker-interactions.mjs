import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Uses browser-camera's development-only probe; no instrumentation ships in dist. */
export async function verifyMarkerInteractions(page) {
  const state = () =>
    page.evaluate(() => {
      const s = window.cameraProbe.useSession.getState();
      return {
        selected: s.selected,
        frame: s.frame,
        playing: s.playing,
        labels: s.data.markers.labels,
        revision: s.camera.revision,
        history: s.history.past.length,
        menu: !!s.markerMenu,
        rename: !!s.markerRename,
      };
    });
  const snapshot = () => page.evaluate(() => window.cameraProbe.snapshot());
  const settle = async () => {
    await page.evaluate(() => window.cameraProbe.settleControls());
    await page.waitForTimeout(100);
  };
  const viewer = page.getByLabel('3D Viewer', { exact: true });
  const menu = page.getByRole('menu', { name: /^Marker:/ });
  const dialog = page.getByRole('dialog', { name: 'Rename marker', exact: true });
  const vectorEqual = (a, b, label) =>
    a.forEach((v, i) => assert(Math.abs(v - b[i]) < 1e-6, label));
  const point = (marker) => page.evaluate((m) => window.cameraProbe.markerPoint(m), marker);
  const openMenu = async (marker) => {
    await settle();
    const p = await point(marker);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await menu.waitFor();
    assert.equal((await state()).selected, marker);
    assert.equal(await page.evaluate(() => window.lastMarkerContextPrevented), true);
  };
  await page.evaluate(() => {
    window.addEventListener('contextmenu', (event) => {
      queueMicrotask(() => {
        window.lastMarkerContextPrevented = event.defaultPrevented;
      });
    });
    window.cameraProbe.setFrame(0);
  });
  await openMenu(1);
  assert(!(await menu.getByRole('menuitem', { name: /Delete marker/ }).isDisabled()));
  const before = await snapshot();
  const expected = (await point(1)).world;
  await menu.getByRole('menuitem', { name: /Focus camera/ }).click();
  await settle();
  const focused = await snapshot();
  vectorEqual(focused.target, expected, 'marker is exact orbit pivot');
  vectorEqual(
    focused.position.map((v, i) => v - focused.target[i]),
    before.position.map((v, i) => v - before.target[i]),
    'focus preserves offset',
  );
  assert.equal((await state()).history, 0);
  await page.evaluate(() => window.cameraProbe.setFrame(30));
  await settle();
  vectorEqual((await snapshot()).target, focused.target, 'focus stays static across frames');
  const box = await viewer.boundingBox();
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 65, cy + 25, { steps: 8 });
  await page.mouse.up();
  await settle();
  const orbited = await snapshot();
  vectorEqual(orbited.target, expected, 'orbit keeps selected pivot');
  assert.notDeepEqual(orbited.direction, focused.direction);
  await page.mouse.wheel(0, -100);
  await settle();
  assert.notDeepEqual((await snapshot()).position, orbited.position);
  await viewer.focus();
  await page.keyboard.press('f');
  await settle();
  vectorEqual(
    (await snapshot()).target,
    (await snapshot()).center,
    'F restores existing scene fit',
  );
  assert.equal((await state()).selected, 1);
  await page.mouse.click(box.x + 20, box.y + box.height - 45, { button: 'right' });
  assert.equal(await menu.count(), 0);
  assert.equal(
    await page.evaluate(() => window.lastMarkerContextPrevented),
    false,
    'empty canvas keeps native menu',
  );
  await page.keyboard.press('Escape');

  // Inspector selection and keyboard focus share the selected marker identity.
  await page
    .locator('.data-section-heading')
    .filter({ hasText: /^Markers/ })
    .click();
  await page.locator('.marker-row button[title="Camera 0"]').click();
  await page.keyboard.press('c');
  await settle();
  vectorEqual((await snapshot()).target, (await point(0)).world, 'Inspector selection supports C');
  await viewer.focus();
  await page.keyboard.press('Shift+F10');
  await menu.waitFor();
  assert.match(await menu.getAttribute('aria-label'), /Camera 0/);
  const frameBeforeMenu = (await state()).frame;
  await page.keyboard.press('ArrowDown');
  assert.match(await page.locator(':focus').innerText(), /Rename marker/);
  await page.keyboard.press('ArrowRight');
  assert.equal((await state()).frame, frameBeforeMenu);
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0);
  assert.equal(await viewer.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Shift+F10');
  await menu.getByRole('menuitem', { name: /Rename marker/ }).click();
  await dialog.waitFor();
  const input = dialog.getByRole('textbox');
  assert.equal(await input.inputValue(), 'Camera 0');
  assert(
    await input.evaluate(
      (el) =>
        el === document.activeElement &&
        el.selectionEnd === el.value.length &&
        el.selectionStart === 0,
    ),
  );
  await input.fill('');
  await input.press('Enter');
  assert.match(await dialog.getByRole('alert').innerText(), /Enter a marker label/);
  await input.fill('Camera 1');
  await input.press('Enter');
  assert.match(await dialog.getByRole('alert').innerText(), /already has this label/);
  await input.fill('Renamed context marker');
  await input.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await state()).labels[0], 'Renamed context marker');
  assert.equal(
    await page.locator('.marker-row.selected button[title="Renamed context marker"]').count(),
    1,
  );
  await page.keyboard.press('Control+z');
  assert.equal((await state()).labels[0], 'Camera 0');
  await page.keyboard.press('Control+y');
  assert.equal((await state()).labels[0], 'Renamed context marker');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await state()).labels[0], 'Renamed context marker');

  await viewer.focus();
  await page.keyboard.press('Control+Shift+U');
  await dialog.waitFor();
  const nativeBefore = await state();
  await input.fill('');
  await input.pressSequentially('C');
  await input.press('Home');
  await input.press('Delete');
  assert.equal(await input.inputValue(), '');
  await input.press('Control+z');
  assert.equal(await input.inputValue(), 'C');
  await input.press('Control+Shift+U');
  assert.equal(await dialog.count(), 1);
  assert.deepEqual(await state(), nativeBefore, 'text edit shortcuts do not change session');
  await input.press('Escape');
  assert.equal(await dialog.count(), 0);
  await viewer.dispatchEvent('keydown', {
    key: 'U',
    ctrlKey: true,
    shiftKey: true,
    repeat: true,
    bubbles: true,
  });
  assert.equal(await dialog.count(), 0);

  await viewer.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.equal((await state()).frame, 1);
  await page.keyboard.press('ArrowLeft');
  assert.equal((await state()).frame, 0);
  await page.keyboard.press('Space');
  assert.equal((await state()).playing, true);
  await page.keyboard.press('Space');
  assert.equal((await state()).playing, false);
  const separator = page.getByRole('separator', { name: 'Trial Inspector width', exact: true });
  await separator.focus();
  const frameBeforeResize = (await state()).frame;
  const widthBefore = Number(await separator.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  assert.notEqual(Number(await separator.getAttribute('aria-valuenow')), widthBefore);
  assert.equal((await state()).frame, frameBeforeResize);
  await separator.dblclick();
  const playButton = page.locator('.play-button');
  await playButton.focus();
  await page.keyboard.press('Space');
  assert.equal((await state()).playing, true, 'button Space activates exactly once');
  await page.keyboard.press('Space');
  assert.equal((await state()).playing, false);

  // Edge clamping uses the same shared menu request; resize while it remains open.
  await page.evaluate(() =>
    window.cameraProbe.openSelectedMarkerMenu(innerWidth - 1, innerHeight - 1),
  );
  await menu.waitFor();
  const withinViewport = async () => {
    await page.waitForFunction(() => {
      const rect = document.querySelector('.marker-context-menu')?.getBoundingClientRect();
      return (
        rect && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      );
    });
    const rect = await menu.boundingBox(),
      size = page.viewportSize();
    assert(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= size.width &&
        rect.y + rect.height <= size.height,
      JSON.stringify({ rect, size }),
    );
  };
  await withinViewport();
  await page.setViewportSize({ width: 1000, height: 800 });
  await withinViewport();
  await page.screenshot({ path: '.local/marker-context-menu.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await viewer.focus();
  const beforeMenuActivation = await state();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Space');
  assert.equal(
    (await state()).revision,
    beforeMenuActivation.revision + 1,
    'Space activates one menu command',
  );
  assert.equal((await state()).playing, beforeMenuActivation.playing);
  assert.equal(await menu.count(), 0);

  // A newly missing sample dismisses an open menu. Keyboard opening at a gap
  // still permits relabeling, but cannot focus a missing point or seek another frame.
  const gapFrame = (await state()).frame + 1;
  await page.evaluate((frame) => {
    const s = window.cameraProbe.useSession.getState();
    s.data.markers.valid[frame * s.data.markers.labels.length + s.selected] = 0;
  }, gapFrame);
  await page.keyboard.press('Shift+F10');
  await page.evaluate((frame) => window.cameraProbe.setFrame(frame), gapFrame);
  await menu.waitFor({ state: 'detached' });
  await viewer.focus();
  await page.keyboard.press('Shift+F10');
  await menu.waitFor();
  assert(await menu.getByRole('menuitem', { name: /Focus camera/ }).isDisabled());
  assert(!(await menu.getByRole('menuitem', { name: /Rename marker/ }).isDisabled()));
  await page.keyboard.press('Escape');
  const gapCamera = await snapshot();
  await viewer.focus();
  await page.keyboard.press('c');
  vectorEqual((await snapshot()).target, gapCamera.target, 'gap focus leaves camera unchanged');
  assert.equal((await state()).frame, gapFrame);
  await page.evaluate((frame) => {
    const s = window.cameraProbe.useSession.getState();
    s.data.markers.valid[frame * s.data.markers.labels.length + s.selected] = 1;
  }, gapFrame);
  await viewer.focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.brand').click();
  assert.equal(await menu.count(), 0);
  await viewer.focus();
  await page.keyboard.press('Shift+F10');
  await page.evaluate(() => window.cameraProbe.selectMarker(1));
  assert.equal(await menu.count(), 0);
  await viewer.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  assert.equal(await menu.count(), 0);
  const explorerBefore = await state();
  await page.keyboard.press('c');
  await page.keyboard.press('f');
  await page.keyboard.press('Control+Shift+U');
  assert.deepEqual(
    await state(),
    explorerBefore,
    'Explorer has independent selection and no camera commands',
  );
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  await viewer.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    (await state()).frame,
    explorerBefore.frame + 1,
    'one handler after workspace transition',
  );
  await page.keyboard.press('Shift+F10');
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/camera-m.h5'));
  await page.waitForFunction(() => !window.cameraProbe.useSession.getState().busy);
  assert.equal(await menu.count(), 0);
  assert.equal(await dialog.count(), 0);
  await viewer.focus();
  await page.keyboard.press('Control+Shift+U');
  await dialog.waitFor();
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/camera-m.h5'));
  await page.waitForFunction(() => !window.cameraProbe.useSession.getState().busy);
  assert.equal(await dialog.count(), 0, 'new file dismisses a stale rename editor');
  await settle();
  console.log(
    'Marker browser checks passed: focus/orbit, picking, menu, rename/history, text, playback, resize and workspaces.',
  );
}

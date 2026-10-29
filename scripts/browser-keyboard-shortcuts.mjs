import assert from 'node:assert/strict';
import { verifyWorkspaceNavigation } from './browser-workspace-navigation.mjs';

export async function verifyKeyboardShortcuts(page, loaded = true) {
  const trigger = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  const reference = dialog.getByRole('region', { name: 'Shortcut reference' });
  const headerClose = dialog.getByRole('button', { name: 'Close keyboard shortcuts', exact: true });
  const footerClose = dialog.getByRole('button', { name: 'Close', exact: true });
  const originalSize = page.viewportSize();
  const isFocused = (element) => element.evaluate((el) => el === document.activeElement);
  const closed = async () => {
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () =>
        document.querySelector('.keyboard-shortcuts-trigger')?.getAttribute('aria-expanded') ===
        'false',
    );
    assert(await isFocused(trigger), 'focus returns to the Help trigger');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  };
  const opened = async () => {
    await dialog.waitFor();
    assert(await dialog.evaluate((el) => el.matches(':modal')), 'native modal semantics');
    assert(await isFocused(headerClose), 'focus enters dialog');
  };
  const snapshot = () =>
    page.evaluate(() => {
      const s = window.cameraProbe.useSession.getState();
      return {
        frame: s.frame,
        playing: s.playing,
        selected: s.selected,
        labels: s.data.markers.labels,
        revision: s.camera.revision,
        past: s.history.past.length,
        future: s.history.future.length,
        menu: !!s.markerMenu,
        rename: !!s.markerRename,
      };
    });
  assert(await trigger.isVisible());
  await trigger.click();
  await opened();
  assert.deepEqual(await dialog.locator('h3').allTextContents(), [
    'Playback',
    'Camera & markers',
    'Editing & history',
    'Timeline',
    'Data Explorer',
    'Menus & dialogs',
    'Panel resizing',
  ]);
  const keys = await dialog.locator('kbd').allTextContents();
  for (const key of [
    'Space',
    '← / →',
    'Home / End',
    'C',
    'F',
    'Ctrl+Shift+U',
    'Delete',
    'Shift+F10',
    'Ctrl/Cmd+Z',
    'Ctrl/Cmd+Shift+Z',
    'Ctrl+Y',
    'Page Down / Page Up',
    'Shift+Arrow keys',
    'Ctrl/Cmd+C',
    'Escape',
  ])
    assert(keys.includes(key), `supported shortcut ${key} is listed`);
  for (const key of ['Cmd+Shift+U', 'Ctrl+O', 'Ctrl+S', 'F1', '?'])
    assert(!keys.includes(key), `unsupported ${key} is absent`);
  assert.match(
    await dialog.getByRole('region', { name: 'Camera & markers', exact: true }).innerText(),
    /Data Visualizer.*selection/s,
  );
  assert.match(
    await dialog.getByRole('region', { name: 'Camera & markers', exact: true }).innerText(),
    /current valid sample/,
  );
  assert.match(
    await dialog.getByRole('region', { name: 'Timeline', exact: true }).innerText(),
    /playhead or a crop handle/,
  );
  await headerClose.click();
  await closed();
  await trigger.press('Enter');
  await opened();
  await page.keyboard.press('Shift+Tab');
  assert(await isFocused(footerClose), 'Shift+Tab wraps inside modal');
  await page.keyboard.press('Tab');
  assert(await isFocused(headerClose));
  await page.keyboard.press('Tab');
  assert(await isFocused(reference));
  await page.keyboard.press('Tab');
  assert(await isFocused(footerClose));
  await footerClose.press('Space');
  await closed();
  await trigger.press('Space');
  await opened();
  await page.keyboard.press('Escape');
  await closed();

  if (loaded) {
    // Seed an available undo action so history blocking cannot pass vacuously.
    await page.evaluate(() => {
      const p = window.cameraProbe;
      window.shortcutHelpBaseline = p.useSession.getState();
      p.useSession.setState({ playing: false });
      p.renameSessionMarker(0, 'Shortcut reference test marker');
    });
    const before = await snapshot();
    await trigger.click();
    await opened();
    await reference.focus();
    for (const key of [
      'Space',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'c',
      'f',
      'Delete',
      'Control+Shift+U',
      'Control+z',
      'Control+y',
      'Control+Shift+z',
      'Meta+z',
      'Meta+Shift+z',
    ]) {
      await page.keyboard.press(key);
      assert.deepEqual(await snapshot(), before, `${key} cannot change application behind Help`);
    }
    await reference.dispatchEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true });
    assert.deepEqual(await snapshot(), before, 'Shift+F10 does not open a marker menu behind Help');
    await page.getByLabel('3D Viewer', { exact: true }).evaluate((el) => el.focus());
    assert(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      'underlying viewer is inert',
    );
    await page.mouse.click(2, 2);
    assert(await dialog.isVisible(), 'backdrop does not activate application');
    await page.keyboard.press('Escape');
    await closed();
    await page.keyboard.press('Control+z');
    assert.notEqual((await snapshot()).labels[0], before.labels[0], 'undo works after Help closes');
    await page.keyboard.press('Control+y');
    assert.equal((await snapshot()).labels[0], before.labels[0], 'redo works after Help closes');
    await page.evaluate(() => {
      const s = window.shortcutHelpBaseline;
      window.cameraProbe.useSession.setState({
        data: s.data,
        history: s.history,
        dirty: s.dirty,
        playing: s.playing,
      });
      delete window.shortcutHelpBaseline;
    });
    const frameSlider = page.getByRole('slider', { name: 'Frame', exact: true });
    const frameBefore = Number(await frameSlider.getAttribute('aria-valuenow'));
    await frameSlider.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('PageUp');
    assert.equal(
      Number(await frameSlider.getAttribute('aria-valuenow')),
      10,
      'focused Timeline supports ten-frame steps',
    );
    await page.keyboard.press('PageDown');
    assert.equal(Number(await frameSlider.getAttribute('aria-valuenow')), 0);
    await page.evaluate((frame) => window.cameraProbe.setFrame(frame), frameBefore);
    const resize = page.getByRole('separator', { name: 'Trial Inspector width', exact: true });
    const widthBefore = Number(await resize.getAttribute('aria-valuenow'));
    await resize.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    assert.equal(
      Number(await resize.getAttribute('aria-valuenow')),
      widthBefore + 40,
      'focused panel handle supports 40px steps',
    );
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    await trigger.click();
    await page.keyboard.press('Escape');
    await closed();
    assert.equal(
      await page
        .getByRole('button', { name: 'Data Explorer', exact: true })
        .getAttribute('aria-pressed'),
      'true',
      'Help Escape does not leave Explorer',
    );
    const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
    await explorer.getByLabel('Search explorer datasets').fill('Trajectories');
    await explorer.locator('nav button').first().click();
    const table = explorer.locator('.explorer-scroll table');
    const first = table.locator('tr[data-row="0"] td').nth(4);
    await first.focus();
    await first.press('Enter');
    assert.equal(
      await table.locator('td.selected-cell').count(),
      1,
      'Enter selects the focused cell',
    );
    await first.press('Shift+ArrowRight');
    await table.locator('tr[data-row="0"] td').nth(5).press('Shift+ArrowDown');
    assert.equal(
      await table.locator('td.selected-cell').count(),
      4,
      'Shift+arrows extend cell selection',
    );
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await table.locator('tr[data-row="1"] td').nth(5).press('Control+c');
    const expected = await table.locator('tr[data-row="0"],tr[data-row="1"]').evaluateAll((rows) =>
      rows
        .map((row) =>
          [...row.querySelectorAll('td')]
            .slice(4, 6)
            .map((cell) => cell.title)
            .join('\t'),
        )
        .join('\n'),
    );
    assert.equal(
      await page.evaluate(async () =>
        (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'),
      ),
      expected,
      'Ctrl+C copies exact cell values',
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await page
        .getByRole('button', { name: 'Data Visualizer', exact: true })
        .getAttribute('aria-pressed'),
      'true',
      'Explorer Escape works after Help closes',
    );
  }

  await verifyWorkspaceNavigation(page, loaded);
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 768, height: 640 },
    { width: 390, height: 640 },
    { width: 320, height: 480 },
  ]) {
    await page.setViewportSize(size);
    await trigger.click();
    await opened();
    const layout = await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect(),
        content = el.querySelector('.shortcuts-content');
      return {
        fits: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        overflow: content.scrollWidth > content.clientWidth + 1,
        scrollable: content.scrollHeight > content.clientHeight,
      };
    });
    assert(layout.fits, `dialog fits ${JSON.stringify(size)}`);
    assert(!layout.overflow, `shortcut rows fit ${size.width}px`);
    if (size.height < 700) assert(layout.scrollable, 'small dialog scrolls internally');
    if (loaded) {
      await page.screenshot({ path: `.local/keyboard-shortcuts-${size.width}.png` });
    }
    await reference.focus();
    await page.keyboard.press('End');
    assert(await dialog.evaluate((el) => el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await closed();
  }
  await page.setViewportSize(originalSize);
  console.log(
    `Keyboard shortcut reference browser checks passed (${loaded ? 'recording loaded' : 'no recording'}): inventory, modal focus, keys, background isolation and responsive header/dialog.`,
  );
}

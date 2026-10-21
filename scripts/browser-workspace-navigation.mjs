import assert from 'node:assert/strict';

/** Header layout and native button keyboard behavior, with and without a trial. */
export async function verifyWorkspaceNavigation(page, loaded = true) {
  const original = page.viewportSize();
  const navigation = page.getByRole('group', { name: 'Workspace', exact: true });
  const visualizer = navigation.getByRole('button', { name: 'Data Visualizer', exact: true });
  const explorer = navigation.getByRole('button', { name: 'Data Explorer', exact: true });
  const canvas = await page.locator('.scene-wrap canvas').elementHandle();
  const snapshot = async () => ({
    file: await page.locator('.header-file').textContent(),
    frame: loaded
      ? await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow')
      : null,
    undo: loaded
      ? await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled()
      : false,
    redo: loaded
      ? await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled()
      : false,
  });
  const before = await snapshot();
  try {
    for (const width of [
      1440, 1366, 1100, 1024, 901, 900, 768, 760, 601, 600, 481, 480, 390, 320,
    ]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await visualizer.isVisible(), `Visualizer is visible at ${width}px`);
      assert(await explorer.isVisible(), `Explorer is visible at ${width}px`);
      assert.equal(await visualizer.isEnabled(), loaded);
      assert.equal(await explorer.isEnabled(), loaded);
      assert.equal(await visualizer.getAttribute('aria-pressed'), 'true');
      assert.equal(await explorer.getAttribute('aria-pressed'), 'false');
      const checkHeader = async () => {
        const layout = await page.locator('header').evaluate((header) => {
          const bounds = header.getBoundingClientRect();
          const controls = [...header.querySelectorAll('button')];
          const boxes = controls.map((button) => button.getBoundingClientRect());
          return {
            height: bounds.height,
            fits: header.scrollWidth <= header.clientWidth + 1,
            usable: controls.every((button, index) => {
              const box = boxes[index];
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return (
                box.left >= bounds.left &&
                box.right <= bounds.right &&
                box.top >= bounds.top &&
                box.bottom <= bounds.bottom &&
                (hit === button || button.contains(hit)) &&
                boxes.every(
                  (other, j) => j === index || box.right <= other.left || box.left >= other.right,
                )
              );
            }),
            labels: [...header.querySelectorAll('.workspace-label')].every(
              (label) => label.getBoundingClientRect().width > 0,
            ),
          };
        });
        assert.equal(layout.height, width > 760 ? 76 : 65, `header height at ${width}px`);
        assert(layout.fits, `header has no horizontal overflow at ${width}px`);
        assert(layout.usable, `all header actions fit without overlaps at ${width}px`);
        assert.equal(layout.labels, width > 900, `workspace label visibility at ${width}px`);
      };
      await checkHeader();
      if (loaded && [1440, 768, 320].includes(width)) {
        await page
          .locator('header')
          .screenshot({ path: `.local/workspace-visualizer-${width}.png` });
      }
      if (!loaded) continue;
      await visualizer.focus();
      await page.keyboard.press('Tab');
      assert(await explorer.evaluate((button) => button === document.activeElement));
      assert.equal(
        await explorer.evaluate((button) => getComputedStyle(button).outlineStyle),
        'solid',
      );
      await page.keyboard.press('Enter');
      await page.getByRole('region', { name: 'Data Explorer', exact: true }).waitFor();
      assert.equal(await explorer.getAttribute('aria-pressed'), 'true');
      assert.equal(await visualizer.getAttribute('aria-pressed'), 'false');
      await explorer.press('Space');
      assert.equal(
        await explorer.getAttribute('aria-pressed'),
        'true',
        'active option is idempotent',
      );
      await checkHeader();
      if ([1440, 768, 320].includes(width)) {
        await page.locator('header').screenshot({ path: `.local/workspace-explorer-${width}.png` });
      }
      await page.keyboard.press('Shift+Tab');
      assert(await visualizer.evaluate((button) => button === document.activeElement));
      await page.keyboard.press('Space');
      await page.locator('.viewer-workspace').waitFor({ state: 'visible' });
      assert.equal(await visualizer.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await snapshot(), before, 'switches preserve file, frame and edit history');
      assert(
        await canvas.evaluate((node) => node === document.querySelector('.scene-wrap canvas')),
        'switches retain the mounted 3D viewer',
      );
    }
  } finally {
    await page.setViewportSize(original);
    await canvas?.dispose();
  }
}

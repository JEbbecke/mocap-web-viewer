import assert from 'node:assert/strict';

/** Validate the intentionally different tab defaults without adding visible UI text. */
export async function verifyInspectorTabs(page) {
  const originalTab = await page
    .locator('.inspector [role="tab"][aria-selected="true"]')
    .innerText();
  const viewport = page.viewportSize();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  const data = page.getByRole('tabpanel', { name: 'Data', exact: true });
  const categories = data.locator('.data-section-heading');
  assert.equal(await data.locator('.data-section-heading[aria-expanded="true"]').count(), 0);
  for (const category of await categories.all()) {
    assert.equal(await category.getAttribute('aria-expanded'), 'false');
    assert.equal(await category.evaluate((el) => getComputedStyle(el).color), 'rgb(184, 214, 228)');
    await category.press('Space');
    assert.equal(await data.locator('.data-section-heading[aria-expanded="true"]').count(), 1);
    assert.equal(await data.getByRole('button', { name: 'Show all', exact: true }).count(), 0);
    assert(
      !/\d+ TRAJECTORIES|Dedicated EMG group; analog channels retain/.test(await data.innerText()),
    );
    await category.press('Enter');
  }
  assert(!/\d+ markers/.test(await page.locator('.sidebar-heading').innerText()));

  await page.getByRole('tab', { name: 'File Info', exact: true }).click();
  const info = page.getByRole('tabpanel', { name: 'File Info', exact: true });
  for (const heading of await info.locator('h4').all()) assert(await heading.isVisible());
  assert.equal(
    await info.locator('[aria-expanded="true"]').count(),
    0,
    'new files collapse technical details',
  );
  const typography = await info
    .locator('h4')
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.color, style.fontSize, style.fontWeight, style.marginBottom];
    });

  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  const display = page.getByRole('tabpanel', { name: 'Display', exact: true });
  assert.deepEqual(await display.locator('h4').allTextContents(), [
    'Scene layers',
    'Marker connections',
    'Force display',
  ]);
  assert.equal(await display.locator('details, [aria-expanded]').count(), 0);
  assert(!/matching links|Display guides between named markers/.test(await display.innerText()));
  for (const heading of await display.locator('h4').all()) {
    assert(await heading.isVisible());
    assert.deepEqual(
      await heading.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.color, style.fontSize, style.fontWeight, style.marginBottom];
      }),
      typography,
      'Display and File Info headings share computed typography',
    );
  }
  const checkboxes = display.getByRole('checkbox');
  assert((await checkboxes.count()) >= 9);
  for (const checkbox of await checkboxes.all()) {
    assert(await checkbox.isVisible());
    assert(
      await checkbox.evaluate(
        (el) =>
          !!(
            el.getAttribute('aria-label') ||
            [...el.labels].map((label) => label.textContent.trim()).join('')
          ),
      ),
    );
  }
  const first = checkboxes.first();
  const checked = await first.isChecked();
  await first.focus();
  await first.press('Space');
  assert.equal(await first.isChecked(), !checked);
  assert.equal(await first.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
  await first.press('Space');
  assert.equal(await first.isChecked(), checked);
  await page.keyboard.press('Tab');
  assert(await checkboxes.nth(1).evaluate((el) => el === document.activeElement));

  const connections = display.getByRole('combobox', { name: 'Connection preset', exact: true });
  assert(await connections.isVisible());
  const preset = await connections.inputValue();
  await connections.selectOption('none');
  assert.equal(await connections.inputValue(), 'none');
  await connections.selectOption(preset);
  for (const name of ['Force vector scale', 'Force display threshold']) {
    const input = display.getByRole('spinbutton', { name, exact: true });
    assert(await input.isVisible());
    const original = await input.inputValue();
    await input.press('ArrowUp');
    assert.notEqual(await input.inputValue(), original);
    await input.fill(original);
  }
  try {
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await display.evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
        `Display fits at ${width}px`,
      );
      assert.equal(
        await page.locator('header').evaluate((el) => el.getBoundingClientRect().height),
        width <= 760 ? 65 : 76,
      );
      if (width >= 1024) {
        // React's media-query update follows the browser viewport resize.
        await page.waitForFunction(
          (expected) =>
            document.querySelector('.inspector')?.getBoundingClientRect().width === expected,
          width <= 1100 ? 270 : 310,
        );
        assert.equal(
          await page.locator('.inspector').evaluate((el) => el.getBoundingClientRect().width),
          width <= 1100 ? 270 : 310,
        );
      }
      await page
        .locator('.inspector')
        .screenshot({ path: `.local/inspector-display-${width}.png` });
    }
  } finally {
    await page.setViewportSize(viewport);
    await page.getByRole('tab', { name: originalTab, exact: true }).click();
  }
  console.log(
    'Inspector consistency passed: collapsed Data/details, open Display/File Info, computed heading styles, keyboard controls and narrow widths.',
  );
}

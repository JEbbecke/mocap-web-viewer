import assert from 'node:assert/strict';

/** Exercise the Inspector only; the Data Explorer keeps its own disclosure behavior. */
export async function verifyDataTab(page, format) {
  const original = page.viewportSize();
  const browser = page.getByRole('tabpanel', { name: 'Data', exact: true });
  const headings = browser.locator('.data-section-heading');
  const names = await headings.locator('span[title]').allTextContents();
  const header = (name) => headings.filter({ has: page.locator('span[title]', { hasText: name }) });
  const expanded = () =>
    browser
      .locator('.data-section-heading[aria-expanded="true"]')
      .locator('span[title]')
      .allTextContents();
  assert.equal(names[0], 'Markers');
  assert.equal(names.length, format === 'H5' ? 8 : 3);
  assert.deepEqual(await expanded(), [], `${format}: new files collapse every category`);
  const file = await page.locator('.header-file').textContent();
  try {
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await headings.evaluateAll((buttons) =>
        buttons.map((button) => {
          const bounds = button.getBoundingClientRect();
          const name = button.querySelector('span[title]').getBoundingClientRect();
          const count = button.querySelector('.data-count').getBoundingClientRect();
          return {
            height: bounds.height,
            nameLeft: name.left,
            countRight: count.right,
            fits: button.scrollWidth <= button.clientWidth + 1 && name.right <= count.left,
            controlled: !!document.getElementById(button.getAttribute('aria-controls')),
          };
        }),
      );
      assert(
        layout.every((row) => row.height === 44),
        `${format}: 44px category targets at ${width}px`,
      );
      assert(
        layout.every((row) => row.fits && row.controlled),
        `${format}: labels/counts fit at ${width}px`,
      );
      assert(
        layout.every(
          (row) => row.nameLeft === layout[0].nameLeft && row.countRight === layout[0].countRight,
        ),
        'category labels and counts align consistently',
      );
      assert(await browser.evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1));
      await page
        .locator('.inspector')
        .screenshot({ path: `.local/data-tab-${format}-${width}.png` });
    }
    await page.setViewportSize(original);
    await page.getByLabel('Search data', { exact: true }).focus();
    await page.keyboard.press('Tab');
    assert(await header(names[0]).evaluate((button) => button === document.activeElement));
    assert.equal(
      await header(names[0]).evaluate((button) => getComputedStyle(button).outlineStyle),
      'solid',
    );
    await header(names[0]).press('Space');
    assert.deepEqual(await expanded(), [names[0]]);
    const markerName = await browser.locator('.marker-row button').first().getAttribute('title');
    const markerRow = await browser.locator('.marker-row').first().boundingBox();
    assert(markerRow.height >= 34, 'expanded marker targets retain their existing spacing');
    await header(names[1]).press('Enter');
    assert.deepEqual(await expanded(), names.slice(0, 2));
    await header(names[0]).click();
    assert.deepEqual(await expanded(), [names[1]], 'categories toggle independently');
    for (const tab of ['Display', 'File Info']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.getByRole('tab', { name: 'Data', exact: true }).click();
      assert.deepEqual(await expanded(), [names[1]], `${tab} preserves expansion`);
    }
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    await page.getByRole('region', { name: 'Data Explorer', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
    assert.deepEqual(await expanded(), [names[1]], 'workspace switching preserves expansion');
    const search = page.getByLabel('Search data', { exact: true });
    await search.fill(markerName);
    assert((await expanded()).length > 0, 'search automatically expands matching categories');
    assert.equal(await browser.locator('.data-section-heading[aria-expanded="false"]').count(), 0);
    await header('Markers').press('Enter');
    assert.equal(
      await header('Markers').getAttribute('aria-expanded'),
      'false',
      'search results remain collapsible',
    );
    await page.getByRole('tab', { name: 'Display', exact: true }).click();
    await page.getByRole('tab', { name: 'Data', exact: true }).click();
    assert.equal(await header('Markers').getAttribute('aria-expanded'), 'false');
    await search.fill('no matching synthetic entry');
    assert.equal(await headings.count(), 0);
    await search.fill('');
    assert.deepEqual(await expanded(), [names[1]], 'clearing search restores manual preferences');
    assert.equal(
      await page.locator('.header-file').textContent(),
      file,
      'disclosures do not modify the trial',
    );
    await header(names[1]).click();
    assert.deepEqual(await expanded(), []);
    console.log(
      `${format} Data tab passed: collapsed defaults, 44px rows, keyboard, tabs, workspaces and search.`,
    );
  } finally {
    await page.setViewportSize(original);
  }
}

import assert from 'node:assert/strict';

/** Real clipboard integration and menu/header interactions against the bundled demo H5. */
export async function verifyExplorerToolbar(page) {
  const originalViewport = page.viewportSize();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  const search = explorer.getByLabel('Search explorer datasets');
  const table = explorer.locator('table');
  const trigger = explorer.getByRole('button', { name: 'Copy', exact: true });
  const menu = page.getByRole('menu', { name: 'Copy', exact: true });
  const item = (name) => menu.getByRole('menuitem', { name, exact: true });
  const names = [
    'Copy selected cell(s)',
    'Copy selected column(s)',
    'Copy selected row(s)',
    'Copy full table',
  ];
  const details = explorer.getByRole('button', { name: 'Details', exact: true });
  const popup = page.getByRole('dialog', { name: /dataset details$/ });
  const follow = explorer.getByLabel('Follow playback');
  const focused = (locator) => locator.evaluate((el) => document.activeElement === el);
  const settle = () => page.waitForTimeout(120);
  const geometry = () =>
    page.evaluate(() => {
      const scroll = document.querySelector('.explorer-scroll');
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      };
      return {
        table: rect('.explorer-scroll'),
        timeline: rect('.timeline-section'),
        plot: rect('#signal-panel'),
        top: scroll.scrollTop,
        left: scroll.scrollLeft,
        selection: [...document.querySelectorAll('.selected-cell')].map((el) => el.title),
        columns: [...document.querySelectorAll('th.selected-column')].map((el) => el.textContent),
      };
    });
  const copy = async (name) => {
    await trigger.click();
    await item(name).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.explorer-table-tools [role="status"]')?.textContent ===
        'Copied exact values.',
    );
    assert.equal(await menu.count(), 0);
    assert(await focused(trigger), 'copy action restores trigger focus');
    return page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));
  };
  const cell = (row, column) => table.locator(`tr[data-row="${row}"] td`).nth(column);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await search.fill('Trajectories');
  await explorer.locator('nav button').first().click();
  await trigger.click();
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), names);
  for (const name of names.slice(0, 3)) assert(await item(name).isDisabled());
  assert(await item(names[3]).isEnabled());
  assert(await focused(item(names[3])), 'opening skips unavailable selection actions');
  await page.keyboard.press('ArrowDown');
  assert(await focused(item(names[3])), 'navigation skips disabled actions');
  await page.keyboard.press('Escape');
  assert(await focused(trigger));
  const full = await copy(names[3]);
  const rows = full.split('\n').map((row) => row.split('\t'));
  assert.equal(rows.length, Number(await table.getAttribute('aria-rowcount')));
  assert.deepEqual(rows[0], await table.locator('th').allTextContents());
  const exact = await cell(0, 4).getAttribute('title');
  await cell(0, 4).click();
  assert.equal(await copy(names[0]), exact, 'single cell retains Float64 precision');
  assert.equal(await copy(names[2]), [rows[0], rows[1]].map((row) => row.join('\t')).join('\n'));
  assert.equal(
    await copy(names[1]),
    rows.map((row) => row[4]).join('\n'),
    'column includes heading and every row',
  );
  await cell(1, 5).click({ modifiers: ['Shift'] });
  assert.equal(
    await copy(names[0]),
    rows
      .slice(1, 3)
      .map((row) => row.slice(4, 6).join('\t'))
      .join('\n'),
  );
  assert.equal(
    await copy(names[2]),
    rows
      .slice(0, 3)
      .map((row) => row.join('\t'))
      .join('\n'),
    'multiple selected rows retain headings and order',
  );
  assert.equal(await copy(names[1]), rows.map((row) => row.slice(4, 6).join('\t')).join('\n'));
  await table.getByRole('button', { name: 'X [mm]', exact: true }).click();
  await table
    .getByRole('button', { name: 'Z [mm]', exact: true })
    .click({ modifiers: ['Control'] });
  assert.equal(
    await copy(names[1]),
    rows.map((row) => [row[4], row[6]].join('\t')).join('\n'),
    'multiple columns copy in table order',
  );
  assert.equal(await copy(names[3]), full, 'full table is independent of selection');
  await cell(0, 4).click();
  await cell(0, 4).press('Control+c');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    exact,
    'existing table shortcut copies exact values',
  );
  await cell(0, 4).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    el.focus();
  });
  await cell(0, 4).press('Control+c');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    await cell(0, 4).innerText(),
    'ordinary text copy remains native',
  );
  await page.evaluate(() => getSelection().removeAllRanges());

  await trigger.focus();
  await trigger.press('ArrowDown');
  assert(await focused(item(names[0])));
  await page.keyboard.press('ArrowDown');
  assert(await focused(item(names[1])));
  await page.keyboard.press('End');
  assert(await focused(item(names[3])));
  await page.keyboard.press('ArrowDown');
  assert(await focused(item(names[0])));
  await page.keyboard.press('ArrowUp');
  assert(await focused(item(names[3])));
  await page.keyboard.press('Home');
  assert(await focused(item(names[0])));
  await page.keyboard.press('Enter');
  assert.equal(await menu.count(), 0);
  assert(await focused(trigger));
  // The menu closes before the asynchronous clipboard write finishes. Wait for
  // enabled actions before checking ArrowUp's last-item focus; busy menus are
  // deliberately focusable containers with no enabled items (covered below).
  await page.waitForFunction(
    () => document.querySelector('.explorer-copy-trigger')?.getAttribute('aria-busy') === 'false',
  );
  await trigger.press('ArrowUp');
  assert(await focused(item(names[3])));
  await page.keyboard.press('Escape');
  await trigger.press('Space');
  await page.keyboard.press('Tab');
  assert.equal(await menu.count(), 0);
  assert(await focused(explorer.locator('.explorer-scroll')), 'Tab resumes after Copy trigger');
  await trigger.click();
  await explorer.locator('h3').click();
  assert.equal(await menu.count(), 0, 'outside click closes menu');

  // Exercise the existing clipboard rejection path without changing its implementation.
  await page.evaluate(() => {
    window.originalClipboardWrite = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  try {
    await trigger.click();
    await item(names[0]).click();
    await explorer
      .getByRole('status')
      .getByText('Clipboard unavailable. Select table text and use Ctrl/Cmd+C.')
      .waitFor();
    assert(await focused(trigger));
  } finally {
    await page.evaluate(() => {
      navigator.clipboard.writeText = window.originalClipboardWrite;
      delete window.originalClipboardWrite;
    });
  }
  assert.equal(await copy(names[0]), exact, 'copy remains usable after clipboard failure');
  await page.evaluate(() => {
    window.originalClipboardWrite = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () =>
      new Promise((done) => {
        window.finishPendingCopy = done;
      });
  });
  try {
    await trigger.click();
    await item(names[0]).click();
    assert.equal(await trigger.getAttribute('aria-busy'), 'true');
    await trigger.click();
    for (const name of names)
      assert(await item(name).isDisabled(), 'copy scopes are disabled while copying');
    await page.keyboard.press('ArrowDown');
    assert(await focused(menu), 'busy menu retains focus without selecting disabled actions');
    await page.keyboard.press('Escape');
    assert(await focused(trigger), 'busy menu retains an accessible dismissal target');
    await trigger.press('ArrowDown');
    assert(await focused(menu), 'a pending copy can be reopened without enabling actions');
  } finally {
    await page.evaluate(() => {
      window.finishPendingCopy?.();
      navigator.clipboard.writeText = window.originalClipboardWrite;
      delete window.originalClipboardWrite;
      delete window.finishPendingCopy;
    });
  }
  await page.waitForFunction(
    () => document.querySelector('.explorer-copy-trigger')?.getAttribute('aria-busy') === 'false',
  );
  await page.keyboard.press('End');
  assert(
    await focused(item(names[3])),
    'an open busy menu becomes navigable when copying finishes',
  );
  await page.keyboard.press('Escape');
  assert(await focused(trigger), 'Escape restores the Copy trigger after a pending copy');

  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  const originalFrame = await frame.getAttribute('aria-valuenow');
  await follow.check();
  await frame.press('End');
  await settle();
  assert(
    (await explorer.locator('.explorer-scroll').evaluate((el) => el.scrollTop)) > 0,
    'Follow playback scrolls to current frame',
  );
  await details.click();
  assert(await follow.isChecked());
  await page.keyboard.press('Escape');
  assert(await follow.isChecked());
  await follow.uncheck();
  // Return through the keyboard slider so the caller's playback position stays intact.
  if (originalFrame === (await frame.getAttribute('aria-valuemax'))) await frame.press('End');
  else {
    await frame.press('Home');
    for (let i = 0; i < Number(originalFrame); i++) await frame.press('ArrowRight');
  }
  await explorer.locator('.explorer-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await settle();
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 900, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await settle();
    const before = await geometry();
    await trigger.click();
    await settle();
    assert.deepEqual(
      await geometry(),
      before,
      'menu opening preserves table/Timeline/plot geometry, scroll and selection',
    );
    const bounds = await menu.boundingBox();
    assert(
      bounds.x >= 8 &&
        bounds.y >= 8 &&
        bounds.x + bounds.width <= viewport.width - 8 &&
        bounds.y + bounds.height <= viewport.height - 8,
      'menu fits viewport',
    );
    assert(
      await menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
      'menu is not clipped by table containers',
    );
    if (viewport.width === 1366 || viewport.width === 390)
      await page.screenshot({ path: `.local/explorer-copy-${viewport.width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    assert.deepEqual(await geometry(), before, 'menu closing preserves geometry');
    const controls = explorer.locator('.explorer-dataset-controls');
    assert.equal(await controls.getByLabel('Follow playback').count(), 1);
    assert.equal(await controls.getByRole('button', { name: 'Details', exact: true }).count(), 1);
    const followBox = await controls.locator('label').boundingBox(),
      detailsBox = await details.boundingBox();
    if (viewport.width >= 900) {
      assert(
        Math.abs(followBox.y + followBox.height / 2 - detailsBox.y - detailsBox.height / 2) < 1,
        'header controls align vertically',
      );
      assert(
        detailsBox.x - followBox.x - followBox.width <= 9,
        'header controls share compact spacing',
      );
    }
    const nameBox = await explorer.locator('h3').boundingBox();
    assert(
      nameBox.x + nameBox.width <= followBox.x || nameBox.y + nameBox.height <= followBox.y,
      'Follow playback does not overlap dataset name',
    );
    assert(
      nameBox.x + nameBox.width <= detailsBox.x || nameBox.y + nameBox.height <= detailsBox.y,
      'controls do not overlap dataset name',
    );
    await details.click();
    await trigger.click();
    assert.equal(await popup.count(), 0, 'Copy dismisses Details');
    await details.click();
    assert.equal(await menu.count(), 0, 'Details dismisses Copy');
    await page.keyboard.press('Escape');
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'no horizontal page overflow',
    );
    if (viewport.width === 1366 || viewport.width === 390)
      await page.screenshot({
        path: `.local/explorer-toolbar-${viewport.width}.png`,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 900, height: 768 });
  await trigger.evaluate((el) => {
    el.style.transform = `translate(${innerWidth - el.getBoundingClientRect().right - 10}px, ${innerHeight - el.getBoundingClientRect().bottom - 10}px)`;
  });
  await trigger.click();
  const edgeMenu = await menu.boundingBox(),
    edgeTrigger = await trigger.boundingBox();
  assert(
    edgeMenu.y + edgeMenu.height <= edgeTrigger.y && edgeMenu.x + edgeMenu.width <= 892,
    'menu flips and clamps at lower/right boundaries',
  );
  await page.keyboard.press('Escape');
  await trigger.evaluate((el) => el.style.removeProperty('transform'));
  await page.setViewportSize(originalViewport);
  await search.fill('Trajectories');
  await explorer.locator('nav button').nth(1).click();
  await trigger.click();
  for (const name of names.slice(0, 3))
    assert(await item(name).isDisabled(), 'old dataset selection is unavailable');
  await explorer.locator('nav button').first().click();
  assert.equal(await menu.count(), 0, 'dataset switch dismisses Copy');
  console.log(
    'Explorer toolbar passed: all four clipboard scopes, exact TSV/precision, disabled states, clipboard rejection, native text/keyboard copy, menu focus/placement/geometry and Follow/Details grouping.',
  );
}

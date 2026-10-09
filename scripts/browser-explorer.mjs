import assert from 'node:assert/strict';

// Windows clipboard text uses CRLF; compare table content independently of OS line endings.
const clipboardText = (page) =>
  page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));

async function copyWithButton(page, explorer, label) {
  await explorer.getByRole('button', { name: label, exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.explorer-table-tools [role="status"]')?.textContent ===
      'Copied exact values.',
  );
  return clipboardText(page);
}

async function verifySidebarLayout(page) {
  const original = page.viewportSize();
  for (const viewport of [original, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    assert(
      await page
        .locator('header')
        .evaluate((header) => header.scrollWidth <= header.clientWidth + 1),
      'viewer header fits at desktop and laptop widths',
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.getByRole('button', { name: 'Hide right sidebar', exact: true }).click();
      await page.waitForFunction(() => {
        const stage = document.querySelector('.scene-wrap').getBoundingClientRect();
        const canvas = document.querySelector('.scene-wrap canvas').getBoundingClientRect();
        const sidebar = document.querySelector('.inspector').getBoundingClientRect();
        return (
          sidebar.width < 40 &&
          Math.abs(stage.width - canvas.width) < 1 &&
          Math.abs(stage.right - sidebar.left) < 1
        );
      });
      await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click();
      await page.waitForFunction(() => {
        const sidebar = document.querySelector('.inspector').getBoundingClientRect();
        const stage = document.querySelector('.scene-wrap').getBoundingClientRect();
        const canvas = document.querySelector('.scene-wrap canvas').getBoundingClientRect();
        return stage.right <= sidebar.left + 0.5 && canvas.right <= sidebar.left + 0.5;
      });
      const clickable = await page.locator('.inspector [role="tab"]').evaluateAll((tabs) =>
        tabs.every((tab) => {
          const r = tab.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === tab || tab.contains(hit);
        }),
      );
      assert(clickable, 'restored sidebar tabs are clickable above the resized 3D stage');
    }
  }
  await page.setViewportSize(original);
}

async function verifyHeaderPlots(page, table) {
  const header = (name) => table.getByRole('button', { name, exact: true });
  const selected = () => table.locator('th.selected-column').allTextContents();
  const plot = page.locator('#signal-panel');
  await header('X [mm]').click();
  assert.deepEqual(await selected(), ['X [mm]']);
  await plot.locator('.u-legend').getByText('X (mm)', { exact: true }).waitFor();
  await header('Y [mm]').click({ modifiers: ['Control'] });
  await header('Z [mm]').click({ modifiers: ['Control'] });
  await header('Y [mm]').click({ modifiers: ['Control'] });
  assert.deepEqual(await selected(), ['X [mm]', 'Z [mm]']);
  assert.equal(await plot.locator('.u-legend').getByText('Y (mm)', { exact: true }).count(), 0);
  await header('Y [mm]').click({ modifiers: ['Meta'] });
  assert.deepEqual(await selected(), ['X [mm]', 'Y [mm]', 'Z [mm]']);
  await header('Time [s]').click({ modifiers: ['Shift'] });
  assert.deepEqual(await selected(), ['Time [s]', 'X [mm]', 'Y [mm]']);
  assert.equal(
    await plot.locator('.u-series').count(),
    3,
    'time is omitted from plotted data columns',
  );
  await header('Z [mm]').click({ modifiers: ['Control', 'Shift'] });
  assert.deepEqual(await selected(), ['Time [s]', 'X [mm]', 'Y [mm]', 'Z [mm]']);
  assert((await header('X [mm]').getAttribute('aria-pressed')) === 'true');
  assert.equal(
    await page.evaluate(() => window.getSelection().toString()),
    '',
    'modifier header clicks avoid native text ranges',
  );
  assert.equal(
    Number(await plot.locator('.plot-target').getAttribute('data-sample-count')),
    Number(await table.getAttribute('aria-rowcount')) - 1,
  );
  await page.getByRole('button', { name: 'Hide plot panel', exact: true }).click();
  assert.deepEqual(await selected(), ['Time [s]', 'X [mm]', 'Y [mm]', 'Z [mm]']);
  await page.getByRole('button', { name: 'Show plot panel', exact: true }).click();
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  assert.deepEqual(
    await selected(),
    ['Time [s]', 'X [mm]', 'Y [mm]', 'Z [mm]'],
    'dataset and columns survive view switches',
  );
  await header('Valid').click();
  assert.equal(
    await plot.locator('.uplot').count(),
    0,
    'categorical validity is selectable but not plotted',
  );
  await plot.getByText('Select a numeric signal column to plot.').waitFor();
  await header('X [mm]').focus();
  await header('X [mm]').press('Enter');
  await header('Z [mm]').focus();
  await header('Z [mm]').press('Shift+Space');
  assert.deepEqual(
    await selected(),
    ['X [mm]', 'Y [mm]', 'Z [mm]'],
    'keyboard header ranges preserve navigation',
  );
}

/** Runs against synthetic files only. Shared by the existing Chromium smoke suite. */
export async function verifyExplorer(page, format) {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const plotSplit = await page
    .getByRole('button', { name: 'Split plots' })
    .getAttribute('aria-pressed');
  const inspectorTab = await page
    .locator('.inspector [role="tab"][aria-selected="true"]')
    .innerText();
  const before = {
    undo: await undo.isEnabled(),
    redo: await redo.isEnabled(),
    file: await page.locator('.header-file').innerText(),
    signal: await page.getByLabel('Signal to plot', { exact: true }).inputValue(),
  };
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  await explorer.waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Data Viewer', exact: true }).count(),
    1,
    'header label switches with the view',
  );
  assert.equal(await explorer.getByRole('button', { name: 'Back to viewer' }).count(), 0);
  assert.equal(
    await explorer.locator('nav details[open]').count(),
    0,
    'all navigation groups start collapsed',
  );
  assert(
    (await explorer.locator('nav > details > summary').first().innerText()).startsWith('Metadata'),
    'metadata is first',
  );
  const search = explorer.getByLabel('Search explorer datasets');
  await search.fill('Trajectories');
  await explorer.locator('nav button').first().click();
  assert.equal(
    await page.locator('.inspector').isVisible(),
    false,
    'wide workspace replaces the narrow inspector',
  );
  assert.equal(
    await page.getByRole('slider', { name: 'Frame', exact: true }).count(),
    1,
    'timeline remains available',
  );
  const table = explorer.locator('table');
  assert((await table.locator('th').allTextContents()).includes('X [mm]'));
  assert((await table.locator('th').allTextContents()).includes('Source frame'));
  await verifyHeaderPlots(page, table);
  const firstCell = table.locator('tbody tr[data-row="0"] td').nth(4);
  const exact = await firstCell.getAttribute('title');
  await firstCell.click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copyWithButton(page, explorer, 'Copy selected cell(s)');
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.explorer-table-tools [role="status"]')?.textContent === expected,
    'Copied exact values.',
  );
  assert.equal(await clipboardText(page), exact, 'copy preserves exact Float64 value');
  const copiedRow = await copyWithButton(page, explorer, 'Copy selected row(s)');
  assert(
    copiedRow.includes('Source frame') && copiedRow.includes(exact),
    'row copy includes headings and exact values',
  );
  await firstCell.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  assert.equal(
    await page.evaluate(() => window.getSelection().toString()),
    await firstCell.innerText(),
    'native text selection works',
  );
  await page.evaluate(() => window.getSelection().removeAllRanges());
  const rangeEnd = table.locator('tr[data-row="1"] td').nth(5);
  await rangeEnd.click({ modifiers: ['Shift'] });
  assert.equal(
    await table.locator('td.selected-cell').count(),
    4,
    'Shift-click selects a rectangle',
  );
  const expectedRange = [];
  for (const r of [0, 1])
    expectedRange.push(
      (
        await Promise.all(
          [4, 5].map((c) => table.locator(`tr[data-row="${r}"] td`).nth(c).getAttribute('title')),
        )
      ).join('\t'),
    );
  assert.equal(await table.locator('tr.selected-row').count(), 2, 'corresponding rows highlighted');
  assert.equal(
    await table.locator('th.selected-column').count(),
    2,
    'corresponding columns highlighted',
  );
  assert(
    (await table.locator('tr[data-row="0"] td').first().getAttribute('class')).includes(
      'selection-axis',
    ),
  );
  assert(
    (await table.locator('tr[data-row="2"] td').nth(4).getAttribute('class')).includes(
      'selection-axis',
    ),
  );
  const colors = await table.evaluate((el) => ({
    selected: getComputedStyle(el.querySelector('td.selected-cell')).backgroundColor,
    axis: getComputedStyle(el.querySelector('td.selection-axis:not(.selected-cell)'))
      .backgroundColor,
  }));
  assert.notEqual(
    colors.selected,
    colors.axis,
    'row/column highlighting is weaker than selected-cell highlighting',
  );
  assert.equal(
    await copyWithButton(page, explorer, 'Copy selected cell(s)'),
    expectedRange.join('\n'),
  );
  const selectedRows = (await copyWithButton(page, explorer, 'Copy selected row(s)')).split('\n');
  assert.equal(selectedRows.length, 3, 'both selected rows copied once');
  assert.equal(selectedRows[0], (await table.locator('th').allTextContents()).join('\t'));
  for (const r of [0, 1])
    assert.equal(
      selectedRows[r + 1],
      (
        await table
          .locator(`tr[data-row="${r}"] td`)
          .evaluateAll((cells) => cells.map((c) => c.title))
      ).join('\t'),
    );
  const selectedColumns = (await copyWithButton(page, explorer, 'Copy selected column(s)')).split(
    '\n',
  );
  assert.equal(selectedColumns[0], 'X [mm]\tY [mm]');
  assert.equal(selectedColumns.length, Number(await table.getAttribute('aria-rowcount')));
  assert.equal(selectedColumns[1], expectedRange[0]);
  assert.equal(selectedColumns[2], expectedRange[1]);
  const fullTable = (await copyWithButton(page, explorer, 'Copy full table')).split('\n');
  assert.equal(fullTable.length, Number(await table.getAttribute('aria-rowcount')));
  assert.equal(fullTable[0], (await table.locator('th').allTextContents()).join('\t'));
  assert.equal(
    await explorer.getByRole('button', { name: 'Copy visible rows', exact: true }).count(),
    0,
  );
  await firstCell.click({ modifiers: ['Control'] });
  assert.equal(
    await table.locator('td.selected-cell').count(),
    3,
    'Ctrl-click removes one selected cell',
  );
  await firstCell.click({ modifiers: ['Control'] });
  assert.equal(await table.locator('td.selected-cell').count(), 4, 'Ctrl-click adds a cell');
  await firstCell.click();
  await firstCell.press('Shift+ArrowRight');
  await table.locator('tr[data-row="0"] td').nth(5).press('Shift+ArrowDown');
  assert.equal(
    await table.locator('td.selected-cell').count(),
    4,
    'keyboard extends the selected range',
  );
  await table.locator('tr[data-row="1"] td').nth(5).press('Control+c');
  assert.equal(
    await clipboardText(page),
    expectedRange.join('\n'),
    'keyboard copying uses exact selected values',
  );
  await table.locator('th').nth(4).getByRole('button').click();
  const copiedColumn = (await copyWithButton(page, explorer, 'Copy selected column(s)')).split(
    '\n',
  );
  assert.equal(copiedColumn[0], 'X [mm]');
  assert.equal(
    copiedColumn.length,
    Number(await table.getAttribute('aria-rowcount')),
    'column copy includes all table rows',
  );
  assert.equal(copiedColumn[1], exact);
  await search.fill('no such dataset');
  assert.equal(await explorer.locator('nav button').count(), 0);
  await search.fill('Analog');
  const analog = explorer.locator('nav button').first();
  if (await analog.count()) {
    await analog.click();
    assert.equal((await table.locator('th').allTextContents())[0], 'Sample (0-based)');
    const time = Number(await table.locator('tr[data-row="1"] td').nth(1).getAttribute('title'));
    assert(time > 0, 'analog uses a real sample clock');
    await explorer.getByLabel('Follow playback').check();
    await page.getByRole('slider', { name: 'Frame', exact: true }).press('Home');
    assert.equal(await table.locator('tr.current-sample').count(), 1);
    await explorer.getByLabel('Follow playback').uncheck();
  }
  if (format === 'H5') {
    for (const category of ['Rigid Bodies', 'EMG', 'IK Results', 'ID Results']) {
      await search.fill(category);
      assert((await explorer.locator('nav button').count()) > 0, `${category} available`);
      await explorer.locator('nav button').first().click();
      if (category.endsWith('Results')) {
        await explorer
          .locator('.explorer-pagination')
          .getByText(/of \d+ samples/)
          .waitFor();
        assert.equal(await explorer.getByRole('alert').count(), 0);
        assert(
          (await table.locator('th').allTextContents()).some((c) => c.includes('Value [unknown]')),
        );
        assert.equal(await table.locator('tr[data-row="0"] td').last().getAttribute('title'), '4');
      }
    }
    await search.fill('Corners');
    await explorer.locator('nav button').first().click();
    await table.getByRole('button', { name: 'Corner 1 X [mm]', exact: true }).click();
    await table
      .getByRole('button', { name: 'Corner 4 Z [mm]', exact: true })
      .click({ modifiers: ['Shift'] });
    assert.equal(
      await page.locator('#signal-panel .u-series').count(),
      13,
      'all twelve dynamic geometry components plot without a silent cap',
    );
    const panelBounds = await page.locator('#signal-panel').boundingBox();
    const legendBounds = await page.locator('#signal-panel .u-legend').boundingBox();
    assert(
      legendBounds.y + legendBounds.height <= panelBounds.y + panelBounds.height + 1,
      'large selections keep the legend inside the plot',
    );
    await search.fill('Events');
    await explorer.locator('nav button').first().click();
    await table.locator('tr[data-row="0"] td').first().click();
    await explorer.getByRole('button', { name: 'Seek to event' }).click();
    assert.equal(
      await page.getByLabel('Event label', { exact: true }).count(),
      0,
      'seeking does not open the event editor',
    );
    await search.fill('Metadata');
    await explorer.locator('nav button').first().click();
    assert.deepEqual(await table.locator('th').allTextContents(), ['Field', 'Value']);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  const box = await explorer.boundingBox();
  assert(box.width > 1200, 'comfortable laptop-width workspace');
  assert(
    (await explorer.locator('.explorer-scroll').boundingBox()).height > 250,
    'laptop table remains usable',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await undo.isEnabled(), before.undo, 'browsing creates no history');
  assert.equal(await redo.isEnabled(), before.redo, 'browsing leaves redo history unchanged');
  assert.equal(
    await page.locator('.header-file').innerText(),
    before.file,
    'browsing leaves dirty state unchanged',
  );
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
  assert.equal(
    await page.getByLabel('Signal to plot', { exact: true }).inputValue(),
    before.signal,
    'Explorer headers preserve Viewer selection',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).count(),
    1,
    'header switches back',
  );
  assert.equal(await page.locator('.scene-wrap canvas').count(), 1);
  assert.equal(
    await page.getByRole('button', { name: 'Split plots' }).getAttribute('aria-pressed'),
    plotSplit,
    'plot layout survives browsing',
  );
  assert.equal(
    await page.locator('.inspector [role="tab"][aria-selected="true"]').innerText(),
    inspectorTab,
    'inspector tab survives browsing',
  );
  await verifySidebarLayout(page);
}

export async function verifyLargeExplorer(page) {
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  await explorer.getByLabel('Search explorer datasets').fill('Large analog');
  await explorer.locator('nav button').first().click();
  const scroll = explorer.locator('.explorer-scroll'),
    table = explorer.locator('table');
  assert.equal(await table.getAttribute('aria-rowcount'), '200001');
  assert((await table.locator('tr[data-row]').count()) < 60, 'bounded rows for 200,000 samples');
  await scroll.evaluate((el) => {
    el.scrollTop = 100000 * 32;
  });
  await page.waitForFunction(
    () => Number(document.querySelector('tr[data-row]')?.getAttribute('data-row')) > 99000,
  );
  assert((await table.locator('tr[data-row]').count()) < 60);
  const bounds = await scroll.boundingBox(),
    header = await table.locator('th').first().boundingBox();
  assert(Math.abs(bounds.y - header.y) < 3, 'header stays sticky while scrolling');
  await scroll.focus();
  await scroll.press('End');
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await table.locator('tr[data-row="199999"]').waitFor();
  assert.equal(
    await table.locator('tr[data-row="199999"] td').last().getAttribute('title'),
    '199999',
  );
  await table.locator('th').last().getByRole('button').click();
  const target = page.locator('#signal-panel .plot-target');
  assert.equal(
    await target.getAttribute('data-sample-count'),
    '200000',
    'plot uses every analog sample',
  );
  assert.equal(
    Number(await target.getAttribute('data-time-end')),
    39.9998,
    'plot uses analog physical clock',
  );
  const analogPlot = page.locator('#signal-panel .uplot');
  await analogPlot.evaluate((el) => {
    el.dataset.playbackPersistence = 'true';
  });
  await page.getByRole('button', { name: 'Jump to beginning', exact: true }).click();
  const startCursor = await page.locator('#signal-panel .playhead').evaluate((el) => el.style.left);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    (initial) => document.querySelector('#signal-panel .playhead').style.left !== initial,
    startCursor,
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.equal(
    await analogPlot.getAttribute('data-playback-persistence'),
    'true',
    'playback moves the cursor without rebuilding selected arrays or chart',
  );
  assert.equal(
    await table.locator('th').last().getByRole('button').getAttribute('aria-pressed'),
    'true',
  );
  assert(
    (await table.locator('tr[data-row]').count()) < 60,
    'selecting a whole column keeps bounded table DOM',
  );
  const column = (await copyWithButton(page, explorer, 'Copy selected column(s)')).split('\n');
  assert.equal(column.length, 200001);
  assert.equal(column[0], 'Value [V]');
  assert.equal(column.at(-1), '199999');
  const full = (await copyWithButton(page, explorer, 'Copy full table')).split('\n');
  assert.equal(full.length, 200001);
  assert.equal(full[0], 'Sample (0-based)\tTime [s]\tValue [V]');
  assert.equal(full.at(-1), '199999\t39.9998\t199999');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: '.local/explorer-large-laptop.png' });
  assert(
    (await scroll.boundingBox()).height > 250,
    `laptop table height: ${(await scroll.boundingBox()).height}`,
  );
  const plotBounds = await page.locator('#signal-panel').boundingBox();
  const footerBounds = await page.locator('footer').boundingBox();
  const chartBounds = await analogPlot.boundingBox();
  assert(
    plotBounds.y + plotBounds.height <= footerBounds.y + 1 &&
      chartBounds.y + chartBounds.height <= plotBounds.y + plotBounds.height + 1,
    'table, chart and footer fit together on a laptop',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await explorer.getByLabel('Search explorer datasets').fill('Large model');
  await explorer.locator('nav button').first().click();
  await explorer.locator('.explorer-pagination').getByText('1–200 of 1005 samples').waitFor();
  assert.equal(
    await target.getAttribute('data-sample-count'),
    '0',
    'changing datasets clears unrelated columns',
  );
  await table.locator('th').last().getByRole('button').click();
  await page.waitForFunction(
    () => document.querySelector('#signal-panel .plot-target')?.dataset.sampleCount === '1005',
  );
  assert.equal(Number(await target.getAttribute('data-time-start')), 0.25);
  assert.equal(Number(await target.getAttribute('data-time-end')), 1.254);
  await page.locator('#signal-panel .uplot').evaluate((el) => {
    el.dataset.pagePersistence = 'true';
  });
  const model = (await copyWithButton(page, explorer, 'Copy full table')).split('\n');
  assert.equal(model.length, 1006, 'full model copy includes unloaded pages');
  assert.equal(model.at(-1), '1004\t1004\t1.254\t1008');
  await explorer.getByRole('button', { name: 'Next samples', exact: true }).click();
  await explorer.locator('.explorer-pagination').getByText('201–400 of 1005 samples').waitFor();
  assert.equal(
    await table.locator('th').last().getByRole('button').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await target.getAttribute('data-sample-count'), '1005');
  assert.equal(
    await page.locator('#signal-panel .uplot').getAttribute('data-page-persistence'),
    'true',
    'paging neither truncates nor rebuilds the full-series chart',
  );
  await table.locator('tr[data-row="0"] td').last().click();
  const values = (await copyWithButton(page, explorer, 'Copy selected column(s)')).split('\n');
  assert.equal(values.length, 1006, 'model column copy covers all pages from sample zero');
  assert.equal(values[1], '4');
  assert.equal(values.at(-1), '1008');
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
}

export async function verifyCroppedExplorer(page, layout) {
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  await explorer.getByLabel('Search explorer datasets').fill('Trajectories');
  await explorer.locator('nav button').first().click();
  const table = explorer.locator('table');
  assert.equal(await table.getAttribute('aria-rowcount'), '2', 'current one-frame crop shown');
  const cells = table.locator('tr[data-row="0"] td');
  assert.equal(await cells.nth(0).getAttribute('title'), '0');
  assert.equal(await cells.nth(1).getAttribute('title'), '1');
  assert.equal(
    await cells.nth(2).getAttribute('title'),
    '9',
    'H5 zero-based source frame follows crop',
  );
  assert.equal(await cells.nth(3).getAttribute('title'), '0', 'current marker time is rebased');
  await explorer.getByLabel('Search explorer datasets').fill('Analog');
  await explorer.locator('nav button').first().click();
  assert.equal(
    await table.getAttribute('aria-rowcount'),
    '3',
    'analog crop retains both subframes',
  );
  assert.equal(await table.locator('tr[data-row="0"] td').nth(1).getAttribute('title'), '0');
  if (layout === 'current') {
    await explorer.getByLabel('Search explorer datasets').fill('IK Results');
    await explorer.locator('nav button').first().click();
    await explorer.locator('.explorer-pagination').getByText('1–4 of 4 samples').waitFor();
    assert.equal(
      await table.locator('tr[data-row="0"] td').last().getAttribute('title'),
      '4',
      'independent model result is retained',
    );
    assert.equal(
      await table.locator('tr[data-row="0"] td').nth(2).getAttribute('title'),
      '0',
      'model time is not rebased to trial crop',
    );
  }
  await page.getByRole('button', { name: 'Data Viewer', exact: true }).click();
}

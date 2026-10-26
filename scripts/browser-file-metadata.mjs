import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { verifyInspectorTabs } from './browser-inspector.mjs';

/** Compare concise presentation and copyable exact metadata across workspaces. */
export async function verifyFileMetadata(
  page,
  { name, size, demo = false, embeddedCreated = 'Not available' },
) {
  await verifyInspectorTabs(page);
  const originalTab = await page
    .locator('.inspector [role="tab"][aria-selected="true"]')
    .innerText();
  await page.getByRole('tab', { name: 'File Info', exact: true }).click();
  const info = page.getByRole('tabpanel', { name: 'File Info', exact: true });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const titles = ['File & Recording', 'Acquisition', 'Data', 'Dates & Provenance'];
  assert.deepEqual(await info.locator('.file-info-section > h4').allTextContents(), titles);
  assert(
    await info
      .locator('h4')
      .evaluateAll((headings) =>
        headings.every((heading) => getComputedStyle(heading).color === 'rgb(177, 223, 225)'),
      ),
  );
  assert(
    await info
      .locator('h5')
      .evaluateAll((headings) =>
        headings.every((heading) => getComputedStyle(heading).color === 'rgb(193, 206, 215)'),
      ),
  );
  assert.equal(await info.getByText('Details +', { exact: true }).count(), 0);
  const expected = new Map();
  for (const title of titles) {
    const section = info.getByRole('region', { name: title, exact: true });
    const rows = await section.locator('dl > div').evaluateAll((elements) =>
      elements.map((row) => {
        const summary = row.querySelector('dd summary');
        const compact = row.querySelector('.metadata-display');
        const values = [...row.querySelectorAll('.file-info-value')].map(
          (value) => value.textContent,
        );
        return {
          group:
            row.closest('.file-info-group').getAttribute('aria-label') ||
            row.closest('section').getAttribute('aria-label'),
          label: row.querySelector('dt').textContent,
          exact: values.join('\n'),
          display: compact
            ? [...compact.children]
                .map((value) =>
                  value.classList.contains('metadata-timestamp')
                    ? [...value.children].map((part) => part.textContent).join(', ')
                    : value.textContent,
                )
                .join('\n')
            : summary?.textContent || values.join('\n'),
          tooltip:
            row.querySelector('.metadata-compact')?.title ||
            summary?.title ||
            row.querySelector('.file-info-value')?.title,
        };
      }),
    );
    expected.set(title, rows);
  }
  const rows = [...expected.values()].flat();
  assert.equal(rows.filter((r) => r.label === 'File name').length, 1);
  assert.equal(rows.filter((r) => r.label === 'File size').length, 1);
  assert.equal(
    rows.some((r) =>
      ['File', 'Date', 'Created local', 'Created UTC', 'Last updated'].includes(r.label),
    ),
    false,
  );
  assert.equal(rows.find((r) => r.label === 'File name').exact, name);
  assert.equal(
    rows.find((r) => r.label === 'File size').tooltip,
    `${size.toLocaleString('en-US')} bytes`,
  );
  const filesystem = rows.filter((r) => r.group === 'Filesystem metadata');
  if (demo)
    assert.deepEqual(
      filesystem.map((r) => r.exact),
      ['Not available'],
    );
  else {
    assert.equal(filesystem[0].exact, 'Not available');
    assert.match(filesystem[1].display, / UTC$/);
  }
  assert.match(
    await info.locator('.file-info-note').innerText(),
    demo ? /fetched bytes/ : /File API/,
  );
  const created = rows.find(
    (r) => r.group === 'Embedded file metadata' && r.label.startsWith('Created'),
  );
  assert.equal(created.exact.replace('T', ' '), embeddedCreated);
  if (embeddedCreated !== 'Not available') {
    assert.match(created.display, /^\d{2} [A-Z][a-z]{2} \d{4},/);
    const details = info
      .getByRole('group', { name: 'Embedded file metadata', exact: true })
      .getByRole('button', { name: / details$/ })
      .first();
    await details.press('Space');
    assert.equal(await details.getAttribute('aria-expanded'), 'true');
    const raw = details.locator('..').locator('..').locator('.metadata-details');
    assert(await raw.isVisible());
    assert(
      await raw.evaluate((el) => el.clientWidth > el.closest('.metadata-row').clientWidth * 0.85),
      'expanded values use the full property width',
    );
    assert(
      await details.evaluate((el) => getComputedStyle(el).outlineStyle !== 'none'),
      'keyboard focus stays visible',
    );
    assert(
      await page.getByRole('button', { name: 'Play', exact: true }).isVisible(),
      'expanding exact timestamps does not start playback',
    );
    await raw
      .getByRole('button', { name: /^Copy / })
      .first()
      .click();
    await expect(raw.getByRole('status').first()).toHaveText('Copied');
    assert.equal(
      await details.getAttribute('aria-expanded'),
      'true',
      'copy does not collapse details',
    );
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      created.exact.split('\n')[0],
    );
    // Exercise denied clipboard access without altering metadata or import state.
    await page.evaluate(() => {
      window.metadataClipboardWrite = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async () => {
        throw new Error('Clipboard denied');
      };
    });
    await raw
      .getByRole('button', { name: /^Copy / })
      .first()
      .click();
    await expect(raw.getByRole('status').first()).toHaveText(/Copy failed/);
    await page.evaluate(() => {
      navigator.clipboard.writeText = window.metadataClipboardWrite;
      delete window.metadataClipboardWrite;
    });
    await details.press('Enter');
    assert.equal(await details.getAttribute('aria-expanded'), 'false');
    const property = details.locator('..').locator('..');
    assert(
      (await property.boundingBox()).height < 60,
      'collapsed timestamp has no separate Details row',
    );
    await property.locator('dt').click();
    assert.equal(
      await details.getAttribute('aria-expanded'),
      'true',
      'property label toggles details',
    );
    const second = info
      .getByRole('group', { name: 'Filesystem metadata', exact: true })
      .getByRole('button', { name: / details$/ })
      .first();
    if (await second.count()) {
      await second.click();
      assert.equal(
        await details.getAttribute('aria-expanded'),
        'true',
        'properties expand independently',
      );
    }
    for (const tab of ['Data', 'Display']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.getByRole('tab', { name: 'File Info', exact: true }).click();
      assert.equal(
        await details.getAttribute('aria-expanded'),
        'true',
        'expansion survives Inspector tab changes',
      );
    }
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
    assert.equal(
      await details.getAttribute('aria-expanded'),
      'true',
      'expansion survives workspace changes',
    );
    if (name === 'populated.h5') {
      await details.scrollIntoViewIfNeeded();
      await page.screenshot({ path: '.local/file-info-timestamp-expanded.png' });
    }
    await details.press('Enter');
    await details.press('Space');
  }
  const sourcePath = info.getByRole('button', {
    name: /^(?:Source path|Original source) details$/,
  });
  if (await sourcePath.count()) {
    await sourcePath.click();
    const rawPath = sourcePath.locator('..').locator('..').locator('.metadata-details');
    const paths = rows
      .find((r) => r.label === 'Source path' || r.label === 'Original source')
      .exact.split('\n');
    for (const [i, copy] of (
      await rawPath.getByRole('button', { name: /^Copy / }).all()
    ).entries()) {
      await copy.click();
      await expect(rawPath.getByRole('status').nth(i)).toHaveText('Copied');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), paths[i]);
      assert.equal(await sourcePath.getAttribute('aria-expanded'), 'true');
    }
  }
  for (const toggle of await info.getByRole('button', { name: / details$/ }).all())
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  const viewport = page.viewportSize();
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await info.evaluate((panel) =>
      [panel, ...panel.querySelectorAll('dd, .metadata-timestamp > span')]
        .filter((value) => value.scrollWidth > value.clientWidth + 1)
        .map((value) => ({
          label: value.closest('.metadata-row')?.querySelector('dt')?.textContent,
          className: value.className,
          width: value.clientWidth,
          scroll: value.scrollWidth,
        })),
    );
    if (overflow.length) await page.screenshot({ path: '.local/metadata-overflow.png' });
    assert.deepEqual(overflow, [], `metadata fits at ${width}px`);
  }
  await page.setViewportSize(viewport);
  for (const toggle of await info.getByRole('button', { name: / details$/ }).all())
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  for (const [title, rows] of expected) {
    await explorer.getByLabel('Search explorer datasets').fill(title);
    await explorer.locator('nav').getByTitle(`Metadata / ${title}`, { exact: true }).click();
    assert.equal(
      await explorer
        .locator('.explorer-dataset-heading h3')
        .evaluate((heading) => getComputedStyle(heading).color),
      'rgb(177, 223, 225)',
    );
    const columns = await explorer.locator('thead th').allTextContents();
    const actual = await explorer.locator('tbody tr').evaluateAll(
      (elements, { title, grouped }) =>
        elements.map((row) => {
          const cells = [...row.querySelectorAll('td')];
          return {
            group: grouped ? cells[0].textContent : title,
            label: cells.at(-2).textContent,
            display: cells.at(-1).textContent,
          };
        }),
      { title, grouped: columns[0] === 'Section' },
    );
    assert.deepEqual(
      actual,
      rows.map(({ group, label, display, exact }) => ({
        group,
        label,
        display: /^\d+ items$/.test(display) ? exact : display,
      })),
      `${title} has consistent labels, groups and formatted values`,
    );
    const exactRow = rows.findIndex(
      (r) => r.exact.includes('.123456') || r.label === 'Source path',
    );
    if (exactRow >= 0) {
      await explorer.locator('tbody tr').nth(exactRow).locator('td').last().click();
      assert.equal(
        await explorer.getByLabel('Exact selected value').locator('span').innerText(),
        rows[exactRow].exact,
      );
    }
  }
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  await page.getByRole('tab', { name: originalTab, exact: true }).click();
  console.log(
    `Metadata presentation passed: ${demo ? 'demo' : name}, four sections, source details, narrow layout and exact values.`,
  );
}

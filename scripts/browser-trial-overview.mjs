import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function verifyTrialOverview(page, { title, filename, subject, group, created }) {
  const overview = page.getByRole('region', { name: 'Trial overview', exact: true });
  await overview.locator('h3').getByText(title, { exact: true }).waitFor();
  assert.equal(await overview.locator('h3').getAttribute('title'), title);
  const row = (label) =>
    overview
      .locator('dl > div')
      .filter({ has: page.locator('dt').getByText(label, { exact: true }) })
      .locator('dd');
  for (const [label, value] of [
    ['Subject', subject],
    ['Group', group],
    ['Created', created],
  ]) {
    if (value) assert.equal(await row(label).innerText(), value);
    else assert.equal(await row(label).count(), 0, `${label} omitted when unavailable`);
  }
  assert((await overview.innerText()).includes(filename));
  assert.equal(await page.locator('.selected-marker, .coordinate-values').count(), 0);
  assert(
    await overview
      .locator('dd')
      .evaluateAll((els) => els.every((el) => el.textContent.trim().length > 0)),
    'no empty metadata rows',
  );
  const bounds = await overview.boundingBox();
  assert(bounds.height < 165, 'compact trial overview');
  assert(await overview.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  assert.equal(
    await overview.locator('h3').evaluate((el) => getComputedStyle(el).whiteSpace),
    'nowrap',
  );
}

/** Minimal C3D names/date absence are verified using a real imported synthetic source. */
export async function verifyLongTrialFilename(page) {
  const originalViewport = page.viewportSize();
  const filename = `synthetic_long_trial_${'filename_'.repeat(18)}03.c3d`;
  await page.getByLabel('Open motion file').setInputFiles({
    name: filename,
    mimeType: 'application/octet-stream',
    buffer: await readFile(resolve('.local/synthetic.c3d')),
  });
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await verifyTrialOverview(page, { title: filename, filename });
    const title = page.locator('.trial-overview h3');
    assert(
      await title.evaluate((el) => el.scrollWidth > el.clientWidth),
      'long filename truncates',
    );
    assert.equal(await title.evaluate((el) => getComputedStyle(el).textOverflow), 'ellipsis');
  }
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.getByLabel('Search data').fill('B');
  await page.getByRole('button', { name: 'B', exact: true }).click();
  assert.equal((await page.locator('.marker-row.selected button').first().innerText()).trim(), 'B');
  assert.match(await page.locator('.signal-selector-trigger').first().innerText(), /B/);
  await page.getByLabel('Search data').fill('');
  await page.setViewportSize(originalViewport);
  console.log(
    'Trial overview smoke passed: metadata identity, missing fields, long filename/laptop layout and marker selection.',
  );
}

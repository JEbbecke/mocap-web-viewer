import assert from 'node:assert/strict';

/** Current-schema synthetic source columns use the ordinary sidebar and split panes. */
export async function verifyModelPlots(page) {
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  const picker = page.locator('.signal-selector').first();
  await picker.locator(':scope > details > summary').click();
  const groups = picker.locator('.signal-selector-menu > details');
  assert.deepEqual(await groups.locator(':scope > summary').allTextContents(), [
    'Markers',
    'Analogs',
    'Forces',
    'Rigid Bodies',
    'IK Results',
    'ID Results',
  ]);
  const modelGroup = groups.filter({
    has: page.locator('summary').filter({ hasText: 'IK Results' }),
  });
  await modelGroup.locator('summary').click();
  assert(await modelGroup.evaluate((element) => element.open));
  await modelGroup.locator('summary').click();
  assert.equal(await modelGroup.evaluate((element) => element.open), false);
  await picker.locator(':scope > details > summary').press('Escape');
  assert.equal(await picker.locator(':scope > details').evaluate((element) => element.open), false);
  const primary = page.getByLabel('Signal to plot', { exact: true });
  const before = {
    file: await page.locator('.header-file').innerText(),
    undo: await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(),
    redo: await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled(),
  };
  const ik = await primary.locator('option[value^="ik:"]').first().getAttribute('value');
  const id = await primary.locator('option[value^="id:"]').first().getAttribute('value');
  assert(ik && id, 'both model catalogs are selectable');
  const search = page.getByLabel('Search data', { exact: true });
  await search.fill('');
  for (const category of ['IK results', 'ID results']) {
    const section = page
      .locator('.data-section')
      .filter({ has: page.locator('summary').filter({ hasText: category }) });
    if (!(await section.evaluate((el) => el.open))) await section.locator('summary').click();
    await section
      .getByRole('button', { name: /^Plot / })
      .first()
      .waitFor();
    await section
      .getByRole('button', { name: /^Plot / })
      .first()
      .click();
    await page
      .locator('.signal-pane .u-legend')
      .getByText(new RegExp(category.slice(0, 2) + ' ·'))
      .waitFor();
  }
  await primary.selectOption(ik);
  const split = page.getByRole('button', { name: 'Split plots', exact: true });
  if ((await split.getAttribute('aria-pressed')) !== 'true') await split.click();
  await page.getByLabel('Second signal to plot', { exact: true }).selectOption(id);
  await page.locator('.signal-pane').nth(0).locator('.u-legend').getByText(/IK ·/).waitFor();
  await page.locator('.signal-pane').nth(1).locator('.u-legend').getByText(/ID ·/).waitFor();
  assert.equal(await page.locator('.signal-pane .playhead').count(), 2);
  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  if (Number(await frame.getAttribute('aria-valuemax')) > 0) {
    await frame.press('Home');
    const initial = await page.locator('.playhead').first().getAttribute('style');
    await frame.press('End');
    await page.waitForFunction(
      (previous) => document.querySelector('.playhead')?.getAttribute('style') !== previous,
      initial,
    );
    await frame.press('Home');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Frame"]')?.getAttribute('aria-valuenow') !== '0',
    );
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  }
  await page.getByLabel('Second signal to plot', { exact: true }).selectOption('analog:0');
  await page.locator('.signal-pane').nth(1).locator('.uplot').waitFor();
  assert(
    await page.locator('.signal-pane').first().locator('.u-legend').getByText(/IK ·/).isVisible(),
  );
  await primary.selectOption('none');
  await page.getByLabel('Second signal to plot', { exact: true }).selectOption('none');
  await page.waitForFunction(() => !document.querySelector('.signal-pane .uplot'));
  assert.equal(await page.locator('.header-file').innerText(), before.file);
  assert.equal(
    await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(),
    before.undo,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled(),
    before.redo,
  );
  await split.click();
  await primary.selectOption('marker');
  await frame.press('Home');
}

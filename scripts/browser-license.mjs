import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function verifyLicense(page) {
  const footer = page.locator('footer');
  for (const [name, href] of [
    ['Privacy', 'https://jemolab.com/privacy.html'],
    ['Imprint', 'https://jemolab.com/imprint.html'],
  ]) {
    const link = footer.getByRole('link', { name, exact: true });
    assert.equal(await link.getAttribute('href'), href);
    assert.equal(await link.getAttribute('target'), '_blank');
  }
  const workspace = await page.locator('.workspace').innerText();
  await footer.getByRole('button', { name: 'Noncommercial License' }).click();
  const dialog = page.getByRole('dialog', { name: 'JE Motion Lab License' });
  assert.equal(await dialog.isVisible(), true);
  assert.match(
    await dialog.innerText(),
    /source-available under the PolyForm Noncommercial License 1\.0\.0/,
  );
  assert.match(
    await dialog.innerText(),
    /Commercial use requires a separate commercial license from Jonas Ebbecke/,
  );
  assert.match(await dialog.innerText(), /Copyright © 2026 Jonas Ebbecke/);
  const projectSummary = (await dialog.locator(':scope > p').allTextContents()).join(' ');
  assert.doesNotMatch(projectSummary, /Apache|open.source/i);
  await dialog.locator('summary', { hasText: 'Full license terms' }).click();
  assert.equal(
    await dialog.locator('details .legal-text').first().textContent(),
    await readFile('LICENSE', 'utf8'),
  );
  await dialog.locator('summary', { hasText: 'Third-party notices' }).click();
  assert.equal(
    await dialog.locator('details .legal-text').last().textContent(),
    await readFile('THIRD_PARTY_NOTICES.md', 'utf8'),
  );
  assert.equal(
    await dialog.getByRole('link', { name: 'Imprint', exact: true }).getAttribute('href'),
    'https://jemolab.com/imprint.html',
  );
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.locator('.workspace').innerText(), workspace);
  await footer.getByRole('button', { name: 'Noncommercial License' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await dialog.isVisible(), false);
}

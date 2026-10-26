import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Live geometry and interaction checks using the unchanged bundled demo H5. */
export async function verifyExplorerPolish(page) {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const explorer = page.getByRole('region', { name: 'Data Explorer', exact: true });
  const search = explorer.getByLabel('Search explorer datasets');
  const table = explorer.locator('table');
  const plot = page.locator('#signal-panel');
  const details = explorer.getByRole('button', { name: 'Details', exact: true });
  const popup = page.getByRole('dialog', { name: /dataset details$/ });
  const separator = (name) => page.getByRole('separator', { name, exact: true });
  const settle = () => page.waitForTimeout(120);
  const near = (a, b, label) => assert(Math.abs(a - b) < 1, `${label}: ${a} vs ${b}`);
  const height = async () => (await plot.boundingBox()).height;
  const compact = async () => {
    await settle();
    assert((await height()) >= 60 && (await height()) <= 90, 'compact empty inspector');
    assert.equal(await plot.locator('.uplot').count(), 0);
    await plot.getByText('Select a numeric column to plot.').waitFor();
  };
  const drag = async (name, x, y) => {
    const box = await separator(name).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + x, box.y + box.height / 2 + y, { steps: 8 });
    await page.mouse.up();
    await settle();
  };
  const geometry = () =>
    page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const scroll = document.querySelector('.explorer-scroll');
      return {
        table: rect('.explorer-scroll'),
        timeline: rect('.timeline-section'),
        plot: rect('#signal-panel'),
        nav: rect('.explorer-navigation'),
        top: scroll.scrollTop,
        left: scroll.scrollLeft,
        selected: [...document.querySelectorAll('th.selected-column')].map((el) => el.textContent),
      };
    });
  await search.fill('Trajectories');
  await explorer.locator('nav button').first().click();
  assert.equal(await details.getAttribute('aria-expanded'), 'false');
  assert.equal(await popup.count(), 0);
  assert.equal(await explorer.locator('.explorer-selection-help').count(), 0);
  await compact();
  await table.locator('tbody tr[data-row="0"] td').last().click();
  await compact(); // Numeric cells alone are not plotted.
  await table.getByRole('button', { name: 'Time [s]', exact: true }).click();
  await compact(); // A numeric clock column is not a signal.
  await table.getByRole('button', { name: 'X [mm]', exact: true }).click();
  await plot.locator('.uplot').waitFor();
  await drag('Signal Inspector height', 0, -70);
  const preferred = await height();
  assert(preferred > 180);
  await table
    .getByRole('button', { name: 'X [mm]', exact: true })
    .click({ modifiers: ['Control'] });
  await compact();
  await drag('Signal Inspector height', 0, -100);
  assert((await height()) > 150, 'empty inspector can be resized manually');
  await separator('Signal Inspector height').press('Home');
  await compact();
  await table.getByRole('button', { name: 'X [mm]', exact: true }).click();
  await plot.locator('.uplot').waitFor();
  near(await height(), preferred, 'empty resize/reset preserves expanded preference');
  await page.getByRole('button', { name: 'Hide plot panel', exact: true }).click();
  await table
    .getByRole('button', { name: 'X [mm]', exact: true })
    .click({ modifiers: ['Control'] });
  await table.getByRole('button', { name: 'Y [mm]', exact: true }).click();
  assert((await plot.getAttribute('class')).includes('is-collapsed'));
  assert.equal(await separator('Signal Inspector height').count(), 0);
  await page.getByRole('button', { name: 'Show plot panel', exact: true }).click();
  await plot.locator('.uplot').waitFor();
  near(await height(), preferred, 'explicit expand restores preference');

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 900, height: 768 },
    { width: 760, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await settle();
    if (viewport.width <= 760)
      assert(
        (await explorer.boundingBox()).height <= viewport.height,
        'narrow Explorer keeps a bounded, scrollable table',
      );
    await explorer.locator('.explorer-scroll').evaluate((el) => {
      el.scrollTop = 640;
      el.scrollLeft = 30;
    });
    await settle();
    const before = await geometry();
    await details.click();
    await popup.waitFor();
    await settle();
    assert.deepEqual(
      await geometry(),
      before,
      'opening details preserves workspace geometry and scroll',
    );
    const facts = await popup
      .locator('dl > div')
      .evaluateAll((rows) =>
        Object.fromEntries(
          rows.map((row) => [
            row.querySelector('dt').textContent,
            row.querySelector('dd').textContent,
          ]),
        ),
      );
    assert.equal(facts['Position / residual unit'], 'mm');
    assert.equal(facts['Point rate'], '200 Hz');
    assert.equal(facts.Frames, '394');
    assert.equal(facts['Source frames'], 'H5 zero-based');
    assert.equal(
      facts['Invalid samples'],
      'Validity is shown separately; stored coordinates and residuals are retained.',
    );
    if (viewport.width === 1366 || viewport.width === 390)
      await page.screenshot({
        path: `.local/explorer-details-${viewport.width}.png`,
        fullPage: true,
      });
    const box = await popup.boundingBox();
    assert(
      box.x >= 7 &&
        box.y >= 7 &&
        box.x + box.width <= viewport.width - 7 &&
        box.y + box.height <= viewport.height - 7,
      'popover stays inside viewport',
    );
    assert(
      await popup.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
      'portal is visible above table and overflow containers',
    );
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'no page overflow',
    );
    await details.click();
    assert.equal(await popup.count(), 0);
    assert.deepEqual(
      await geometry(),
      before,
      'closing details preserves workspace geometry and scroll',
    );
    await details.focus();
    await details.press('Enter');
    assert(
      await popup.evaluate((el) => document.activeElement === el),
      'keyboard opening focuses metadata',
    );
    await page.keyboard.press('Escape');
    assert.equal(await popup.count(), 0);
    assert(
      await details.evaluate((el) => document.activeElement === el),
      'Escape restores trigger focus',
    );
    assert(await explorer.isVisible(), 'Escape dismisses only the popover');
    await details.press('Space');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await popup.count(), 0);
    assert(await details.evaluate((el) => document.activeElement === el));
    await details.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(await popup.count(), 0);
    assert(
      await explorer
        .getByRole('button', { name: 'Copy selected cell(s)', exact: true })
        .evaluate((el) => document.activeElement === el),
      'Tab resumes toolbar order',
    );
    await details.click();
    await explorer.locator('.explorer-dataset-heading h3').click();
    assert.equal(await popup.count(), 0, 'outside pointer closes metadata');
    await table
      .getByRole('button', { name: 'Y [mm]', exact: true })
      .click({ modifiers: ['Control'] });
    await compact();
    await table.getByRole('button', { name: 'Y [mm]', exact: true }).click();
  }
  await page.setViewportSize({ width: 900, height: 300 });
  await details.click();
  assert(
    await popup.evaluate((el) => el.scrollHeight > el.clientHeight),
    'short viewport scrolls metadata internally',
  );
  await page.keyboard.press('End');
  await settle();
  assert(
    await popup.evaluate((el) => el.scrollTop > 0),
    'keyboard can scroll all metadata into view',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await drag('Explorer navigation width', 90, 0);
  await details.click();
  const before = await geometry();
  // Keyboard separator changes exercise anchoring while keeping the overlay open.
  await separator('Explorer navigation width').dispatchEvent('keydown', {
    key: 'ArrowRight',
    bubbles: true,
  });
  await settle();
  assert.equal(await popup.count(), 1);
  near(
    (await popup.boundingBox()).x + (await popup.boundingBox()).width,
    (await details.boundingBox()).x + (await details.boundingBox()).width,
    'popover remains anchored after resizing',
  );
  assert((await geometry()).nav.width > before.nav.width);
  await page.keyboard.press('Escape');
  await separator('Explorer navigation width').press('Home');
  // Put the real trigger near the lower viewport boundary to exercise upward placement.
  await details.evaluate((el) => {
    el.style.transform = `translateY(${innerHeight - el.getBoundingClientRect().bottom - 20}px)`;
  });
  await details.click();
  const lowerAnchor = await details.boundingBox(),
    upperPopup = await popup.boundingBox();
  assert(
    upperPopup.y + upperPopup.height <= lowerAnchor.y,
    'popover flips above a lower-edge trigger',
  );
  assert(upperPopup.y >= 8, 'flipped popover fits viewport');
  await page.keyboard.press('Escape');
  await details.evaluate((el) => el.style.removeProperty('transform'));
  await details.click();
  await search.fill('Analog');
  await explorer.locator('nav button').first().click();
  assert.equal(await popup.count(), 0, 'dataset switching closes old metadata');
  await compact();
  await details.click();
  assert(
    (await popup.getAttribute('aria-label')).includes(await explorer.locator('h3').innerText()),
  );
  assert.equal(
    await popup.getByText('Position / residual unit', { exact: true }).count(),
    0,
    'old marker facts are gone',
  );
  await page.keyboard.press('Escape');
  await search.fill('Trajectories');
  await explorer.locator('nav button').first().click();
  await compact();
  await page.screenshot({ path: '.local/explorer-empty.png' });
  await table.getByRole('button', { name: 'X [mm]', exact: true }).click();
  await plot.locator('.uplot').waitFor();
  near(await height(), preferred, 'dataset and viewport switching preserve preferred height');
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  assert.equal(await plot.locator('.signal-pane').count(), 2);
  await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
  assert.equal(await plot.locator('.signal-pane').count(), 1);
  await page.getByRole('button', { name: 'Data Visualizer', exact: true }).click();
  assert.equal(
    await plot.locator('.signal-pane').count(),
    2,
    'Split Plot survives Explorer switching',
  );
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  await page.setViewportSize(original);
  console.log(
    'Explorer polish: metadata, stable geometry/scroll/selection, keyboard/outside dismissal, viewport placement, empty/manual/collapsed sizing, dataset/workspace switching and Split Plot passed.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir('.local', { recursive: true });
  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4183', '--strictPort'],
    { windowsHide: true, stdio: 'pipe' },
  );
  let browser,
    output = '';
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  try {
    await new Promise((ok, fail) => {
      const timeout = setTimeout(() => fail(new Error(output)), 20000);
      server.stdout.on('data', (chunk) => {
        if (String(chunk).includes('4183')) {
          clearTimeout(timeout);
          ok();
        }
      });
      server.on('error', fail);
    });
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'chrome',
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://je-motion-analytics.jonasebbecke97.workers.dev/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('http://127.0.0.1:4183', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Load Example File', exact: true }).click();
    await page.locator('.inspector').waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Data Explorer', exact: true }).click();
    await verifyExplorerPolish(page);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '.local/explorer-polish.png' });
    await writeFile(
      '.local/explorer-polish-results.json',
      JSON.stringify({ passed: true, errors }, null, 2),
    );
  } finally {
    await browser?.close();
    server.kill();
  }
}

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as h5 from 'h5wasm/node';
import { verifyExplorer, verifyLargeExplorer, verifyCroppedExplorer } from './browser-explorer.mjs';
import {
  verifyVideoExport,
  captureSceneVideo,
  verifyMovingPlateVideo,
} from './browser-video-export.mjs';
import {
  verifyImageExport,
  verifyMovingPlateImages,
  captureSceneImage,
} from './browser-image-export.mjs';
import {
  chooseExportFormat,
  createCorrectedCopFixture,
  verifyCrossFormat,
  verifyExportToolbar,
} from './browser-cross-format.mjs';

const root = process.cwd();
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const analyticsOrigin = 'https://je-motion-analytics.jonasebbecke97.workers.dev';
const analyticsURL = `${analyticsOrigin}/event`;
const statsURL = `${analyticsOrigin}/stats`;
const statsFixture = {
  visits: 428,
  c3d_loaded: 405,
  h5_loaded: 500,
  files_loaded: 905,
  countries: 'DE US GB FR ES IT NL BE AT CH SE NO DK FI PL CZ PT IE CA AU NZ JP KR'
    .split(' ')
    .map((country) => ({ country, visits: 1 })),
};
await mkdir('.local', { recursive: true });
const fixtures = JSON.parse(await readFile('tests/fixtures/c3d.json', 'utf8'));
await writeFile('.local/synthetic.c3d', Buffer.from(fixtures.intelFloat, 'base64'));
const h5Fixture = JSON.parse(await readFile('tests/fixtures/current-h5.json', 'utf8'));
await writeFile('.local/synthetic.h5', Buffer.from(h5Fixture.base64, 'base64'));
const populatedH5 = JSON.parse(await readFile('tests/fixtures/current-h5.json', 'utf8'));
await writeFile('.local/populated.h5', Buffer.from(populatedH5.base64, 'base64'));
const currentH5 = JSON.parse(await readFile('tests/fixtures/current-h5.json', 'utf8'));
await writeFile('.local/current-browser.h5', Buffer.from(currentH5.base64, 'base64'));
// Synthetic metadata exercises all curated sections without participant data.
await h5.ready;
// Three-frame current-schema fixture for the shared C3D/H5 crop interaction checks.
const smallH5 = new h5.File(resolve('.local/synthetic.h5'), 'w');
try {
  const metadata = smallH5.create_group('MetaData');
  metadata.create_group('Project');
  metadata.create_group('FileInfo');
  const trajectories = smallH5.create_group('Trajectories');
  trajectories.create_attribute('SamplingFrequency', 100);
  trajectories.create_attribute('StartFrame', 10);
  const labeled = trajectories.create_group('Labeled');
  labeled.create_attribute('Labels', ['Synthetic marker']);
  labeled.create_attribute('Unit', 'mm');
  labeled.create_dataset({
    name: 'Data',
    shape: [1, 4, 3],
    data: new Float64Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 1, 1, 1]),
  });
  const analog = smallH5.create_group('Analog');
  analog.create_attribute('Labels', ['Synthetic analog']);
  analog.create_attribute('Units', ['V']);
  analog.create_attribute('SamplingFrequency', 200);
  analog.create_attribute('StartFrame', 20);
  analog.create_dataset({
    name: 'Data',
    shape: [1, 6],
    data: new Float64Array([0, 1, 2, 3, 4, 5]),
  });
} finally {
  smallH5.close();
}
createCorrectedCopFixture();
// Large, wholly synthetic recording for bounded table DOM/scroll checks.
const largeFile = new h5.File(resolve('.local/explorer-large.h5'), 'w');
try {
  const trajectories = largeFile.create_group('Trajectories');
  trajectories.create_attribute('SamplingFrequency', 100);
  trajectories.create_attribute('StartFrame', 0);
  const labeled = trajectories.create_group('Labeled');
  labeled.create_attribute('Labels', ['Synthetic marker']);
  labeled.create_attribute('Unit', 'mm');
  labeled.create_dataset({
    name: 'Data',
    data: new Float64Array(4 * 4000).fill(1),
    shape: [1, 4, 4000],
  });
  const analog = largeFile.create_group('Analog');
  analog.create_attribute('Labels', ['Large analog']);
  analog.create_attribute('Units', ['V']);
  analog.create_attribute('SamplingFrequency', 5000);
  analog.create_dataset({
    name: 'Data',
    data: Float64Array.from({ length: 200000 }, (_, i) => i),
    shape: [1, 200000],
  });
  largeFile.create_group('MetaData').create_group('Project');
  const model = largeFile.create_group('IKResults');
  model.create_attribute('Labels', ['Large model']);
  model.create_dataset({
    name: 'Data',
    data: Float64Array.from({ length: 1005 }, (_, i) => i + 4),
    shape: [1, 1005],
  });
  model.create_dataset({
    name: 'Time',
    data: Float64Array.from({ length: 1005 }, (_, i) => 0.25 + i * 0.001),
    shape: [1005],
  });
} finally {
  largeFile.close();
}
const syntheticInfoPath = 'C:\\synthetic\\' + 'long-folder-name-'.repeat(12) + '\\recording.c3d';
const populatedFile = new h5.File(resolve('.local/populated.h5'), 'a');
const incompatible = new h5.File(resolve('.local/cross-incompatible.h5'), 'w');
try {
  const trajectories = incompatible.create_group('Trajectories');
  trajectories.create_attribute('SamplingFrequency', 100);
  const labeled = trajectories.create_group('Labeled');
  labeled.create_attribute('Labels', ['Synthetic marker']);
  labeled.create_attribute('Unit', 'mm');
  labeled.create_dataset({ name: 'Data', data: new Float64Array(8).fill(1), shape: [1, 4, 2] });
  const analog = incompatible.create_group('Analog');
  analog.create_attribute('Labels', ['Independent analog']);
  analog.create_attribute('Units', ['V']);
  analog.create_attribute('SamplingFrequency', 100);
  analog.create_dataset({ name: 'Data', data: new Float64Array([1, 2, 3]), shape: [1, 3] });
  incompatible.create_group('MetaData').create_group('Project');
} finally {
  incompatible.close();
}
try {
  const metadata = populatedFile.get('MetaData');
  for (const [key, value] of Object.entries({
    SubjectID: 'SYNTHETIC-INFO',
    Age: 29,
    Sex: 'N/A',
    BodyHeight: 175,
    BodyHeightUnit: 'cm',
    BodyMass: '70 kg',
    Condition: 'Baseline',
    Project: 'Synthetic project',
    ProjectPI: 'Example researcher',
    OriginalFiles: ['first.c3d', 'second.h5', 'third.c3d', 'fourth.h5'],
    PathFile: syntheticInfoPath,
    FileCreationLocal: '2026-01-02T03:04:05.123456',
    FileCreationUTC: '2026-01-02T02:04:05.123456Z',
    LastUpdate: '2026-01-03T04:05:06Z',
  })) {
    const target = [
      'OriginalFiles',
      'PathFile',
      'FileCreationLocal',
      'FileCreationUTC',
      'LastUpdate',
    ].includes(key)
      ? metadata.get('FileInfo')
      : metadata.get('Project');
    if (key in target.attrs) target.delete_attribute(key);
    target.create_attribute(key, value);
  }
  const location = metadata.get('Location') ?? metadata.create_group('Location');
  for (const [key, value] of Object.entries({ Lat: 0, Lon: 6.1234 })) {
    if (key in location.attrs) location.delete_attribute(key);
    location.create_attribute(key, value);
  }
} finally {
  populatedFile.close();
}
const development = process.env.SMOKE_MODE === 'development';
const base =
  process.env.VITE_BASE_PATH && process.env.VITE_BASE_PATH !== './'
    ? process.env.VITE_BASE_PATH
    : '/';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    ...(development ? [] : ['preview']),
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { cwd: root, windowsHide: true, stdio: 'pipe' },
);
let browser;
let serverOutput = '';
const errors = [],
  requests = [];
server.stdout.on('data', (data) => {
  serverOutput += String(data);
});
server.stderr.on('data', (data) => {
  serverOutput += String(data);
});
try {
  await new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error('Preview server timeout')), 20000);
    server.stdout.on('data', (data) => {
      if (String(data).includes('4173')) {
        clearTimeout(timeout);
        ok();
      }
    });
    server.on('error', fail);
    server.on('exit', (code) => {
      if (code) fail(new Error(`Preview exited: ${code}`));
    });
  });
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let statsResponse = statsFixture;
  // Validate client requests without sending test activity or local references to the service.
  await page.route(`${analyticsOrigin}/**`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      contentType: 'application/json',
      body: JSON.stringify(route.request().url() === statsURL ? statsResponse : {}),
    }),
  );
  const analyticsEvents = () =>
    requests
      .filter((request) => request.url === analyticsURL && request.method === 'POST')
      .map((request) => JSON.parse(request.body).event);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text());
  });
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      contentType: request.headers()['content-type'],
    }),
  );
  await page.goto(`http://127.0.0.1:4173${base}`, { waitUntil: 'networkidle' });
  assert.equal(await page.title(), 'JE Motion Lab | MoCap Viewer & Editor');
  assert.equal(await page.locator('.brand strong').innerText(), 'JE Motion Lab');
  assert.equal(
    await page.locator('meta[name="application-name"]').getAttribute('content'),
    'JE Motion Lab',
  );
  assert.match(
    await page.locator('meta[name="description"]').getAttribute('content'),
    /^JE Motion Lab \|/,
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute('href'),
    'https://app.jemolab.com/',
  );
  assert.equal(await page.locator('.footer-version').textContent(), `v${version}`);
  assert.equal(
    await page.locator('.footer-version').getAttribute('aria-label'),
    `JE Motion Lab version ${version}`,
  );
  assert.deepEqual(analyticsEvents(), ['visit'], 'one visit on initial mount');
  assert.equal(
    (await page.locator('.welcome-stats').textContent()).replace(/\s+/g, ' ').trim(),
    '428 visits · 23 Countries · 905 MoCap files visualized',
  );
  await page.screenshot({ path: '.local/landing-stats.png' });
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(analyticsEvents(), ['visit'], 'reload does not duplicate a session visit');
  statsResponse = {};
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.welcome-stats').count(), 0, 'invalid stats are hidden');
  assert.equal(
    await page.getByRole('button', { name: 'Open a recording', exact: true }).count(),
    1,
  );
  statsResponse = statsFixture;
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.welcome-stats').count(), 1, 'valid stats are shown again');
  assert.deepEqual(analyticsEvents(), ['visit'], 'the landing page emits no file-load events');
  const controlsLoad = page.waitForResponse(
    (response) =>
      response.url() === analyticsURL &&
      response.request().postData() === JSON.stringify({ event: 'h5_loaded' }),
  );
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/populated.h5'));
  await controlsLoad;
  await page.getByRole('slider', { name: 'Frame', exact: true }).waitFor();
  await verifyExportToolbar(page);
  await page.getByRole('tab', { name: 'File Info', exact: true }).click();
  const fileInfo = page.getByRole('tabpanel', { name: 'File Info', exact: true });
  const infoValue = (label) =>
    fileInfo
      .locator('dl > div')
      .filter({ has: page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }) })
      .locator('dd');
  assert.equal(await fileInfo.locator('section').count(), 6);
  assert.equal(await infoValue('Date').innerText(), '2026-01-02 03:04:05.123456');
  assert.equal(await infoValue('Analog / force rate').innerText(), '8 Hz');
  assert.equal(await infoValue('EMG channels').innerText(), '1');
  assert.equal(await infoValue('IK results').innerText(), '1 variable');
  assert.equal(await infoValue('ID results').innerText(), '1 variable');
  assert.equal(await infoValue('Subject ID').innerText(), 'SYNTHETIC-INFO');
  assert.equal(await infoValue('Body height').innerText(), '175 cm');
  assert.equal(await infoValue('Latitude').innerText(), '0');
  assert.equal(await fileInfo.locator('pre, .event-row').count(), 0);
  assert(!/sourceTree|hierarchy|Source metadata/.test(await fileInfo.innerText()));
  await page.screenshot({ path: '.local/file-info-top.png' });
  await infoValue('Original files').locator('summary').click();
  assert.deepEqual(
    await infoValue('Original files').locator('.file-info-value').allTextContents(),
    ['first.c3d', 'second.h5', 'third.c3d', 'fourth.h5'],
  );
  await infoValue('Source path').scrollIntoViewIfNeeded();
  assert.equal(
    await infoValue('Source path').locator('span').getAttribute('title'),
    syntheticInfoPath,
  );
  assert(
    await fileInfo.evaluate(
      (el) =>
        el.scrollWidth <= el.clientWidth + 1 &&
        [...el.querySelectorAll('dd')].every((v) => v.scrollWidth <= v.clientWidth + 1),
    ),
    'metadata stays within the narrow sidebar',
  );
  await page.screenshot({ path: '.local/file-info-provenance.png' });
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: 'Markers', exact: true }).count(), 0);
  const dataBrowser = page.getByRole('tabpanel', { name: 'Data', exact: true });
  const dataGroup = (name) =>
    dataBrowser.locator('.data-section').filter({
      has: page.locator('summary > span:first-child').filter({ hasText: new RegExp(`^${name}$`) }),
    });
  // Committed marker edits share history; native text-field undo keeps its own draft.
  const firstMarker = dataBrowser.locator('.marker-row').first();
  const oldMarkerName = await firstMarker.locator('button').first().getAttribute('title');
  const otherMarkerName = await dataBrowser
    .locator('.marker-row')
    .nth(1)
    .locator('button')
    .first()
    .getAttribute('title');
  const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
  assert(await undoButton.isDisabled());
  assert(await redoButton.isDisabled());
  await firstMarker.locator('button').first().click();
  await firstMarker.getByRole('checkbox').uncheck();
  await firstMarker.locator('button').first().dblclick();
  const renameInput = page.getByRole('textbox', {
    name: `New label for ${oldMarkerName}`,
    exact: true,
  });
  await renameInput.fill('');
  await firstMarker.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await firstMarker.getByRole('alert').innerText(), /Enter a marker label/);
  await renameInput.fill(otherMarkerName);
  await firstMarker.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await firstMarker.getByRole('alert').innerText(), /already has this label/);
  await renameInput.fill('  R_Thigh_Renamed  ');
  await firstMarker.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await page.locator('.selected-marker').innerText(), /R_Thigh_Renamed/);
  assert.equal(await firstMarker.getByRole('checkbox').isChecked(), false);
  assert.match(
    await page.getByLabel('Signal to plot', { exact: true }).innerText(),
    /R_Thigh_Renamed/,
  );
  await page.getByLabel('Search data').fill(oldMarkerName);
  assert.equal(
    await dataBrowser.getByRole('button', { name: oldMarkerName, exact: true }).count(),
    0,
  );
  await page.getByLabel('Search data').fill('r_thigh_renamed');
  assert.equal(await dataBrowser.locator('.marker-row').count(), 1);
  await page.getByLabel('Search data').fill('');
  await firstMarker.getByRole('button', { name: 'Rename R_Thigh_Renamed', exact: true }).click();
  const draftInput = page.getByRole('textbox', {
    name: 'New label for R_Thigh_Renamed',
    exact: true,
  });
  await draftInput.press('End');
  await draftInput.pressSequentially('_draft');
  await draftInput.press('Control+z');
  assert.notEqual(await draftInput.inputValue(), 'R_Thigh_Renamed_draft');
  assert.match(await page.locator('.selected-marker').innerText(), /R_Thigh_Renamed/);
  await draftInput.press('Escape');
  await undoButton.click();
  assert(await undoButton.isDisabled());
  assert(!(await redoButton.isDisabled()));
  await page.keyboard.press('Control+Shift+z');
  assert.match(await page.locator('.selected-marker').innerText(), /R_Thigh_Renamed/);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  assert.match(await page.locator('.selected-marker').innerText(), /R_Thigh_Renamed/);
  await page.screenshot({ path: '.local/marker-rename.png' });
  await page.getByRole('button', { name: 'Restore original', exact: true }).click();
  assert(await undoButton.isDisabled());
  assert(await redoButton.isDisabled());
  assert.equal(await dataBrowser.locator('.data-section').count(), 8);
  for (const [name, count] of [
    ['Markers', 2],
    ['Analog channels', 1],
    ['Force platforms', 1],
    ['Events', 3],
    ['Rigid bodies', 1],
    ['EMG channels', 1],
    ['IK results', 1],
    ['ID results', 1],
  ]) {
    assert.equal(await dataGroup(name).locator('.data-count').innerText(), String(count));
  }
  // Analog renaming has the same editor/history and leaves the separate EMG collection intact.
  await page.getByLabel('Search data').fill('Channel');
  const analogSection = dataGroup('Analog channels');
  await analogSection.getByRole('button', { name: 'Plot Channel', exact: true }).dblclick();
  const analogInput = page.getByRole('textbox', { name: 'New label for Channel', exact: true });
  await analogInput.fill('');
  await analogSection.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await analogSection.getByRole('alert').innerText(), /Enter an analog channel label/);
  await analogInput.fill('Cancelled analog');
  await analogInput.press('Escape');
  assert(await undoButton.isDisabled());
  await analogSection.getByRole('button', { name: 'Rename analog Channel', exact: true }).click();
  await analogInput.fill('  Right_EMG  ');
  await analogInput.press('Enter');
  assert.equal(await page.getByLabel('Signal to plot', { exact: true }).inputValue(), 'analog:0');
  assert.match(await page.getByLabel('Signal to plot', { exact: true }).innerText(), /Right_EMG/);
  assert.equal(
    await dataGroup('Analog channels').count(),
    0,
    'old-name search has no stale analog label',
  );
  assert.equal(
    await dataGroup('EMG channels')
      .getByRole('button', { name: 'Plot Channel', exact: true })
      .count(),
    1,
  );
  await page.getByLabel('Search data').fill('right_emg');
  assert.equal(
    await analogSection.getByRole('button', { name: 'Plot Right_EMG', exact: true }).count(),
    1,
  );
  await undoButton.click();
  assert.equal(await dataGroup('Analog channels').count(), 0);
  await redoButton.click();
  assert.equal(
    await analogSection.getByRole('button', { name: 'Plot Right_EMG', exact: true }).count(),
    1,
  );
  await page.getByRole('button', { name: 'Restore original', exact: true }).click();
  assert(await undoButton.isDisabled());
  assert(await redoButton.isDisabled());
  // Remaining collections share double-click/pencil editing and the same history.
  const renamedCollections = [
    ['Force platforms', 'Plate', 'Renamed_Force'],
    ['Rigid bodies', 'Body', 'Renamed_Rigid'],
    ['EMG channels', 'Channel', 'Renamed_EMG'],
    ['IK results', 'quantity', 'Renamed_IK'],
    ['ID results', 'quantity', 'Renamed_ID'],
  ];
  for (const [sectionName, oldName, newName] of renamedCollections) {
    await page.getByLabel('Search data').fill(oldName);
    const section = dataGroup(sectionName);
    await section.locator('.data-entry').first().dblclick();
    const editor = page.getByRole('textbox', { name: `New label for ${oldName}`, exact: true });
    await editor.fill(newName);
    await editor.press('Enter');
    await page.getByLabel('Search data').fill(newName);
    assert.equal(await section.locator('.data-entry').first().getAttribute('title'), newName);
    await undoButton.click();
    assert.equal(await section.count(), 0);
    await redoButton.click();
    assert.equal(await section.locator('.data-entry').first().getAttribute('title'), newName);
  }
  const allLabelsExport = page.waitForEvent('download');
  await chooseExportFormat(page, 'H5');
  await page.locator('.export-status').waitFor();
  assert.equal(await page.locator('.export-status').innerText(), 'Export prepared');
  const labelsPath = resolve('.local/all-data-renamed.h5');
  await (await allLabelsExport).saveAs(labelsPath);
  const labelsFile = new h5.File(labelsPath, 'r');
  try {
    assert.equal(labelsFile.get('ForcePlates/0').attrs.Name.value, 'Renamed_Force');
    assert.equal(labelsFile.get('RigidBodies/0').attrs.Name.value, 'Renamed_Rigid');
    assert.equal(labelsFile.get('EMG').attrs.Labels.value[0], 'Renamed_EMG');
    assert.deepEqual(labelsFile.get('IKResults').attrs.Labels.value, ['time', 'Renamed_IK']);
    assert.deepEqual(labelsFile.get('IDResults').attrs.Labels.value, ['time', 'Renamed_ID']);
  } finally {
    labelsFile.close();
  }
  await page.getByRole('button', { name: 'Restore original', exact: true }).click();
  assert(await undoButton.isDisabled());
  // Identical Analog/EMG labels remain separate source collections with distinct plot targets.
  await page.getByLabel('Search data').fill('cHaNnEl');
  assert.equal(await dataBrowser.locator('.data-section').count(), 2);
  await dataGroup('Analog channels')
    .getByRole('button', { name: 'Plot Channel', exact: true })
    .click();
  assert.equal(await page.getByLabel('Signal to plot', { exact: true }).inputValue(), 'analog:0');
  await dataGroup('EMG channels')
    .getByRole('button', { name: 'Plot Channel', exact: true })
    .click();
  assert.equal(await page.getByLabel('Signal to plot', { exact: true }).inputValue(), 'signal:0');
  await page.getByLabel('Search data').fill('quantity');
  assert.equal(await dataBrowser.locator('.data-section').count(), 2);
  for (const name of ['IK results', 'ID results']) {
    assert.equal(await dataGroup(name).locator('.data-entry').innerText(), 'quantity');
    assert.equal(await dataGroup(name).getByRole('checkbox').count(), 0);
    assert.equal(
      await dataGroup(name).getByRole('button', { name: 'Rename quantity', exact: true }).count(),
      1,
    );
  }
  await page.getByLabel('Search data').fill('Plate');
  await dataGroup('Force platforms')
    .getByRole('button', { name: 'Plot Plate', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Signal to plot', { exact: true }).inputValue(),
    'plate:0:force',
  );
  await page.getByLabel('Search data').fill('Body');
  await dataGroup('Rigid bodies').getByRole('button', { name: 'Plot Body', exact: true }).click();
  assert.equal(await page.getByLabel('Signal to plot', { exact: true }).inputValue(), 'signal:1');
  await page.getByLabel('Search data').fill('Early');
  await dataGroup('Events').getByRole('button', { name: 'Edit event Early', exact: true }).click();
  assert.equal(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    '1',
  );
  assert.equal(await page.getByLabel('Event label', { exact: true }).inputValue(), 'Early');
  const eventTime = await page.getByLabel('Time (s)', { exact: true }).inputValue();
  await page.locator('.event-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .locator('.event-markers')
    .getByRole('button', { name: 'Edit event Early', exact: true })
    .click();
  assert.equal(await page.getByLabel('Event label', { exact: true }).inputValue(), 'Early');
  assert.equal(await page.getByLabel('Time (s)', { exact: true }).inputValue(), eventTime);
  await page.locator('.event-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Search data').fill('no matching synthetic entry');
  assert.equal(await dataBrowser.locator('.data-section').count(), 0);
  assert.equal(await dataBrowser.getByRole('status').innerText(), 'No matching data.');
  await page.getByLabel('Search data').fill('');
  assert.equal(await dataBrowser.locator('.data-section').count(), 8);
  await dataGroup('Analog channels').locator('summary').click();
  // Native details summaries also toggle from the keyboard.
  const analogSummary = dataGroup('Analog channels').locator('summary');
  const openBeforeKey = await dataGroup('Analog channels').getAttribute('open');
  await analogSummary.press('Enter');
  assert.notEqual(await dataGroup('Analog channels').getAttribute('open'), openBeforeKey);
  assert(await dataBrowser.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: '.local/data-browser.png' });
  assert.match(await page.locator('.viewport-title').innerText(), /XYZ.*mm/);
  assert.match(await page.locator('.selected-marker').innerText(), /Position in mm/);
  const primarySignal = page.getByLabel('Signal to plot', { exact: true });
  for (const [selection, unit] of [
    ['marker', 'mm'],
    ['plate:0:cop', 'mm'],
    ['plate:0:force', 'N'],
    ['plate:0:moment', 'Nm'],
  ]) {
    await primarySignal.selectOption(selection);
    await page.waitForFunction(
      (unit) => document.querySelector('.u-legend')?.textContent.includes(`X (${unit})`),
      unit,
    );
  }
  await primarySignal.selectOption('marker');
  const controlsLastFrame = Number(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
  );
  assert.equal(
    await page.locator('.welcome-stats').count(),
    0,
    'stats appear only on the landing page',
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('[aria-label="Frame"]').getAttribute('aria-valuenow')) > 0,
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert(
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) > 0,
    'playback advances',
  );
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await page.getByLabel('Search data').fill('B');
  await page.getByRole('button', { name: 'B', exact: true }).click();
  assert.equal(await page.locator('.selected-marker h3').textContent(), 'B');
  await page.getByLabel('Show B', { exact: true }).uncheck();
  assert.equal(await page.getByLabel('Show B', { exact: true }).isChecked(), false);
  await page.getByLabel('Search data').fill('A');
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByLabel('Search data').fill('B');
  assert.equal(
    await page.getByLabel('Show B', { exact: true }).isChecked(),
    true,
    'Show all restores markers outside the search results',
  );
  await page.getByLabel('Search data').fill('');
  const plotBox = await page.locator('.u-over').boundingBox();
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
    ) === Math.round(controlsLastFrame * 0.6),
    'plot scrubbing changes timeline',
  );
  const plotFrame = page.getByRole('slider', { name: 'Frame', exact: true });
  const frameBeforeZoom = await plotFrame.getAttribute('aria-valuenow');
  await page.mouse.move(plotBox.x + plotBox.width * 0.2, plotBox.y + plotBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.4, plotBox.y + plotBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  assert.equal(
    await plotFrame.getAttribute('aria-valuenow'),
    frameBeforeZoom,
    'zoom does not scrub',
  );
  await page.mouse.click(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  const zoomedFrame = Number(await plotFrame.getAttribute('aria-valuenow'));
  assert.equal(
    zoomedFrame,
    Math.round(controlsLastFrame * 0.3),
    'click uses the zoomed time range',
  );
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(await plotFrame.getAttribute('aria-valuenow')) === Math.round(controlsLastFrame * 0.6),
    'reset restores full time range',
  );
  await page.mouse.move(plotBox.x + plotBox.width * 0.2, plotBox.y + plotBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.4, plotBox.y + plotBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  await page.mouse.dblclick(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.click(plotBox.x + plotBox.width * 0.6, plotBox.y + plotBox.height * 0.5);
  assert.equal(
    Number(await plotFrame.getAttribute('aria-valuenow')),
    Math.round(controlsLastFrame * 0.6),
    'double-click resets zoom',
  );
  const beforeWheel = await plotFrame.getAttribute('aria-valuenow');
  await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  assert.equal(
    await plotFrame.getAttribute('aria-valuenow'),
    beforeWheel,
    'wheel zoom does not scrub',
  );
  await page.mouse.click(plotBox.x + plotBox.width * 0.75, plotBox.y + plotBox.height * 0.5);
  const wheelZoomed = Number(await plotFrame.getAttribute('aria-valuenow'));
  assert.equal(
    wheelZoomed,
    Math.round(controlsLastFrame * (0.5 + 0.25 * Math.exp(-0.8))),
    'wheel zooms in around pointer',
  );
  await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(100);
  await page.mouse.click(plotBox.x + plotBox.width * 0.75, plotBox.y + plotBox.height * 0.5);
  assert(
    Number(await plotFrame.getAttribute('aria-valuenow')) === Math.round(controlsLastFrame * 0.75),
    'wheel zooms out to full range',
  );
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  assert.equal(await page.getByLabel('Force vector scale', { exact: true }).inputValue(), '1');
  const sidebarFrame = Number(await plotFrame.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    Number(await plotFrame.getAttribute('aria-valuenow')),
    sidebarFrame - 1,
    'frame shortcuts work after clicking a sidebar tab',
  );
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await page.getByLabel('Marker labels', { exact: true }).check();
  await page.getByLabel('Force plate numbers', { exact: true }).uncheck();
  assert.equal(await page.getByLabel('Force plates', { exact: true }).isChecked(), true);
  await page.getByLabel('Force plate numbers', { exact: true }).check();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.screenshot({ path: '.local/plate-numbers-top.png' });
  await verifyImageExport(page, 'populated.h5');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 2, 'split view creates two plots');
  await page.getByLabel('Second signal to plot', { exact: true }).selectOption('marker:1');
  assert.equal(await page.getByLabel('Signal to plot', { exact: true }).inputValue(), 'marker');
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  const secondPlot = page.getByRole('group', { name: 'Second plot', exact: true });
  const secondBox = await secondPlot.locator('.u-over').boundingBox();
  await page.mouse.click(secondBox.x + secondBox.width * 0.4, secondBox.y + secondBox.height * 0.5);
  const splitFrame = Number(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
  );
  assert.equal(
    splitFrame,
    Math.round(controlsLastFrame * 0.4),
    'second plot scrubs shared playback',
  );
  const fractions = await page
    .locator('.u-over')
    .evaluateAll((plots) =>
      plots.map(
        (plot) => parseFloat(plot.querySelector('.playhead').style.left) / plot.clientWidth,
      ),
    );
  assert(Math.abs(fractions[0] - fractions[1]) < 0.01, 'both plots show the shared cursor');
  await page.mouse.move(secondBox.x + secondBox.width * 0.2, secondBox.y + secondBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width * 0.6, secondBox.y + secondBox.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  const zoomFractions = await page
    .locator('.u-over')
    .evaluateAll((plots) =>
      plots.map(
        (plot) => parseFloat(plot.querySelector('.playhead').style.left) / plot.clientWidth,
      ),
    );
  assert(
    Math.abs(zoomFractions[0] - fractions[0]) < 0.01,
    'zooming second plot leaves first plot unchanged',
  );
  assert(Math.abs(zoomFractions[1] - fractions[1]) > 0.05, 'second plot has independent zoom');
  await page.getByRole('button', { name: 'Reset second plot zoom', exact: true }).click();
  await page.screenshot({ path: '.local/split-plots.png' });
  await page.getByRole('button', { name: 'Hide plot panel', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 0);
  await page.getByRole('button', { name: 'Show plot panel', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 2);
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  assert.equal(await page.locator('.u-over').count(), 1, 'single view releases the second chart');
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  assert.equal(
    await page.getByLabel('Second signal to plot', { exact: true }).inputValue(),
    'marker:1',
  );
  await page.getByRole('button', { name: 'Split plots', exact: true }).click();
  await page.screenshot({ path: '.local/screenshot.png' });
  assert.deepEqual(
    analyticsEvents(),
    ['visit', 'h5_loaded'],
    'viewer controls emit no additional file-load events',
  );
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/synthetic.c3d'));
  await page.waitForFunction(
    () => document.querySelector('.coordinate-values strong')?.textContent === '100.0000',
  );
  assert.match(await page.locator('.selected-marker').innerText(), /residual 1.00 mm/);
  await page.getByRole('tab', { name: 'File Info', exact: true }).click();
  assert.equal(await fileInfo.locator('section').count(), 3, 'minimal C3D omits optional sections');
  assert.equal(
    await infoValue('Date').count(),
    0,
    'C3D filesystem timestamp is not a creation date',
  );
  assert.equal(await infoValue('Events').innerText(), '1');
  assert.equal(await fileInfo.locator('.event-row, pre').count(), 0);
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  assert.equal(await dataBrowser.locator('.data-section').count(), 3);
  assert.equal(await dataGroup('Force platforms').count(), 0);
  for (const name of ['EMG channels', 'Rigid bodies', 'IK results', 'ID results'])
    assert.equal(await dataGroup(name).count(), 0);
  await page.getByRole('button', { name: 'Add Event', exact: true }).click();
  await page.getByLabel('Event label', { exact: true }).fill('Synthetic added event');
  await page.getByLabel('Time (s)', { exact: true }).fill('0.015');
  await page.getByLabel('Context', { exact: true }).fill('Right');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.getByRole('button', { name: 'Edit event Synthetic added event', exact: true }).click();
  await page.getByLabel('Event label', { exact: true }).fill('Synthetic edited event');
  await page.getByLabel('Time (s)', { exact: true }).fill('0.02');
  await page.screenshot({ path: '.local/event-editor.png' });
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  const eventExport = page.waitForEvent('download');
  // Compare the arrow's geometric tip with the playback axis, including a scroll gutter.
  const alignment = await page.evaluate(() => {
    const marker = document.querySelector(
      '[aria-label="Edit event Synthetic edited event"] .event-pin',
    );
    const slider = document.querySelector('.timeline-slider');
    const strip = document.querySelector('.event-scroll');
    const offset = () => {
      const pin = marker.getBoundingClientRect(),
        rail = slider.getBoundingClientRect();
      return pin.left + pin.width / 2 - (rail.left + (rail.width * 2) / 3);
    };
    const normal = offset();
    const previous = strip.style.maxHeight;
    strip.style.maxHeight = '6px';
    const scrolling = offset();
    strip.style.maxHeight = previous;
    return { normal, scrolling };
  });
  assert(Math.abs(alignment.normal) < 0.1, 'event tip aligns with its frame');
  assert(Math.abs(alignment.scrolling) < 0.1, 'event scrolling preserves the time axis');
  await chooseExportFormat(page, 'C3D');
  const eventFile = await eventExport;
  assert.equal(eventFile.suggestedFilename(), 'synthetic_edited.c3d');
  await eventFile.saveAs(resolve('.local/events-edited.c3d'));
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/events-edited.c3d'));
  await page
    .getByRole('button', { name: 'Edit event Synthetic edited event', exact: true })
    .click();
  assert(
    Math.abs(Number(await page.getByLabel('Time (s)', { exact: true }).inputValue()) - 0.02) < 1e-6,
  );
  assert.equal(await page.getByLabel('Context', { exact: true }).inputValue(), 'Right');
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete event', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Edit event Synthetic edited event', exact: true })
      .count(),
    0,
  );
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/synthetic.c3d'));
  await page.waitForFunction(
    () =>
      document.body.textContent.includes('synthetic.c3d') &&
      !document.body.textContent.includes('Reading your recording'),
  );
  assert.equal(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
    '2',
  );
  await verifyVideoExport(page, 'synthetic.c3d', 0.02);
  for (const path of [resolve('.local/synthetic.h5')]) {
    await page.getByLabel('Open motion file').setInputFiles(path);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0, 'reference file loads without error');
    assert(
      Number(
        await page
          .getByRole('slider', { name: 'Frame', exact: true })
          .getAttribute('aria-valuemax'),
      ) >= 2,
    );
    await page.getByRole('button', { name: 'Jump to end', exact: true }).click();
    await page.getByRole('button', { name: 'Jump to beginning', exact: true }).click();
  }
  // Populated schema, actual import/export workers, events and no-op byte identity.
  for (const [label, path] of [
    ['populated', resolve('.local/populated.h5')],
    ['current', resolve('.local/current-browser.h5')],
  ].filter(([, p]) => existsSync(p))) {
    const open = async (file) => {
      await page.getByLabel('Open motion file').setInputFiles(file);
      await page.waitForFunction(
        () => !document.body.textContent.includes('Reading your recording'),
      );
      assert.equal(await page.getByRole('alert').count(), 0);
    };
    const save = async (suffix) => {
      const pending = page.waitForEvent('download');
      await chooseExportFormat(page, 'H5');
      const exportedFile = await pending,
        target = resolve(`.local/h5-validation/${label}-browser-${suffix}.h5`);
      await exportedFile.saveAs(target);
      return target;
    };
    await mkdir('.local/h5-validation', { recursive: true });
    await open(path);
    await verifyExplorer(page, 'H5');
    assert.equal(
      await page.getByRole('button', { name: 'Add Event', exact: true }).isEnabled(),
      true,
    );
    const copy = await save('unchanged');
    assert.deepEqual(
      await readFile(copy),
      await readFile(path),
      'unchanged H5 worker export is byte-identical',
    );
    const options = await page
      .getByLabel('Signal to plot', { exact: true })
      .locator('option')
      .allTextContents();
    for (const group of ['EMG', 'RigidBodies'])
      assert(
        options.some((o) => o.includes(group)),
        `${group} signals exposed`,
      );
    const signalSelect = page.getByLabel('Signal to plot', { exact: true });
    for (const group of ['IKResults', 'IDResults']) {
      assert(!options.some((o) => o.includes(group)), `${group} signals ignored`);
      assert(
        !(await page.locator('body').innerText()).includes(`${group}:`),
        `${group} has no import notes`,
      );
    }
    for (const group of ['EMG', 'RigidBodies']) {
      await signalSelect.selectOption({ index: options.findIndex((o) => o.includes(group)) });
      await page.waitForTimeout(50);
    }
    await signalSelect.selectOption('plate:0:freeMoment');
    await page.getByRole('slider', { name: 'Frame', exact: true }).press('PageUp');
    await page.screenshot({ path: `.local/h5-validation/${label}-view.png` });
    await page.getByLabel('Select event', { exact: true }).selectOption('0');
    await page.getByLabel('Event label', { exact: true }).fill('Browser edited event');
    await page.getByLabel('Description', { exact: true }).fill('Browser event description');
    await page.getByLabel('Time (s)', { exact: true }).fill('0.1');
    assert.equal(
      await page.getByLabel('Context', { exact: true }).count(),
      1,
      'context follows the imported event schema',
    );
    await page.getByLabel('Context', { exact: true }).fill('Left');
    await page.getByLabel('Subject', { exact: true }).fill('Synthetic browser subject');
    await page.getByRole('button', { name: 'Save event', exact: true }).click();
    const edited = await save('edited');
    await open(edited);
    assert(
      (await page.getByLabel('Select event').locator('option').allTextContents()).some((o) =>
        o.includes('Browser edited event'),
      ),
    );
    await page.getByRole('button', { name: 'Add Event', exact: true }).click();
    await page.getByLabel('Event label', { exact: true }).fill('Browser added event');
    await page.getByLabel('Time (s)', { exact: true }).fill('0.2');
    await page.getByRole('button', { name: 'Save event', exact: true }).click();
    const added = await save('added');
    await open(added);
    const choices = await page.getByLabel('Select event').locator('option').allTextContents();
    const row = choices.findIndex((o) => o.includes('Browser added event'));
    assert(row > 0);
    await page.getByLabel('Select event').selectOption({ index: row });
    await page.getByRole('button', { name: 'Delete event', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm delete event', exact: true }).click();
    const deleted = await save('deleted');
    await open(deleted);
    assert(
      !(await page.getByLabel('Select event').locator('option').allTextContents()).some((o) =>
        o.includes('Browser added event'),
      ),
    );
    await page.getByRole('slider', { name: 'Crop start', exact: true }).press('ArrowRight');
    await page.getByRole('slider', { name: 'Crop end', exact: true }).press('Home');
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    await verifyCroppedExplorer(page, label);
    const cropped = await save('cropped');
    await open(cropped);
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '0',
    );
  }
  // Actual worker export/re-import, with request and storage monitoring still active.
  for (const extension of ['c3d', 'h5']) {
    await page
      .getByLabel('Open motion file')
      .setInputFiles(resolve(`.local/synthetic.${extension}`));
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert(await undoButton.isDisabled(), 'new file clears undo');
    assert(await redoButton.isDisabled(), 'new file clears redo');
    await page.getByRole('tab', { name: 'Data', exact: true }).click();
    await page.getByLabel('Search data').fill('');
    const exportMarker = dataBrowser.locator('.marker-row').first();
    const importedLabel = await exportMarker.locator('button').first().getAttribute('title');
    await exportMarker
      .getByRole('button', { name: `Rename ${importedLabel}`, exact: true })
      .click();
    await page
      .getByRole('textbox', { name: `New label for ${importedLabel}`, exact: true })
      .fill('Exported_Thigh');
    await exportMarker.getByRole('button', { name: 'Save', exact: true }).click();
    await undoButton.click();
    await redoButton.click();
    const analogGroup = dataGroup('Analog channels');
    if ((await analogGroup.getAttribute('open')) === null)
      await analogGroup.locator('summary').click();
    const analogLabel = analogGroup.locator('.data-entry').first();
    const originalAnalogName = await analogLabel.getAttribute('title');
    await analogLabel.dblclick();
    await page
      .getByRole('textbox', { name: `New label for ${originalAnalogName}`, exact: true })
      .fill('Exported_Analog');
    await analogGroup.getByRole('button', { name: 'Save', exact: true }).click();
    await undoButton.click();
    await redoButton.click();
    assert.equal(
      await page.locator('.timeline input[type="number"]').count(),
      0,
      'no crop frame inputs',
    );
    const start = page.getByRole('slider', { name: 'Crop start', exact: true });
    const end = page.getByRole('slider', { name: 'Crop end', exact: true });
    await start.press('End');
    await end.press('Home');
    assert.equal(await start.getAttribute('aria-valuenow'), '2');
    assert.equal(await end.getAttribute('aria-valuenow'), '3', 'handles cannot cross');
    await page.getByRole('button', { name: 'Cancel crop', exact: true }).click();
    assert.equal(await start.getAttribute('aria-valuenow'), '0', 'cancel restores full range');
    const rail = await page.locator('.timeline-slider').boundingBox();
    const handle = await start.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 + rail.width / 3,
      handle.y + handle.height / 2,
      { steps: 8 },
    );
    const playhead = page.getByRole('slider', { name: 'Frame', exact: true });
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '1',
      'frame follows start handle while dragging',
    );
    await page.mouse.up();
    assert.equal(await start.getAttribute('aria-valuenow'), '1', 'drag adjusts start boundary');
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'frame shortcuts work after crop drag',
    );
    assert.equal(
      await start.getAttribute('aria-valuenow'),
      '1',
      'frame shortcut does not edit crop',
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    const endHandle = await end.boundingBox();
    await page.mouse.move(endHandle.x + endHandle.width / 2, endHandle.y + endHandle.height / 2);
    await page.mouse.down();
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'exclusive recording end previews last frame',
    );
    await page.mouse.move(
      endHandle.x + endHandle.width / 2 - rail.width / 3,
      endHandle.y + endHandle.height / 2,
      { steps: 8 },
    );
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      '2',
      'frame follows end handle while dragging',
    );
    await page.mouse.up();
    assert.equal(await end.getAttribute('aria-valuenow'), '2', 'end adjusts independently');
    await end.press('ArrowRight');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(80);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    assert(
      Number(
        await page
          .getByRole('slider', { name: 'Frame', exact: true })
          .getAttribute('aria-valuenow'),
      ) >= 1,
      'preview stays in crop range',
    );
    if (extension === 'h5') await page.screenshot({ path: '.local/crop-selection.png' });
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    assert(await undoButton.isDisabled(), 'crop clears undo history');
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '1',
    );
    const croppedFrame = await playhead.getAttribute('aria-valuenow');
    await captureSceneImage(page, `synthetic.${extension}`, 'viewport', false);
    assert.equal(
      await playhead.getAttribute('aria-valuenow'),
      croppedFrame,
      'image export preserves the cropped timeline',
    );
    assert(await undoButton.isDisabled(), 'image export adds no crop history');
    if (extension === 'h5') {
      await captureSceneVideo(page, 'synthetic.h5', 0.01, { fps: 60 });
      assert.equal(
        await playhead.getAttribute('aria-valuenow'),
        croppedFrame,
        'video export preserves the cropped timeline',
      );
    }
    const exportPromise = page.waitForEvent('download');
    await chooseExportFormat(page, extension === 'c3d' ? 'C3D' : 'H5');
    const exportedFile = await exportPromise;
    assert.equal(exportedFile.suggestedFilename(), `synthetic_cropped.${extension}`);
    const exportedPath = resolve(`.local/synthetic_cropped.${extension}`);
    await exportedFile.saveAs(exportedPath);
    await page.getByRole('button', { name: 'Restore original', exact: true }).click();
    assert.equal(
      await dataBrowser.getByRole('button', { name: importedLabel, exact: true }).count(),
      1,
    );
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '2',
    );
    await page.getByLabel('Open motion file').setInputFiles(exportedPath);
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(
      await dataBrowser.getByRole('button', { name: 'Exported_Thigh', exact: true }).count(),
      1,
    );
    assert(await undoButton.isDisabled(), 're-import cannot undo edits from prior recording');
    assert.equal(
      await dataGroup('Analog channels')
        .getByRole('button', { name: 'Plot Exported_Analog', exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuemax'),
      '1',
    );
  }
  // Created by the moving-plate tests: real H5 with marker-rate global corners,
  // independently sampled forces and a translating/tilting pose.
  if (existsSync('.local/moving-plates.h5')) {
    await page.getByLabel('Open motion file').setInputFiles(resolve('.local/moving-plates.h5'));
    await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Top', exact: true }).click();
    await page.getByRole('tab', { name: 'Display', exact: true }).click();
    for (const name of [
      'Markers',
      'Marker connections',
      'Force plate numbers',
      'Ground reaction forces',
      'Centre of pressure',
      'Marker labels',
      'Ground grid',
      'Coordinate axes',
    ])
      await page.getByRole('checkbox', { name, exact: true }).uncheck();
    const plates = page.getByRole('checkbox', { name: 'Force plates', exact: true });
    const frame = page.getByRole('slider', { name: 'Frame', exact: true });
    const canvas = page.locator('.viewport canvas');
    await frame.press('Home');
    await plates.uncheck();
    await page.waitForTimeout(250);
    const empty = await canvas.screenshot();
    await plates.check();
    await page.waitForTimeout(100);
    const first = await canvas.screenshot({ path: '.local/moving-plate-frame-0.png' });
    assert(!first.equals(empty), 'moving H5 plate surface is visible without force or markers');
    await frame.press('ArrowRight');
    await page.waitForTimeout(100);
    const middle = await canvas.screenshot({ path: '.local/moving-plate-frame-1.png' });
    assert(!middle.equals(empty), 'translated and tilted plate remains visible');
    assert(!middle.equals(first), 'plate surface follows its geometry frame');
    await frame.press('ArrowRight');
    await page.waitForTimeout(100);
    const last = await canvas.screenshot({ path: '.local/moving-plate-frame-2.png' });
    assert(!last.equals(empty), 'final plate frame remains in camera bounds');
    assert(!last.equals(middle), 'plate advances to final geometry frame');
    await verifyMovingPlateImages(page, 'moving-plates.h5');
    await verifyMovingPlateVideo(page);
  }
  // Both HDF5 extensions share one load event, with no filename in the payload.
  const hdf5Load = page.waitForResponse(
    (response) =>
      response.url() === analyticsURL &&
      response.request().postData() === JSON.stringify({ event: 'h5_loaded' }),
  );
  await page.getByLabel('Open motion file').setInputFiles({
    name: 'synthetic.hdf5',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(h5Fixture.base64, 'base64'),
  });
  await hdf5Load;
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/synthetic.c3d'));
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await verifyExplorer(page, 'C3D');
  await verifyCrossFormat(page, analyticsEvents);
  await page.getByLabel('Open motion file').setInputFiles(resolve('.local/explorer-large.h5'));
  await page.waitForFunction(() => !document.body.textContent.includes('Reading your recording'));
  await verifyLargeExplorer(page);
  const eventsBeforeFailure = analyticsEvents();
  assert.deepEqual(errors, [], 'no runtime/CSP errors while opening valid files');
  // Bad file must leave the previous usable trial in place.
  await page.getByLabel('Open motion file').setInputFiles({
    name: 'broken.c3d',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  assert.equal(await page.getByRole('slider', { name: 'Frame', exact: true }).count(), 1);
  assert.deepEqual(analyticsEvents(), eventsBeforeFailure, 'failed imports emit no load event');
  assert.equal(analyticsEvents().filter((event) => event === 'visit').length, 1);
  assert(analyticsEvents().includes('c3d_loaded'), 'successful C3D imports are counted');
  assert(analyticsEvents().includes('h5_loaded'), 'successful H5 imports are counted');
  const unexpectedErrors = errors.filter(
    (message) => !(development && message.startsWith('Error: Invalid C3D header.')),
  );
  assert.deepEqual(unexpectedErrors, [], 'no unexpected runtime/CSP errors');
  for (const request of requests) {
    const url = new URL(request.url);
    if (url.origin === analyticsOrigin) {
      if (request.url === statsURL) {
        assert.equal(request.method, 'GET', 'stats are read without sending an event');
        assert.equal(request.body, null, 'stats requests contain no recording data');
        continue;
      }
      assert.equal(request.url, analyticsURL, 'analytics uses only the fixed endpoint');
      if (request.method === 'OPTIONS') {
        assert.equal(request.body, null, 'CORS preflights have no payload');
      } else {
        assert.equal(request.method, 'POST');
        assert.equal(request.contentType, 'application/json');
        assert(
          ['visit', 'c3d_loaded', 'h5_loaded'].some(
            (event) => request.body === JSON.stringify({ event }),
          ),
          'analytics contains exactly one allowed event and no recording data or identifiers',
        );
      }
      continue;
    }
    assert.equal(url.origin, 'http://127.0.0.1:4173');
    assert.equal(request.method, 'GET');
    assert.equal(request.body, null);
    if (!development) {
      assert(url.pathname.startsWith(base));
      const path = url.pathname.slice(base.length);
      assert(
        path === '' || path === 'icon.svg' || /^assets\/[\w.-]+\.(js|css)$/.test(path),
        `unexpected request ${url.pathname}`,
      );
      assert.equal(url.search, '');
    }
  }
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: Object.fromEntries(Object.entries(sessionStorage)),
    caches: await caches.keys(),
    databases: await indexedDB.databases(),
  }));
  assert.deepEqual(storage, {
    local: 0,
    session: { 'je-motion-visit-counted': 'true' },
    caches: [],
    databases: [],
  });
  assert.deepEqual(await page.context().cookies(), [], 'no cookies in the test context');
  await writeFile(
    `.local/browser-report${development ? '-dev' : base === '/' ? '' : '-subpath'}.json`,
    JSON.stringify(
      {
        passed: true,
        development,
        base,
        runtimeErrors: unexpectedErrors,
        expectedDeveloperErrors: errors.filter((message) => !unexpectedErrors.includes(message)),
        requests: requests.map((r) => new URL(r.url).pathname),
        storage,
        analyticsIntercepted: true,
        analyticsEvents: analyticsEvents(),
        syntheticDataOnly: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Browser smoke passed: viewer controls, local C3D/H5, footer version, errors, event-only analytics and session flag.',
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  await writeFile(
    '.local/browser-failure.json',
    JSON.stringify(
      {
        error: String(error),
        errors,
        serverOutput,
        body: page ? await page.locator('body').innerText() : '',
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill();
}

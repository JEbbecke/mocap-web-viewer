import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import * as h5 from 'h5wasm/node';

const clusterEvents = [
  [0, 'Start same', 'Left'],
  [0, 'Start same', 'Right'],
  [0.00001, 'Start near', 'Other'],
  [0.2, 'Isolated', 'Rigth'],
  [0.48, 'Shared label', 'Left'],
  [0.48, 'Shared label', 'Right'],
  [0.4801, 'Near', 'Other'],
  [0.65, 'Resize A', 'Left'],
  [0.68, 'Resize B', 'Right'],
  [0.99, 'End same', 'Left'],
  [0.99, 'End same', 'Right'],
];

export function createClusterFixtures() {
  for (const [filename, events, frameCount = 100] of [
    ['cluster-ui', clusterEvents],
    [
      'cluster-large',
      Array.from({ length: 250 }, (_, i) => [0.5, 'Repeated', i % 2 ? 'Left' : 'Right']),
    ],
    [
      'cluster-sequence',
      Array.from({ length: 40 }, (_, i) => [
        i === 39 ? 49 : 3 + i * 0.7,
        `Sequence ${i}`,
        ['Left', 'Right', 'General'][i % 3],
      ]),
      5000,
    ],
  ]) {
    const file = new h5.File(resolve(`.local/${filename}.h5`), 'w');
    try {
      file.create_group('MetaData').create_group('Project');
      const trajectories = file.create_group('Trajectories');
      trajectories.create_attribute('SamplingFrequency', 100);
      trajectories.create_attribute('StartFrame', 120);
      const labeled = trajectories.create_group('Labeled');
      labeled.create_attribute('Labels', ['Synthetic marker']);
      labeled.create_attribute('Unit', 'mm');
      labeled.create_dataset({
        name: 'Data',
        data: new Float64Array(frameCount * 4).fill(1),
        shape: [1, 4, frameCount],
      });
      const group = file.create_group('Events');
      for (const [name, data] of Object.entries({
        Name: events.map((e) => e[1]),
        Context: events.map((e) => e[2]),
        Time: Float64Array.from(events, (e) => 1.2 + e[0]),
        Frame: Int32Array.from(events, (e) => 120 + Math.round(e[0] * 100)),
        Description: events.map((_, i) => `Description ${i}`),
        Subject: events.map((_, i) => `Subject ${i}`),
        GenericFlag: new Int32Array(events.length),
        IconID: new Int32Array(events.length),
      }))
        group.create_dataset({ name, data, shape: [events.length] });
    } finally {
      file.close();
    }
  }
}

/** Select the actual event through its marker or cluster, including coincident C3D events. */
export async function openTimelineEvent(page, label) {
  const options = await page
    .getByLabel('Select event', { exact: true })
    .locator('option')
    .evaluateAll((rows) => rows.map((row) => ({ text: row.textContent, value: row.value })));
  const target = options.find((row) => row.value !== '' && row.text.startsWith(`${label} ·`));
  assert(target, `event exists: ${label}`);
  const direct = page.locator(`.event-markers button[data-event-index="${target.value}"]`);
  if (await direct.count()) {
    await direct.click();
    return;
  }
  const clusters = page.locator('.event-markers .event-cluster');
  for (let i = 0; i < (await clusters.count()); i++) {
    await clusters.nth(i).click();
    const row = page.locator(`.event-cluster-popup [data-event-index="${target.value}"]`);
    if (await row.count()) {
      await row.click();
      return;
    }
    await page.keyboard.press('Escape');
  }
  assert.fail(`event is reachable from its marker or cluster: ${label}`);
}

/** Compare both presentations using the same 40-event, 50-second recording. */
async function verifyHybridEventMarkers(page) {
  const viewport = page.viewportSize();
  const button = (name) => page.getByRole('button', { name, exact: true });
  const input = (name) => page.getByLabel(name, { exact: true });
  const checkbox = input('Compact event markers');
  const axis = page.locator('.event-markers');
  const popup = page.locator('.event-cluster-popup');
  const editor = page.locator('.event-editor');
  const settle = async () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  const load = async (name) => {
    await input('Open motion file').setInputFiles(resolve(`.local/${name}.h5`));
    await page.waitForFunction(
      (filename) =>
        !document.querySelector('.loading-overlay') &&
        document.querySelector('.header-file')?.textContent.includes(filename),
      `${name}.h5`,
    );
    await settle();
  };
  await load('cluster-ui');
  if (await button('Show right sidebar').isVisible()) await button('Show right sidebar').click();
  await button('Data Visualizer').click();
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  assert.equal(await checkbox.isChecked(), false, 'context-aware mode is the session default');
  assert.equal(
    await checkbox.locator('..').getAttribute('title'),
    'Display events in one row and cluster only overlapping markers.',
  );
  const mode = async (compact) => {
    await checkbox.setChecked(compact);
    await page.waitForFunction(
      (value) => document.querySelector('.event-markers')?.dataset.mode === value,
      compact ? 'compact' : 'context-aware',
    );
    await settle();
  };
  const geometry = async () =>
    page.locator('.timeline').evaluate((panel) => {
      const origin = panel.getBoundingClientRect();
      return [
        origin.height,
        ...[
          ...panel.querySelectorAll(
            '.transport, .time-labels, .timeline-slider, .playback-settings, .crop-actions, .event-toolbar',
          ),
        ].flatMap((el) => {
          const r = el.getBoundingClientRect();
          return [r.x - origin.x, r.y - origin.y, r.width, r.height];
        }),
      ];
    });
  const measure = async (count) => {
    const result = await axis.evaluate((track) => {
      const rail = document.querySelector('.timeline-slider').getBoundingClientRect();
      const strip = track.closest('.event-scroll').getBoundingClientRect();
      const groups = [...track.children].map((el) => {
        const pin = el.querySelector('.event-pin');
        const r = (pin ?? el).getBoundingClientRect();
        const style = getComputedStyle(pin ?? el);
        return {
          count: Number(el.dataset.eventCount),
          index: Number(el.dataset.eventIndex),
          lane: Number(el.dataset.eventLane),
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          xError: Math.abs(
            r.left + r.width / 2 - rail.left - (rail.width * parseFloat(el.style.left)) / 100,
          ),
          context: el.className,
          color: getComputedStyle(el).color,
          diamond: !!pin && style.borderTopWidth === '0px' && style.transform.includes('0.707'),
        };
      });
      return {
        groups,
        trackWidth: rail.width,
        strip: { left: strip.left, right: strip.right, top: strip.top, bottom: strip.bottom },
        timelineHeight: document.querySelector('.timeline').getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(
      result.groups.reduce((n, g) => n + g.count, 0),
      count,
    );
    assert(!result.overflow, 'no horizontal overflow in either presentation');
    for (const g of result.groups) {
      assert([0, 1].includes(g.lane), 'there is no third lane');
      assert(
        g.top >= result.strip.top - 0.1 && g.bottom <= result.strip.bottom + 0.1,
        'both lanes fit the original marker area',
      );
      assert(
        g.left >= result.strip.left - 0.1 && g.right <= result.strip.right + 0.1,
        'edge markers remain visible',
      );
      assert(g.xError < 0.1, 'shared temporal axis remains exact');
      if (g.count !== 1) continue;
      if (g.context.includes('event-context-left')) {
        assert.equal(g.color, 'rgb(255, 107, 107)');
        assert(!g.diamond);
        if ((await axis.getAttribute('data-mode')) === 'context-aware') assert.equal(g.lane, 0);
      } else if (g.context.includes('event-context-right')) {
        assert.equal(g.color, 'rgb(101, 220, 140)');
        assert(!g.diamond);
        if ((await axis.getAttribute('data-mode')) === 'context-aware') assert.equal(g.lane, 1);
      } else {
        assert.equal(g.color, 'rgb(255, 205, 135)');
        assert(g.diamond, 'General uses the same yellow, with a diamond shape');
      }
    }
    for (const lane of [0, 1]) {
      const row = result.groups.filter((g) => g.lane === lane);
      for (let i = 1; i < row.length; i++)
        assert(row[i].left - row[i - 1].right >= 0.9, 'visible glyphs and badges do not collide');
    }
    return result;
  };
  const comparisons = [];
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
    [800, 1000],
    [600, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await load('cluster-sequence');
    const baseline = await geometry();
    for (const compact of [false, true]) {
      await mode(compact);
      assert.deepEqual(
        await geometry(),
        baseline,
        'switching lanes leaves Timeline controls and height unchanged',
      );
      const result = await measure(40);
      const individual = result.groups.filter((g) => g.count === 1).length;
      const clustered = result.groups.filter((g) => g.count > 1);
      const largestCluster = Math.max(0, ...clustered.map((g) => g.count));
      if (width >= 1920)
        assert.equal(
          individual,
          40,
          'the comparable extended sequence retains all 40 individual events',
        );
      assert(largestCluster < 20, 'no 39-event transitive cluster, even on a narrow track');
      if (compact) assert(result.groups.every((g) => g.lane === 0));
      comparisons.push({
        viewport: `${width}x${height}`,
        mode: compact ? 'compact' : 'context-aware',
        trackWidth: result.trackWidth,
        individual,
        clusters: clustered.length,
        clusteredEvents: clustered.reduce((n, g) => n + g.count, 0),
        largestCluster,
        timelineHeight: result.timelineHeight,
      });
      await page.screenshot({
        path: `.local/event-hybrid-${width}-${compact ? 'compact' : 'context-aware'}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mode(false);
  await load('cluster-ui');
  await measure(11);
  // Coincident Left/Right remain separate; General uses the smallest local mixed cluster.
  assert.equal(await axis.locator('[data-event-index="1"]').getAttribute('data-event-lane'), '1');
  assert.equal(await axis.locator('[data-event-index="9"]').getAttribute('data-event-lane'), '0');
  assert.equal(await axis.locator('[data-event-index="10"]').getAttribute('data-event-lane'), '1');
  const local = axis.locator('.event-cluster').first();
  await local.focus();
  await local.press('Enter');
  assert.deepEqual(
    await popup
      .locator('[data-event-index]')
      .evaluateAll((rows) => rows.map((r) => Number(r.dataset.eventIndex))),
    [0, 2],
  );
  await page.keyboard.press('Escape');
  assert(await local.evaluate((el) => el === document.activeElement));
  await local.press('Space');
  await popup.locator('[data-event-index="2"]').click();
  assert.equal(await input('Select event').inputValue(), '2');
  assert.equal(await input('Context').inputValue(), 'Other');
  assert.equal(await input('Description').inputValue(), 'Description 2');
  await input('Event label').fill('Keep this unsaved draft');
  await page.getByRole('slider', { name: 'Crop start', exact: true }).press('ArrowRight');
  const state = async () => ({
    selection: await input('Select event').inputValue(),
    draft: await input('Event label').inputValue(),
    time: await input('Time (s)').getAttribute('title'),
    sourceFrame: await input('Source frame').inputValue(),
    frame: await page
      .getByRole('slider', { name: 'Frame', exact: true })
      .getAttribute('aria-valuenow'),
    crop: await page
      .getByRole('slider', { name: 'Crop start', exact: true })
      .getAttribute('aria-valuenow'),
    dirty: await button('Undo').isDisabled(),
  });
  const before = await state();
  for (const compact of [true, false, true]) {
    await mode(compact);
    assert.deepEqual(
      await state(),
      before,
      'mode preserves selected identity, draft, exact time/frame and crop',
    );
    assert.equal(await axis.locator('[aria-pressed="true"]').count(), 1);
  }
  await page.getByRole('tab', { name: 'File Info', exact: true }).click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  assert(await checkbox.isChecked(), 'mode survives Inspector tab changes');
  await button('Data Explorer').click();
  await button('Data Visualizer').click();
  assert(await checkbox.isChecked(), 'mode survives workspace changes');
  assert.deepEqual(await state(), before, 'workspace changes retain the existing event draft');
  await button('Hide right sidebar').click();
  await button('Show right sidebar').click();
  assert(await checkbox.isChecked());
  assert.deepEqual(
    await state(),
    before,
    'Inspector width changes retain exact selection and draft',
  );
  await axis.locator('.event-cluster[aria-pressed="true"]').click();
  await checkbox.focus();
  assert.equal(await popup.count(), 1, 'moving keyboard focus leaves the popup open');
  await checkbox.press('Space');
  await page.waitForFunction(
    () => document.querySelector('.event-markers')?.dataset.mode === 'context-aware',
  );
  await settle();
  assert.equal(await popup.count(), 0, 'mode switching dismisses an open popup');
  assert.deepEqual(await state(), before);
  await input('Event label').fill('Start near');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await load('cluster-sequence');
  await mode(true);
  const stable = await axis.innerHTML();
  await button('Play').click();
  await page.waitForFunction(
    () => Number(document.querySelector('[aria-label="Frame"]').getAttribute('aria-valuenow')) > 3,
  );
  await mode(false);
  assert(await button('Pause').isVisible(), 'changing presentation preserves playback');
  await mode(true);
  assert.equal(
    await axis.innerHTML(),
    stable,
    'playing does not change grouping or marker positions',
  );
  await button('Pause').click();
  await mode(false);
  await load('cluster-ui');
  await page.setViewportSize(viewport);
  await writeFile('.local/event-hybrid-layout-report.json', JSON.stringify(comparisons, null, 2));
  console.log(
    `Hybrid event markers passed: strict context lanes, diamonds, local collisions, both modes at four viewports, draft/selection/crop/playback and session preference.\n${JSON.stringify(comparisons)}`,
  );
}

export async function verifyEventClusters(page) {
  await verifyHybridEventMarkers(page);
  const viewport = page.viewportSize();
  const reports = [];
  const button = (name) => page.getByRole('button', { name, exact: true });
  const input = (name) => page.getByLabel(name, { exact: true });
  const editor = page.locator('.event-editor');
  const popup = page.locator('.event-cluster-popup');
  const markers = page.locator('.event-markers button');
  const selection = input('Select event');
  const focused = (el) => el.evaluate((node) => node === document.activeElement);
  const closeEditor = async () =>
    editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  const load = async (name = 'cluster-ui') => {
    await input('Open motion file').setInputFiles(resolve(`.local/${name}.h5`));
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    await page.waitForFunction(() => document.querySelector('.event-markers .event-cluster'));
    assert.equal(await popup.count(), 0, 'loading closes stale cluster lists');
  };
  const geometry = async () => {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector('.workspace').scrollTop = 0;
    });
    return page.locator('.timeline').evaluate((panel) => {
      const origin = panel.getBoundingClientRect();
      return [
        origin.height,
        ...[
          ...panel.querySelectorAll(
            '.transport, .time-labels, .timeline-slider, .speed-label, .playback-settings, .crop-actions, .event-toolbar',
          ),
        ].flatMap((el) => {
          const r = el.getBoundingClientRect();
          return [r.x - origin.x, r.y - origin.y, r.width, r.height];
        }),
      ];
    });
  };
  const popupFits = async () => {
    const result = await popup.evaluate((el) => {
      const p = el.getBoundingClientRect();
      const visible = [...el.querySelectorAll('[data-event-index]')]
        .filter((row) => row === document.activeElement)
        .map((row) => {
          const r = row.getBoundingClientRect();
          return r.top >= p.top && r.bottom <= p.bottom;
        });
      return {
        x: p.x,
        y: p.y,
        right: p.right,
        bottom: p.bottom,
        width: p.width,
        height: p.height,
        visible,
        viewport: [innerWidth, innerHeight],
      };
    });
    assert(
      result.x >= 7 && result.right <= result.viewport[0] - 7,
      'popup stays horizontally in viewport',
    );
    assert(
      result.y >= 7 && result.bottom <= result.viewport[1] - 7,
      'popup stays vertically in viewport',
    );
    assert(result.visible.every(Boolean), 'focused event row is visible');
    reports.push(result);
  };
  const markerLayout = async () => {
    const result = await page.locator('.event-markers').evaluate((axis) => {
      const rail = document.querySelector('.timeline-slider').getBoundingClientRect(),
        strip = axis.closest('.event-scroll').getBoundingClientRect();
      const groups = [...axis.children].map((el) => {
        const r = el.getBoundingClientRect();
        const pin = el.querySelector('.event-pin')?.getBoundingClientRect();
        return {
          left: pin?.left ?? r.left,
          right: pin?.right ?? r.right,
          top: r.top,
          bottom: r.bottom,
          count: Number(el.dataset.eventCount),
          index: el.dataset.eventIndex,
          xError: pin
            ? Math.abs(
                pin.left +
                  pin.width / 2 -
                  rail.left -
                  (rail.width * parseFloat(el.style.left)) / 100,
              )
            : 0,
        };
      });
      return {
        groups,
        strip: { left: strip.left, right: strip.right, top: strip.top, bottom: strip.bottom },
        axisHeight: axis.getBoundingClientRect().height,
        width: rail.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(result.axisHeight, 24, 'one lane fits the unchanged 24px marker area');
    assert(!result.overflow, 'no horizontal page overflow');
    for (let i = 0; i < result.groups.length; i++) {
      const group = result.groups[i];
      assert(
        group.left >= result.strip.left - 1 && group.right <= result.strip.right + 1,
        'edge badge is fully visible',
      );
      assert(
        group.top >= result.strip.top && group.bottom <= result.strip.bottom,
        'marker fits the original strip',
      );
      assert(group.xError < 0.1, 'individual triangle preserves its exact timeline coordinate');
      if (i)
        assert(
          group.left - result.groups[i - 1].right >= 0.9,
          'no collisions between rendered markers or badges',
        );
    }
    assert.equal(
      result.groups.reduce((n, group) => n + group.count, 0),
      11,
      'every source event is represented',
    );
    return result;
  };
  if (await button('Show right sidebar').isVisible()) await button('Show right sidebar').click();
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  await input('Compact event markers').check();
  await load();
  await button('Data Visualizer').click();
  const originalBytes = await readFile('.local/cluster-ui.h5');
  for (const width of [1600, 1280, 1024, 800, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await load();
    const before = await geometry();
    const layout = await markerLayout();
    const beforeFrame = await page
      .getByRole('slider', { name: 'Frame', exact: true })
      .getAttribute('aria-valuenow');
    const seen = [];
    for (let i = 0; i < (await markers.count()); i++) {
      const marker = markers.nth(i);
      const count = Number(await marker.getAttribute('data-event-count'));
      if (count === 1) {
        seen.push(Number(await marker.getAttribute('data-event-index')));
        continue;
      }
      await marker.focus();
      await marker.press('Enter');
      assert.equal(await marker.getAttribute('aria-expanded'), 'true');
      assert.equal(await editor.count(), 0, 'opening a cluster does not select or edit an event');
      assert.equal(
        await page
          .getByRole('slider', { name: 'Frame', exact: true })
          .getAttribute('aria-valuenow'),
        beforeFrame,
        'opening a cluster does not seek',
      );
      assert(await button('Undo').isDisabled(), 'opening a cluster does not modify data');
      const indices = await popup
        .locator('[data-event-index]')
        .evaluateAll((rows) => rows.map((row) => Number(row.dataset.eventIndex)));
      assert.equal(indices.length, count);
      seen.push(...indices);
      await popupFits();
      assert.deepEqual(
        await geometry(),
        before,
        'popup leaves Timeline height and controls unchanged',
      );
      await page.keyboard.press('Escape');
      assert.equal(await popup.count(), 0);
      assert(await focused(marker), 'Escape restores cluster focus');
    }
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      clusterEvents.map((_, i) => i),
      'no missing or duplicate events in individual markers and lists',
    );
    assert.equal(
      layout.groups.filter((group) => group.count === 1 && ['7', '8'].includes(group.index)).length,
      layout.width * 0.03 >= 11 ? 2 : 0,
      'grouping uses track pixels, not viewport or a time threshold',
    );
    await page.screenshot({ path: `.local/event-clusters-${width}.png` });
  }

  await page.setViewportSize({ width: 1600, height: 1000 });
  await load();
  const startCluster = page.locator('.event-cluster').first();
  const endCluster = page.locator('.event-cluster').last();
  await startCluster.focus();
  await startCluster.press('Enter');
  await endCluster.focus();
  await endCluster.press('Enter');
  assert(
    await focused(popup.locator('[data-event-index="9"]')),
    'switching clusters resets keyboard focus to the new list',
  );
  const endBounds = await endCluster.boundingBox(),
    switchedBounds = await popup.boundingBox();
  assert(
    Math.abs(switchedBounds.x + switchedBounds.width / 2 - endBounds.x - endBounds.width / 2) <= 1,
    'switching clusters reanchors the popup',
  );
  await popupFits();
  await page.keyboard.press('Escape');
  assert(await focused(endCluster), 'direct switching restores focus to the new cluster');
  const shared = page.locator('.event-cluster').filter({ hasText: /^3$/ }).nth(1);
  await shared.click();
  await popupFits();
  const colors = await popup
    .locator('.event-cluster-color')
    .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).backgroundColor));
  assert.deepEqual(colors, ['rgb(255, 107, 107)', 'rgb(101, 220, 140)', 'rgb(255, 205, 135)']);
  await page.screenshot({ path: '.local/event-clusters-popup.png' });
  await page.mouse.click(20, 200);
  assert.equal(await popup.count(), 0, 'outside click dismisses the list');
  await shared.focus();
  await shared.press('Space');
  const first = popup.locator('[data-event-index="4"]');
  assert(await focused(first));
  await page.keyboard.press('ArrowDown');
  const second = popup.locator('[data-event-index="5"]');
  assert(await focused(second));
  await second.press('Enter');
  assert.equal(await popup.count(), 0);
  assert.equal(
    await selection.inputValue(),
    '5',
    'same label and timestamp still select the correct source event',
  );
  for (const [name, value] of [
    ['Event label', 'Shared label'],
    ['Context', 'Right'],
    ['Description', 'Description 5'],
    ['Subject', 'Subject 5'],
  ])
    assert.equal(await input(name).inputValue(), value);
  const rawTime = 1.2 + clusterEvents[5][0] - 1.2;
  assert.equal(await input('Time (s)').getAttribute('title'), `Exact event time: ${rawTime} s`);
  assert.equal(Number(await input('Source frame').inputValue()), 120 + rawTime * 100);
  assert.equal(await shared.getAttribute('aria-pressed'), 'true');
  assert(
    !(await focused(input('Event label'))),
    'cluster selection follows existing editor focus behavior',
  );
  await input('Event label').fill('Unsaved clustered draft');
  await shared.click();
  await popup.locator('[data-event-index="4"]').click();
  assert.equal(await input('Event label').inputValue(), 'Unsaved clustered draft');
  assert.equal(
    await selection.inputValue(),
    '5',
    'cluster selection preserves unsaved-editor protection',
  );
  await button('Keep editing').click();
  await input('Event label').fill('Shared label');
  await button('Delete event').click();
  await shared.click();
  await popup.locator('[data-event-index="4"]').click();
  assert.equal(
    await button('Confirm delete event').count(),
    0,
    'selecting another clustered event cancels pending deletion',
  );
  assert.equal(await selection.inputValue(), '4');
  assert.equal(await selection.locator('option').count(), 12);
  await input('Event label').fill('Cluster edited event');
  await button('Save event').click();
  await button('Undo').click();
  assert(
    !(await selection.locator('option').allTextContents()).some((label) =>
      label.startsWith('Cluster edited event'),
    ),
  );
  await button('Redo').click();
  await openTimelineEvent(page, 'Cluster edited event');
  await button('Delete event').click();
  await button('Keep event').click();
  assert.equal(await selection.locator('option').count(), 12);
  await button('Delete event').click();
  await button('Confirm delete event').click();
  assert.equal(await selection.locator('option').count(), 11);
  await button('Undo').click();
  assert.equal(await selection.locator('option').count(), 12);
  await button('Redo').click();
  assert.equal(await selection.locator('option').count(), 11);

  await load();
  await selection.selectOption('7');
  assert.equal(
    await page.locator('.event-markers [data-event-index="7"]').getAttribute('aria-pressed'),
    'true',
  );
  const originalTime = await input('Time (s)').getAttribute('title');
  await page.setViewportSize({ width: 800, height: 1000 });
  const merged = page.getByRole('button', {
    name: '2 events from 0.650 to 0.680 seconds',
    exact: true,
  });
  await merged.waitFor();
  assert.equal(await merged.getAttribute('aria-pressed'), 'true', 'selection survives merging');
  await button('Hide right sidebar').click();
  await page.locator('.event-markers [data-event-index="7"]').waitFor();
  assert.equal(
    await page.locator('.event-markers [data-event-index="7"]').getAttribute('aria-pressed'),
    'true',
    'Inspector collapse splits clusters without a viewport resize',
  );
  await button('Show right sidebar').click();
  await merged.waitFor();
  assert.equal(await merged.getAttribute('aria-pressed'), 'true');
  await merged.click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(() => !document.querySelector('.event-cluster-popup'));
  assert.equal(
    await page.locator('.event-markers [data-event-index="7"]').getAttribute('aria-pressed'),
    'true',
    'selection survives splitting',
  );
  assert.equal(await input('Time (s)').getAttribute('title'), originalTime);
  await closeEditor();

  await load();
  const full = await markerLayout();
  await page.getByRole('slider', { name: 'Crop start', exact: true }).press('ArrowRight');
  await page.getByRole('slider', { name: 'Crop end', exact: true }).press('ArrowLeft');
  assert.equal(
    (await markerLayout()).groups.length,
    full.groups.length,
    'crop preview preserves existing visibility rules',
  );
  await button('Apply crop').click();
  assert.equal(await selection.locator('option').count(), 7, 'only retained crop events remain');
  assert.equal(
    await markers.evaluateAll((rows) =>
      rows.reduce((n, row) => n + Number(row.dataset.eventCount), 0),
    ),
    6,
  );
  await openTimelineEvent(page, 'Isolated');
  assert.equal(
    Number(await input('Source frame').inputValue()),
    140,
    'cropping retains the nonzero source origin',
  );
  await closeEditor();
  await button('Restore original').click();
  await markerLayout();
  assert.deepEqual(
    await readFile('.local/cluster-ui.h5'),
    originalBytes,
    'cluster interactions never modify imported bytes',
  );

  await button('Jump to beginning').click();
  await button('Play').click();
  await page.locator('.event-cluster').first().click();
  const beforePlayback = Number(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
  );
  const markerHTML = await page.locator('.event-markers').innerHTML();
  await page.waitForFunction(
    (before) =>
      Number(document.querySelector('[aria-label="Frame"]').getAttribute('aria-valuenow')) > before,
    beforePlayback,
  );
  assert.equal(
    await editor.count(),
    0,
    'cluster opening does not interrupt playback to select an event',
  );
  assert.equal(
    await page.locator('.event-markers').innerHTML(),
    markerHTML,
    'playback does not update marker groups',
  );
  await page.keyboard.press('Escape');
  await button('Pause').click();

  for (const width of [1600, 600, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await load('cluster-large');
    assert.equal(await markers.count(), 1);
    assert.equal(await markers.first().innerText(), '250');
    await markers.first().click();
    assert.equal(await popup.locator('[data-event-index]').count(), 250);
    assert(
      await popup.evaluate((el) => el.scrollHeight > el.clientHeight),
      'large lists are bounded and scroll',
    );
    await page.keyboard.press('End');
    assert(await focused(popup.locator('[data-event-index="249"]')));
    await popupFits();
    await page.keyboard.press('Enter');
    assert.equal(await selection.inputValue(), '249');
    assert.equal(
      await input('Subject').inputValue(),
      'Subject 249',
      'identical labels resolve by event identity',
    );
    await closeEditor();
    await markers.first().click();
    await load();
  }
  await page.setViewportSize(viewport);
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  await input('Compact event markers').uncheck();
  await writeFile('.local/event-cluster-layout-report.json', JSON.stringify(reports, null, 2));
  console.log(
    `Event clusters passed: pixel grouping, exact positions/colors, ${reports.length} bounded popup layouts, identity/metadata, keyboard/focus, resize, crop and history.`,
  );
}

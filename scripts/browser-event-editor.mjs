import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import * as h5 from 'h5wasm/node';
import { chooseExportFormat } from './browser-cross-format.mjs';

/** Rendered form geometry and real editor workflows, against the nonzero-origin fixture. */
export async function verifyEventEditor(page) {
  const originalViewport = page.viewportSize();
  const reports = [];
  const editor = page.locator('.event-editor');
  const button = (name) => page.getByRole('button', { name, exact: true });
  const input = (name) => page.getByLabel(name, { exact: true });
  const selection = input('Select event');
  const options = () => selection.locator('option').allTextContents();
  const fields = ['Event label', 'Time (s)', 'Source frame', 'Context', 'Description', 'Subject'];
  const values = () => Promise.all(fields.map((name) => input(name).inputValue()));
  const focused = (locator) => locator.evaluate((el) => el === document.activeElement);
  const load = async (file = '.local/timeline-ui.h5') => {
    await input('Open motion file').setInputFiles(resolve(file));
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'));
    await button('Add Event').waitFor();
    assert.equal(await editor.count(), 0);
  };
  const settle = async () => {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector('.workspace').scrollTop = 0;
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  };
  const timeline = async () => {
    await settle();
    return page.locator('.timeline').evaluate((el) =>
      [
        ...el.querySelectorAll(
          '.transport, .time-labels, .timeline-slider, .timeline-rail, .event-scroll, .speed-label, .playback-settings .inline-check, .crop-actions, .event-toolbar, .event-pin',
        ),
      ].map((control) => {
        const r = control.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    );
  };
  const layout = async (state) => {
    await settle();
    const result = await editor.evaluate((form, state) => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        const outer = form.getBoundingClientRect();
        return { x: r.x - outer.x, y: r.y - outer.y, w: r.width, h: r.height };
      };
      const inputs = [...form.querySelectorAll('input')].map(rect);
      const buttons = [...form.querySelectorAll('button')].map(rect);
      const labels = [...form.querySelectorAll('label')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return rect(range);
      });
      const canvas = document.createElement('canvas').getContext('2d');
      const numericFits = [...form.querySelectorAll('input[type="number"]')].every((el) => {
        const style = getComputedStyle(el);
        canvas.font = style.font;
        return (
          canvas.measureText(el.value).width <=
          el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 16
        );
      });
      return {
        state,
        viewport: innerWidth,
        panel: form.closest('.timeline-section').clientWidth,
        width: form.clientWidth,
        height: form.getBoundingClientRect().height,
        inputs,
        buttons,
        labels,
        fieldsFilled: [...form.querySelectorAll('input')].every(
          (el) =>
            Math.abs(
              el.getBoundingClientRect().width - el.parentElement.getBoundingClientRect().width,
            ) < 1,
        ),
        numericFits,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    }, state);
    assert.equal(result.inputs.length, 6, state);
    assert(!result.pageOverflow, `${state}: horizontal page overflow`);
    assert(result.fieldsFilled, `${state}: inputs fill their allocated columns`);
    assert(result.numericFits, `${state}: precise numeric values remain readable`);
    const controls = [...result.inputs, ...result.buttons];
    for (const r of [...controls, ...result.labels]) {
      assert(r.x >= 11 && r.x + r.w <= result.width - 11, `${state}: field escapes form`);
      assert(r.y >= 0 && r.y + r.h <= result.height, `${state}: clipped field`);
    }
    assert(
      controls.every((r) => r.h === 28),
      `${state}: consistent 28px controls`,
    );
    assert(
      result.labels.every((r) => r.h < 16),
      `${state}: clipped/wrapped label`,
    );
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i],
          b = controls[j];
        assert(
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) <= 1 ||
            Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) <= 1,
          `${state}: overlapping controls`,
        );
      }
    const [label, time, frame, context, description, subject] = result.inputs;
    if (result.panel > 360) assert.equal(time.y, frame.y, `${state}: timing stays together`);
    else assert(time.y < frame.y && frame.y < context.y, `${state}: narrow timing order`);
    if (result.panel > 920) {
      assert(
        result.inputs.every((r) => r.y === label.y),
        `${state}: six-field desktop row`,
      );
      assert(result.height <= 100, `${state}: compact desktop editor`);
    } else if (result.panel > 500) {
      assert.equal(label.y, time.y, `${state}: identity row`);
      assert.equal(context.y, description.y, `${state}: metadata row`);
      assert.equal(subject.y, description.y, `${state}: metadata row`);
      assert(context.y > label.y, `${state}: deliberate two-row grouping`);
    } else {
      assert(label.y < time.y && context.y > time.y, `${state}: narrow identity grouping`);
      assert(context.y < description.y && description.y < subject.y, `${state}: metadata order`);
    }
    if (result.panel > 500) {
      assert(label.w > time.w && label.w > frame.w, `${state}: readable identity width`);
      assert(
        description.w > context.w && description.w > subject.w,
        `${state}: flexible description`,
      );
    }
    reports.push(result);
    return result;
  };

  if (await button('Show right sidebar').isVisible()) await button('Show right sidebar').click();
  await load();
  await button('Data Visualizer').click();
  for (const width of [1600, 1280, 1024, 800, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await load();
    const baseline = await timeline();
    await button('Add Event').click();
    assert(await focused(input('Event label')), 'new event focuses its label');
    assert.deepEqual(await timeline(), baseline, `${width}: opening editor anchors Timeline`);
    const create = await layout('create');
    assert.equal(await button('Delete event').count(), 0);
    await page.screenshot({ path: `.local/event-editor-${width}-create.png` });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert(await focused(button('Add Event')), 'cancel restores the invoking control');
    assert.deepEqual(await timeline(), baseline, `${width}: closed Timeline remains compact`);
    await selection.selectOption('0');
    const edit = await layout('edit');
    assert.deepEqual(edit.inputs, create.inputs, `${width}: same create/edit field geometry`);
    assert.equal(edit.height, create.height);
    await page.screenshot({ path: `.local/event-editor-${width}-edit.png` });
    await button('Delete event').click();
    const pending = await layout('confirm delete');
    assert.deepEqual(pending.inputs, edit.inputs);
    assert.equal(pending.height, edit.height, `${width}: confirmation adds no row`);
    assert(await focused(button('Keep event')));
    await button('Keep event').press('Enter');
    assert.equal((await options()).length, 11, 'keeping event changes no data');
    await input('Event label').fill('Unsaved label');
    await selection.selectOption('9');
    assert.equal(await input('Event label').inputValue(), 'Unsaved label');
    assert.equal(await selection.inputValue(), '0', 'unsaved draft remains selected');
    assert(await focused(button('Keep editing')));
    const switchLayout = await layout('unsaved switch');
    assert.equal(switchLayout.height, edit.height);
    await button('Keep editing').press('Enter');
    assert.equal(await input('Event label').inputValue(), 'Unsaved label');
    await button('Add Event').click();
    await button('Discard changes').click();
    assert.equal(await input('Event label').inputValue(), '');
    assert.equal(await button('Delete event').count(), 0);
    assert.equal((await options()).length, 11);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await timeline(), baseline, `${width}: switching modes preserves controls`);
  }

  // Container queries react to the Inspector, not just the viewport.
  await page.setViewportSize({ width: 1024, height: 1000 });
  await load();
  await button('Hide right sidebar').click();
  await selection.selectOption('0');
  const expanded = await layout('Inspector collapsed');
  assert(expanded.panel > 920);
  await button('Show right sidebar').click();
  const reduced = await layout('Inspector expanded');
  assert(reduced.panel <= 920 && reduced.panel > 500);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.setViewportSize({ width: 1280, height: 1000 });
  await load();
  const originalOptions = await options();
  await button('Add Event').click();
  await input('Event label').fill('Unsaved new event');
  await input('Description').fill('Unsaved metadata');
  const draftValues = await values();
  await selection.selectOption('0');
  assert.deepEqual(await values(), draftValues, 'switching away from create retains the draft');
  await button('Keep editing').press('Enter');
  assert.deepEqual(await values(), draftValues);
  await selection.selectOption('0');
  await button('Discard changes').click();
  assert.equal(await input('Event label').inputValue(), 'A');
  assert.equal(await input('Description').inputValue(), 'Description');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await options(), originalOptions);
  await button('Jump to beginning').click();
  await button('Next frame').click();
  await button('Add Event').focus();
  await button('Add Event').press('Enter');
  assert.deepEqual(
    await values(),
    ['', '0.01', '121', '', '', ''],
    'initialization uses current frame and source origin',
  );
  // Native required validation and existing scientific bounds retain the draft.
  await input('Description').fill('Retained after errors');
  await button('Save event').click();
  assert.equal(await input('Event label').getAttribute('aria-invalid'), 'true');
  assert.equal(await input('Description').inputValue(), 'Retained after errors');
  await input('Event label').fill(' ');
  await button('Save event').click();
  assert.equal(await page.locator('#event-label-error').innerText(), 'Enter an event label.');
  await input('Event label').fill('Precise event');
  await input('Time (s)').fill('');
  await button('Save event').click();
  assert.equal(await input('Time (s)').getAttribute('aria-invalid'), 'true');
  for (const time of ['-0.01', '1']) {
    await input('Time (s)').fill(time);
    await button('Save event').click();
    assert.match(await page.locator('#event-time-error').innerText(), /within the recording/);
    assert.equal(await input('Time (s)').inputValue(), time);
    assert.deepEqual(await options(), originalOptions);
  }
  await input('Source frame').fill('145.125');
  assert.equal(await input('Time (s)').inputValue(), '0.25125');
  await input('Time (s)').fill('0.25123456789');
  assert.equal(Number(await input('Source frame').inputValue()), 120 + 0.25123456789 * 100);
  await input('Context').fill('Right');
  await input('Description').fill('Scientific metadata');
  await input('Subject').fill('Synthetic subject');
  const savedValues = await values();
  const playbackFrame = Number(
    await page.getByRole('slider', { name: 'Frame', exact: true }).getAttribute('aria-valuenow'),
  );
  await button('Play').click();
  await input('Subject').focus();
  await page.waitForFunction(
    (before) =>
      Number(document.querySelector('[aria-label="Frame"]').getAttribute('aria-valuenow')) > before,
    playbackFrame,
  );
  assert(await focused(input('Subject')), 'playback does not steal input focus');
  assert.deepEqual(await values(), savedValues, 'playback does not reinitialize the draft');
  await button('Pause').click();
  // DOM order remains the visual and keyboard order; Enter submits without global shortcuts.
  await input('Event label').focus();
  for (const name of fields.slice(1)) {
    await page.keyboard.press('Tab');
    assert(await focused(input(name)), `tab reaches ${name}`);
  }
  for (const name of ['Save event', 'Cancel']) {
    await page.keyboard.press('Tab');
    assert(await focused(editor.getByRole('button', { name, exact: true })));
  }
  await input('Subject').press('Enter');
  assert.equal(await editor.count(), 0);
  assert(await focused(button('Add Event')));
  const createdOptions = await options();
  assert.equal(createdOptions.length, originalOptions.length + 1);
  await selection.focus();
  await selection.selectOption('1');
  assert.deepEqual(
    await values(),
    savedValues,
    'save preserves all fields and timestamp precision',
  );
  await input('Subject').focus();
  for (const name of ['Save event', 'Cancel', 'Delete event']) {
    await page.keyboard.press('Tab');
    assert(await focused(editor.getByRole('button', { name, exact: true })));
  }
  await input('Description').fill('é'.repeat(128));
  await button('Save event').click();
  assert.equal(await input('Description').getAttribute('aria-invalid'), 'true');
  assert.equal(await input('Description').inputValue(), 'é'.repeat(128));
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(await focused(selection));
  await selection.selectOption('1');
  assert.deepEqual(await values(), savedValues, 'cancel leaves the committed dataset intact');
  await input('Event label').fill('Edited precise event');
  await button('Save event').click();
  assert.equal((await options()).length, createdOptions.length, 'edit adds no record');
  const editedOptions = await options();
  await button('Undo').click();
  assert.deepEqual(await options(), createdOptions);
  await button('Redo').click();
  assert.deepEqual(await options(), editedOptions);
  await selection.selectOption('1');
  await button('Delete event').click();
  await button('Keep event').click();
  assert.deepEqual(await options(), editedOptions);
  await button('Delete event').click();
  await button('Confirm delete event').press('Enter');
  assert.deepEqual(await options(), originalOptions, 'only the selected event is deleted');
  await button('Undo').click();
  assert.deepEqual(await options(), editedOptions);
  await button('Redo').click();
  assert.deepEqual(await options(), originalOptions);

  // Editing must not touch scientific samples, source offsets or unrelated H5 metadata.
  const pendingExport = page.waitForEvent('download');
  await chooseExportFormat(page, 'H5');
  await (await pendingExport).saveAs(resolve('.local/event-editor-export.h5'));
  const original = new h5.File(resolve('.local/timeline-ui.h5'), 'r');
  const exported = new h5.File(resolve('.local/event-editor-export.h5'), 'r');
  try {
    for (const name of [
      'Trajectories/Labeled/Data',
      'Events/Time',
      'Events/Frame',
      'Events/Name',
      'Events/Description',
      'Events/Subject',
      'Events/Context',
    ])
      assert.deepEqual(exported.get(name).value, original.get(name).value, `${name} preserved`);
    assert.deepEqual(
      exported.get('Trajectories').attrs.StartFrame.value,
      original.get('Trajectories').attrs.StartFrame.value,
    );
  } finally {
    original.close();
    exported.close();
  }
  // C3D uses its existing one-based source-frame offset, unlike H5.
  const fixtures = JSON.parse(await readFile('tests/fixtures/c3d.json', 'utf8'));
  const c3dBytes = Buffer.from(fixtures.intelFloat, 'base64');
  await writeFile('.local/event-editor.c3d', c3dBytes);
  await load('.local/event-editor.c3d');
  const firstSource = c3dBytes.readUInt16LE(6);
  await button('Add Event').click();
  assert.equal(Number(await input('Source frame').inputValue()), firstSource);
  await input('Source frame').fill(String(firstSource + 1));
  assert.equal(await input('Time (s)').inputValue(), '0.01');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await load();
  await page.setViewportSize(originalViewport);
  await writeFile('.local/event-editor-layout-report.json', JSON.stringify(reports, null, 2));
  console.log(
    `Event Editor passed: ${reports.length} rendered layouts, create/edit/cancel/validation, focus/tab order, unsaved switching, precision/source offsets, deletion/history and sample integrity.`,
  );
}

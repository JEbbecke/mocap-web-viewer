import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrialOverview, trialOverview } from '../src/components/TrialOverview';
import { Inspector } from '../src/components/Inspector';
import { fileInfoSections } from '../src/components/fileInfoSections';
import { parseC3D } from '../src/importers/c3d/importer';
import { h5RecordingInfo } from '../src/importers/h5/metadata';
import { c3dRecordingInfo } from '../src/importers/c3d/metadata';
import { readParameters } from '../src/importers/c3d/parameters';
import { physicalFixture } from './helpers/c3d';
import { cropMotionData } from '../src/motion/crop';
import { selectPlot, setData, useSession } from '../src/state/session';

const fixture = () => parseC3D(physicalFixture(), 'walking_trial_03.c3d');
const html = (data: ReturnType<typeof fixture>) =>
  renderToStaticMarkup(createElement(TrialOverview, { data }));

it('prioritizes normalized current-H5 condition, subject and group, with file traceability', () => {
  const data = fixture();
  data.source.format = 'H5';
  const attrs = Object.fromEntries(
    Object.entries({
      SubjectID: 'SYN-012',
      SubjectGroup: 'Synthetic group',
      Condition: 'Running 3.0 m/s',
    }).map(([key, value]) => [key, { value }]),
  );
  data.source.info = h5RecordingInfo({
    get: (path) =>
      path === 'MetaData/Project'
        ? { attrs }
        : path === 'MetaData/FileInfo'
          ? { attrs: { FileCreationLocal: { value: '2026-10-09T10:32:00' } } }
          : undefined,
  });
  const overview = trialOverview(data);
  expect(overview.title).toBe('Running 3.0 m/s');
  expect(overview.rows).toEqual([
    { label: 'Subject', value: 'SYN-012' },
    { label: 'Group', value: 'Synthetic group' },
    { label: 'Created', value: '2026-10-09 10:32:00' },
  ]);
  const view = html(data);
  expect(view).toContain('TRIAL');
  expect(view).toContain('Running 3.0 m/s');
  expect(view).toContain('walking_trial_03.c3d');
  expect(view).not.toContain('Recorded');
  const infoRows = fileInfoSections(data).flatMap((s) => s.rows);
  expect(infoRows.find((r) => r.label === 'Subject ID')!.values).toEqual(['SYN-012']);
  expect(infoRows.find((r) => r.label === 'Date')!.values).toEqual(['2026-10-09 10:32:00']);
});

it('omits missing/placeholder fields and dates without losing partial identity', () => {
  const data = fixture();
  data.source.info = {
    subject: {
      id: { values: ['SYN-012'] },
      group: { values: ['Unknown', 'N/A', '-'] },
      condition: { values: ['Walking'] },
    },
  };
  expect(trialOverview(data).rows).toEqual([{ label: 'Subject', value: 'SYN-012' }]);
  expect(html(data)).not.toContain('<dt>Group</dt>');
  expect(html(data)).not.toContain('<dt>Created</dt>');
  expect(
    fileInfoSections(data)
      .flatMap((s) => s.rows)
      .some((r) => r.label === 'Subject group'),
  ).toBe(false);
});

it('provides minimal C3D filename/trajectory-clock fallback and no filesystem date', () => {
  const data = fixture();
  const overview = trialOverview(data);
  expect(overview.title).toBe('walking_trial_03.c3d');
  expect(overview.rows).toEqual([]);
  expect(overview.summary).toBe(
    `C3D · ${data.timeline.duration.toFixed(3)} s · ${data.timeline.frameCount} frames · ${data.timeline.rate} Hz`,
  );
  expect(overview.summary).not.toContain('2000 Hz');
  const cropped = cropMotionData(data, 1, 2);
  expect(trialOverview(cropped).summary).toContain('0.000 s · 1 frame');
  expect(html(data)).not.toContain('<dl>');
});

it('uses actual C3D subject fields without a format-specific display branch', () => {
  const data = fixture();
  const parameters = readParameters(new DataView(physicalFixture())).params;
  parameters.set('SUBJECT:NAME', { dimensions: [], values: ['Synthetic subject'] });
  parameters.set('SUBJECT:CONDITION', { dimensions: [], values: ['Walking'] });
  data.source.info = c3dRecordingInfo(parameters);
  expect(trialOverview(data).title).toBe('Walking');
  expect(trialOverview(data).rows).toEqual([{ label: 'Subject', value: 'Synthetic subject' }]);
});

it('displays safe basenames and nonempty fallback titles, with full-text tooltips', () => {
  const data = fixture();
  data.name = String.raw`C:\Users\Private Person\recordings\long_trial_name.c3d`;
  expect(trialOverview(data).title).toBe('long_trial_name.c3d');
  expect(html(data)).not.toContain('Private Person');
  expect(html(data)).toContain('title="long_trial_name.c3d"');
  expect(fileInfoSections(data)[0].rows[0].values).toEqual(['long_trial_name.c3d']);
  expect(trialOverview(data, '/tmp/imports/original.h5').filename).toBe('original.h5');
  data.name = '';
  expect(trialOverview(data).title).toBe('C3D');
});

it('replaces the marker card without changing selection, scientific data or history', () => {
  const data = fixture();
  setData(data);
  const before = useSession.getState();
  useSession.setState({ selected: 0 });
  selectPlot('marker');
  const view = renderToStaticMarkup(
    createElement(Inspector, { data, collapsed: false, onToggle: () => {} }),
  );
  expect(view).toContain('aria-label="Trial overview"');
  expect(view).not.toContain('SELECTED MARKER');
  expect(view).not.toContain('coordinate-values');
  expect(view).toContain('marker-row selected');
  expect(view).toContain(`aria-label="Show ${data.markers.labels[0]}"`);
  const after = useSession.getState();
  expect(after.selected).toBe(0);
  expect(after.plot).toBe('marker');
  expect(after.data).toBe(data);
  expect(after.data!.markers.valid).toBe(data.markers.valid);
  expect(after.data!.markers.residuals).toBe(data.markers.residuals);
  expect(after.dirty).toBe(before.dirty);
  expect(after.history).toBe(before.history);
});

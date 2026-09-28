import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataBrowser } from '../src/components/DataBrowser';
import { Inspector } from '../src/components/Inspector';
import { dataSections, filterDataSections } from '../src/components/dataSections';
import { h5RecordingInfo } from '../src/importers/h5/metadata';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { cropMotionData } from '../src/motion/crop';
import type { H5Node } from '../src/importers/h5/schema';

function modelInfo(labels: string[] = ['time', 'knee_angle_r', 'hip_flexion_r']) {
  const attrs = {
    Labels: { value: labels },
    Units: { value: ['s', 'deg', 'Unknown'] },
    SamplingFrequency: { value: 120 },
  };
  const data: H5Node = {
    shape: [3, 8],
    get value(): never {
      throw Error('Do not read model samples');
    },
  };
  return h5RecordingInfo({
    get: (path) =>
      (
        ({
          IKResults: { attrs },
          'IKResults/Data': data,
          IDResults: { attrs: { Labels: { value: ['time', 'knee_moment_r', 'hip_moment_r'] } } },
          'IDResults/Data': data,
        }) as Record<string, H5Node>
      )[path],
  });
}
function populated() {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  data.markers.labels[0] = 'Knee';
  data.analogs[0].name = 'knee force';
  const signal = data.analogs[0].signal;
  data.signals = [
    { name: 'knee EMG', group: 'EMG', unit: 'V', signal },
    { name: 'Body', group: 'RigidBodies', unit: 'mm', signal: { ...signal, components: 3 } },
  ];
  data.rigidBodies = [{ name: 'Body', markers: [], position: data.signals[1].signal }];
  data.source.info = modelInfo();
  return data;
}

it('lists all eight categories with authoritative counts and existing plot/event references', () => {
  const data = populated(),
    sections = dataSections(data);
  expect(sections.map((s) => s.name)).toEqual([
    'Markers',
    'Analog channels',
    'Force platforms',
    'Events',
    'Rigid bodies',
    'EMG channels',
    'IK results',
    'ID results',
  ]);
  const group = (name: string) => sections.find((s) => s.name === name)!;
  expect(group('Markers').entries.length).toBe(data.markers.labels.length);
  expect(group('Markers').entries[0].marker).toBe(0);
  expect(group('Analog channels').entries.length).toBe(data.analogs.length);
  expect(group('Analog channels').entries[0]).toMatchObject({
    name: 'knee force',
    plot: 'analog:0',
  });
  expect(group('Force platforms').entries[0].plot).toBe('plate:0:force');
  expect(group('Events').entries[0].time).toBe(data.events[0].time);
  expect(group('Rigid bodies').entries[0].plot).toBe('signal:1');
  expect(group('EMG channels').entries[0]).toMatchObject({ name: 'knee EMG', plot: 'signal:0' });
  expect(group('IK results').entries.map((e) => e.name)).toEqual(['knee_angle_r', 'hip_flexion_r']);
  expect(group('ID results').entries.map((e) => e.name)).toEqual(['knee_moment_r', 'hip_moment_r']);
  expect(group('IK results').entries[0].plot).toBeUndefined();
  expect(group('IK results').note).toContain('not plotted');
  expect(group('ID results').entries[0].detail).toBe('');
  expect(group('IK results').entries[0].detail).toBe('deg · 120 Hz');
  // Browsing retains source arrays and does not change force values or events.
  expect(data.analogs[0].signal).toBe(data.signals![0].signal);
});

it('searches names across categories without dropping matching children and retains total counts', () => {
  const sections = dataSections(populated());
  const matches = filterDataSections(sections, '  KNEE ');
  expect(matches.map((s) => s.name)).toEqual([
    'Markers',
    'Analog channels',
    'EMG channels',
    'IK results',
    'ID results',
  ]);
  expect(matches.every((s) => s.entries.length === 1)).toBe(true);
  expect(matches.find((s) => s.name === 'IK results')?.total).toBe(2);
  expect(filterDataSections(sections, 'absent')).toEqual([]);
  expect(filterDataSections(sections, '').length).toBe(8);
});

it('omits unavailable categories and displays a concise empty state', () => {
  const data = populated();
  data.analogs = [];
  data.forcePlatforms = [];
  data.events = [];
  data.rigidBodies = [];
  data.signals = [];
  data.source.info = {};
  expect(dataSections(data).map((s) => s.name)).toEqual(['Markers']);
  data.markers.labels = [];
  expect(dataSections(data)).toEqual([]);
  const html = renderToStaticMarkup(createElement(DataBrowser, { data }));
  expect(html).toContain('No supported data available.');
  expect(html).not.toContain('<summary>');
});

it('renders Data, Display and File Info tabs with existing marker selection and visibility controls', () => {
  const data = populated();
  const html = renderToStaticMarkup(
    createElement(Inspector, { data, collapsed: false, onToggle: () => {} }),
  );
  expect(html).toMatch(/role="tab"[^>]*>Data<\/button>/);
  expect(html).toMatch(/role="tab"[^>]*>Display<\/button>/);
  expect(html).toMatch(/role="tab"[^>]*>File Info<\/button>/);
  expect(html).not.toMatch(/role="tab"[^>]*>Markers<\/button>/);
  expect(html).toContain('aria-label="Show Knee"');
  expect(html).toContain('type="checkbox" checked=""');
  expect(html).toContain('Show all');
  expect(html).toContain('TRAJECTORIES');
  expect(html).toContain('aria-label="Search data"');
  expect(html).toContain('data-section" open=""');
});

it('reads model names and explicit units without loading samples or shifting missing labels', () => {
  const info = modelInfo(['time', '', 'knee_angle_r']);
  expect(info.modelResults?.ik?.variables).toBe(2);
  expect(info.modelResults?.ik?.entries).toEqual([
    { name: 'Variable 2 (unlabelled)', unit: 'deg', rate: 120 },
    { name: 'knee_angle_r', unit: undefined, rate: 120 },
  ]);
  expect(info.modelResults?.id?.entries?.[0].unit).toBeUndefined();
  const mismatch = modelInfo(['time']).modelResults?.ik;
  expect(mismatch?.variables).toBe(3);
  expect(mismatch?.entries?.map((e) => e.name)).toEqual([
    'Variable 1 (unlabelled)',
    'Variable 2 (unlabelled)',
    'Variable 3 (unlabelled)',
  ]);
});

it('updates event entries after cropping and prefers parsed model signals when available', () => {
  const data = populated();
  const cut = cropMotionData(data, 1, 2);
  expect(dataSections(cut).find((s) => s.name === 'Events')?.entries.length ?? 0).toBe(
    cut.events.length,
  );
  data.signals!.push({
    name: 'parsed knee',
    group: 'IKResults',
    unit: 'deg',
    signal: data.analogs[0].signal,
  });
  const ik = dataSections(data).find((s) => s.name === 'IK results')!;
  expect(ik.entries).toHaveLength(1);
  expect(ik.entries[0].plot).toBe('signal:2');
  expect(ik.note).toBeUndefined();
});

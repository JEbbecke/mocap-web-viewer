import { beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import fixture from './fixtures/current-h5.json';
import { parseH5Tree } from '../src/importers/h5/schema';
import { h5RecordingInfo } from '../src/importers/h5/metadata';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import {
  copyRows,
  displayCell,
  exactCell,
  explorerDatasets,
  filterDatasets,
  rowWindow,
  sampleAt,
  seriesDataset,
} from '../src/explorer/datasets';
import { MODEL_PAGE_SIZE, readModelPage } from '../src/explorer/modelPage';
import { cropMotionData } from '../src/motion/crop';
import {
  setData,
  useSession,
  renameSessionMarker,
  editSessionEvent,
  undoEdit,
} from '../src/state/session';
import { renameDataCommand } from '../src/motion/dataLabels';
import type { MotionData, Series } from '../src/motion/types';

let motion: MotionData;
const path = resolve('.local/explorer-synthetic.h5');
beforeAll(async () => {
  await h5.ready;
  mkdirSync(resolve('.local'), { recursive: true });
  writeFileSync(path, Buffer.from(fixture.base64, 'base64'));
  const file = new h5.File(path, 'r');
  try {
    motion = parseH5Tree(file, 'synthetic.h5');
  } finally {
    file.close();
  }
});
const table = (data: MotionData, id: string) => explorerDatasets(data).find((d) => d.id === id)!;

it('browses available categories and searches names and category paths, never values', () => {
  const ds = explorerDatasets(motion);
  expect([...new Set(ds.map((d) => d.path[0]))]).toEqual([
    'Metadata',
    'Trajectories',
    'Analog',
    'Force Platforms',
    'Events',
    'Rigid Bodies',
    'EMG',
    'IK Results',
    'ID Results',
  ]);
  expect(filterDatasets(ds, 'quantity').map((d) => d.path[0])).toEqual([
    'IK Results',
    'ID Results',
  ]);
  expect(filterDatasets(ds, 'force platforms').every((d) => d.path[0] === 'Force Platforms')).toBe(
    true,
  );
  expect(filterDatasets(ds, '0.123456789')).toEqual([]);
  const empty = {
    ...motion,
    markers: { ...motion.markers, labels: [] },
    analogs: [],
    forcePlatforms: [],
    events: [],
    signals: [],
    rigidBodies: [],
    source: { ...motion.source, info: {} },
  };
  expect([...new Set(explorerDatasets(empty).map((d) => d.path[0]))]).toEqual(['Metadata']);
});
it('shows H5 marker coordinates, validity, residuals and distinct index/current/source frames', () => {
  const d = table(motion, 'marker:0');
  expect(d.count).toBe(8);
  expect(Array.from({ length: 8 }, (_, c) => d.cell(1, c))).toEqual([
    1,
    2,
    9,
    0.25,
    1.123456789,
    9.123456789,
    17.123456789,
    true,
  ]);
  expect(d.columns[8].name).toBe('Residual [mm]');
  expect(d.cell(1, 8)).toBeNaN();
  expect(d.cell(0, 9)).toBe(1);
  expect(d.cell(0, 10)).toBe(false);
  expect(table(motion, 'marker:1').cell(2, 7)).toBe(false);
  expect(table(motion, 'marker:1').cell(2, 8)).toBe(-1);
});
it('shows C3D source frames one-based and retains invalid sample numbers', () => {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d'),
    d = table(data, 'marker:0');
  expect([d.cell(0, 0), d.cell(0, 1), d.cell(0, 2), d.cell(0, 4)]).toEqual([0, 1, 37, 0]);
  expect(d.cell(123, 7)).toBe(false);
  expect(d.cell(123, 8)).toBe(-1);
  const file = table(data, 'metadata:File');
  expect(copyRows(file, 0, file.count)).toContain('Source first frame (C3D one-based)\t37');
  const cropped = table(cropMotionData(data, 100, 200), 'marker:0');
  expect(cropped.count).toBe(100);
  expect([cropped.cell(0, 0), cropped.cell(0, 1), cropped.cell(0, 2), cropped.cell(0, 4)]).toEqual([
    0, 1, 137, 100,
  ]);
});
it('uses analog sample count, own rate and explicit irregular clocks', () => {
  const d = table(motion, 'analog:0');
  expect(d.count).toBe(16);
  expect(d.columns[2].name).toBe('Value [V]');
  expect(d.cell(3, 1)).toBe(0.375);
  expect(d.cell(3, 2)).toBe(3);
  expect(d.current!(0.5)).toBe(4);
  expect(d.facts).toContainEqual(['Nominal rate', '8 Hz']);
  const s: Series = {
    values: new Float64Array([2, 4, 6]),
    components: 1,
    rate: 1000,
    startTime: 0.1,
    times: new Float64Array([0.1, 0.3, 0.8]),
  };
  const irregular = seriesDataset('a', 'a', ['Analog'], s, 'V');
  expect(irregular.cell(2, 1)).toBe(0.8);
  expect(irregular.current!(0.29)).toBe(1);
  expect(sampleAt(s, 0)).toBe(-1);
  expect(sampleAt(s, 1)).toBe(-1);
  const regular = { ...s, times: undefined };
  expect(sampleAt(regular, 0.101)).toBe(1);
});
it('shows normalized force/moment/COP/free moment and geometry on their own clocks', () => {
  const force = table(motion, 'plate:0:Force'),
    moment = table(motion, 'plate:0:Moment'),
    cop = table(motion, 'plate:0:COP'),
    free = table(motion, 'plate:0:Free moment');
  expect(force.count).toBe(16);
  expect(force.cell(0, 2)).toBe(0.25);
  expect(force.cell(2, 1)).toBe(0.25);
  expect(force.columns.slice(2).map((c) => c.name)).toEqual(['Fx [N]', 'Fy [N]', 'Fz [N]']);
  expect(moment.cell(0, 2)).toBe(0.00025);
  expect(moment.columns[2].name).toBe('Mx [Nm]');
  expect(cop.cell(0, 2)).toBe(0.25);
  expect(cop.columns[2].name).toBe('X [mm]');
  expect(free.columns[2].name).toContain('Nm');
  expect(free.cell(0, 2)).toBe(motion.forcePlatforms[0].freeMoment!.values[0]);
  const corners = table(motion, 'plate:0:Corners');
  expect(corners.cell(0, 2)).toBe(0);
  expect(corners.columns[2].name).toBe('Corner 1 X [mm]');
  expect(corners.path.at(-1)).toBe('Geometry');
  expect(force.facts).toContainEqual(['Sensor origin [mm]', '0, 0, -50']);
  const c3d = table(parseC3D(physicalFixture(), 's.c3d'), 'plate:0:Corners');
  expect(c3d.count).toBe(1);
  expect(c3d.columns.some((c) => c.name === 'Time [s]')).toBe(false);
  expect(c3d.cell(0, 1)).toBe(100);
});
it('displays events with continuous frame coordinates and original provenance, supports read-only seeking', () => {
  const d = table(motion, 'events');
  expect(d.cell(1, 0)).toBe('Early');
  expect(d.cell(1, 1)).toBe(0.25);
  expect(d.cell(1, 2)).toBe(2);
  expect(d.cell(1, 3)).toBe(9);
  expect(d.columns.map((c) => c.name)).toContain('Context');
  expect(d.seek!(1)).toBe(0.25);
  const crop = cropMotionData(motion, 1, 6),
    events = table(crop, 'events');
  expect(events.cell(1, 1)).toBe(0);
  expect(events.cell(1, 2)).toBe(1);
  expect(events.cell(1, 3)).toBe(9);
});
it('exposes H5 bodies as position and actual row-major matrices, and EMG shares analog values', () => {
  const position = table(motion, 'body:0:Position'),
    rotation = table(motion, 'body:0:Rotation matrix');
  expect(position.count).toBe(8);
  expect(position.cell(1, 2)).toBe(1);
  expect(position.columns[2].name).toBe('X [mm]');
  expect(rotation.columns.slice(2).map((c) => c.name)).toEqual([
    'R11 [1]',
    'R12 [1]',
    'R13 [1]',
    'R21 [1]',
    'R22 [1]',
    'R23 [1]',
    'R31 [1]',
    'R32 [1]',
    'R33 [1]',
  ]);
  expect(rotation.cell(0, 2)).toBe(1);
  expect(rotation.cell(0, 3)).toBe(0);
  const emg = explorerDatasets(motion).find((d) => d.path[0] === 'EMG')!;
  expect(emg.count).toBe(16);
  expect(emg.cell(7, 2)).toBe(7);
  expect(motion.signals!.find((s) => s.group === 'EMG')!.signal).toBe(motion.analogs[0].signal);
});
it('shows structured metadata without preservation trees and model variables without time rows', () => {
  const ds = explorerDatasets(motion),
    ik = table(motion, 'ik:0'),
    id = table(motion, 'id:0');
  expect(ik.name).toBe('quantity');
  expect(id.name).toBe('quantity');
  expect(ik.model?.sourceIndex).toBe(1);
  expect(id.model?.unit).toBe('unknown');
  expect(ik.facts).toContainEqual(['Angular declaration', 'inDegrees=yes']);
  expect(ds.filter((d) => d.path[0] === 'IK Results')).toHaveLength(1);
  const subject = table(motion, 'metadata:Subject');
  expect(copyRows(subject, 0, subject.count)).toContain('SYNTHETIC');
  expect(ds.some((d) => d.name === 'Project')).toBe(true);
  expect(ds.some((d) => d.name === 'Schema')).toBe(true);
  expect(ds.some((d) => /sourceTree|C3DParameters|binary/i.test(d.name))).toBe(false);
});
it('respects explicit IK/ID units and uses a conservative tested rotation convention with inDegrees', () => {
  const labels = ['time', 'knee_angle_r', 'pelvis_tx', 'custom_angle', 'hip_flexion_l'];
  const root = {
    get: (path: string) =>
      path.endsWith('/Data')
        ? { shape: [5, 4] }
        : path === 'IKResults'
          ? {
              attrs: {
                Labels: { value: labels },
                Units: { value: ['s', '', 'm', '', 'rad'] },
                inDegrees: { value: 'yes' },
              },
            }
          : path === 'IDResults'
            ? { attrs: { Labels: { value: labels } } }
            : undefined,
  };
  const info = h5RecordingInfo(root),
    data = { ...motion, source: { ...motion.source, info } };
  const ds = explorerDatasets(data);
  expect(ds.filter((d) => d.path[0] === 'IK Results').map((d) => d.model?.unit)).toEqual([
    'deg',
    'm',
    'unknown',
    'rad',
  ]);
  expect(
    ds.filter((d) => d.path[0] === 'ID Results').every((d) => d.model?.unit === 'unknown'),
  ).toBe(true);
  const renamed = renameDataCommand(data, { kind: 'ik', index: 0 }, 'Renamed rotation')!.apply(
    data,
  );
  expect(table(renamed, 'ik:0').model?.unit).toBe('deg');
});
it('reflects committed labels, event edits and crop values without changing history during catalog/search/access', () => {
  setData(motion);
  renameSessionMarker(0, 'New name');
  editSessionEvent('update', 0, { ...motion.events[0], label: 'Edited event', time: 0.375 });
  const before = useSession.getState(),
    d = before.data!;
  expect(table(d, 'marker:0').name).toBe('New name');
  expect(table(d, 'events').cell(1, 0)).toBe('Edited event');
  expect(table(d, 'events').cell(1, 2)).toBe(2.5);
  filterDatasets(explorerDatasets(d), 'new');
  table(d, 'marker:0').cell(0, 4);
  copyRows(table(d, 'events'), 0, 1);
  expect(useSession.getState().history).toBe(before.history);
  expect(useSession.getState().dirty).toBe(before.dirty);
  expect(useSession.getState().data).toBe(d);
  undoEdit();
  expect(table(useSession.getState().data!, 'events').cell(0, 0)).toBe('Late');
  const cropped = cropMotionData(d, 2, 6),
    analog = table(cropped, 'analog:0');
  expect(analog.count).toBe(8);
  expect(analog.cell(0, 1)).toBe(0);
  expect(analog.cell(0, 2)).toBe(4);
  expect(table(cropped, 'marker:0').cell(0, 2)).toBe(10);
  expect(table(cropped, 'marker:0').cell(0, 4)).toBe(2.123456789);
});
it('bounds large table windows and preserves precise finite/missing values for copying', () => {
  expect(
    rowWindow(1_000_000, 10_000_000, 640).end - rowWindow(1_000_000, 10_000_000, 640).start,
  ).toBeLessThanOrEqual(32);
  expect(rowWindow(0, 0, 400)).toEqual({ start: 0, end: 0 });
  expect(rowWindow(10, 10000, 400).end).toBe(10);
  const value = 0.12345678901234567;
  expect(exactCell(value)).toBe(String(value));
  expect(displayCell(value)).toBe('0.123456789012');
  expect(exactCell(NaN)).toBe('NaN');
  expect(exactCell(undefined)).toBe('—');
  expect(exactCell(-0)).toBe('-0');
  const series: Series = {
    values: new Float64Array([value, NaN]),
    components: 1,
    rate: 10,
    startTime: 0,
  };
  expect(copyRows(seriesDataset('s', 's', [], series, 'V'), 0, 2)).toContain(String(value));
  expect(copyRows(seriesDataset('s', 's', [], series, 'V'), 0, 2)).toContain('NaN');
});
it('reads actual independent H5 IK/ID slices and retains them after trial crop', () => {
  const file = new h5.File(path, 'r');
  try {
    for (const kind of ['ik', 'id'] as const) {
      const group = file.get(kind === 'ik' ? 'IKResults' : 'IDResults') as h5.Group;
      const page = readModelPage(group, {
        kind,
        sourceIndex: 1,
        offset: 0,
        timeBasis: 'independent',
        timeOrigin: 2.5,
        interval: { start: 2.5, end: 3 },
      });
      expect(page.values).toEqual(new Float64Array([4, 5, 6, 7]));
      expect(page.times).toEqual(new Float64Array([0, 0.2, 0.5, 0.75]));
      expect(page.total).toBe(4);
    }
  } finally {
    file.close();
  }
});
it('reads only bounded hyperslabs, excludes time as a variable and aligns trial model crops', () => {
  const calls: number[] = [];
  const group = {
    attrs: { Labels: { value: ['time', 'quantity'] } },
    get: (name: string) =>
      name === 'Data'
        ? {
            shape: [2, 1_000_000],
            slice: ([[r], [a, b]]: number[][]) => {
              calls.push(b - a);
              return Float64Array.from({ length: b - a }, (_, i) =>
                r === 0 ? (a + i) / 100 : 1000 + a + i,
              );
            },
          }
        : undefined,
  };
  const page = readModelPage(group, {
    kind: 'ik',
    sourceIndex: 1,
    offset: 0,
    timeBasis: 'trial',
    timeOrigin: 2,
    interval: { start: 2, end: 5 },
  });
  expect(page.total).toBe(300);
  expect(page.sourceOffset).toBe(200);
  expect(page.values.length).toBe(MODEL_PAGE_SIZE);
  expect(page.values[0]).toBe(1200);
  expect(page.times[0]).toBe(0);
  expect(page.times[1]).toBeCloseTo(0.01);
  expect(Math.max(...calls)).toBe(MODEL_PAGE_SIZE);
  const next = readModelPage(group, {
    kind: 'ik',
    sourceIndex: 1,
    offset: 200,
    timeBasis: 'trial',
    timeOrigin: 2,
    interval: { start: 2, end: 5 },
  });
  expect(next.values.length).toBe(100);
  expect(next.sourceOffset).toBe(400);
});
it('handles empty model arrays, absent clocks and malformed slices explicitly', () => {
  const group = {
    get: (name: string) =>
      name === 'Data' ? { shape: [1, 0], slice: () => new Float64Array(0) } : undefined,
  };
  expect(
    readModelPage(group, {
      kind: 'id',
      sourceIndex: 0,
      offset: 0,
      timeBasis: 'independent',
      timeOrigin: 0,
    }).values.length,
  ).toBe(0);
  const missing = {
    get: (name: string) =>
      name === 'Data' ? { shape: [1, 2], slice: () => new Float64Array([3, 4]) } : undefined,
  };
  expect(
    readModelPage(missing, {
      kind: 'id',
      sourceIndex: 0,
      offset: 0,
      timeBasis: 'independent',
      timeOrigin: 0,
    }).clockKnown,
  ).toBe(false);
  expect(() =>
    readModelPage(missing, {
      kind: 'id',
      sourceIndex: 0,
      offset: 0,
      timeBasis: 'trial',
      timeOrigin: 0,
      interval: { start: 0, end: 1 },
    }),
  ).toThrow('declared clock');
  expect(() =>
    readModelPage(missing, {
      kind: 'id',
      sourceIndex: 9,
      offset: 0,
      timeBasis: 'independent',
      timeOrigin: 0,
    }),
  ).toThrow('dimensions');
});

it('keeps rate-only legacy model clocks relative to original recording zero when point source time is nonzero', () => {
  const group = {
    attrs: { SamplingFrequency: { value: 10 } },
    get: (name: string) =>
      name === 'Data'
        ? {
            shape: [1, 20],
            slice: ([, [a, b]]: number[][]) =>
              Float64Array.from({ length: b - a }, (_, i) => a + i),
          }
        : undefined,
  };
  const page = readModelPage(group, {
    kind: 'id',
    sourceIndex: 0,
    offset: 0,
    timeBasis: 'trial',
    timeOrigin: 2.5,
    regularTimeOrigin: 0.5,
    interval: { start: 2.5, end: 3 },
  });
  expect(page.total).toBe(5);
  expect(page.sourceOffset).toBe(5);
  expect(page.values[0]).toBe(5);
  expect(page.times[0]).toBe(0);
  expect(page.times[1]).toBeCloseTo(0.1);
});

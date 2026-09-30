import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import fixture from './fixtures/institute-h5.json';
import { parseH5Tree } from '../src/importers/h5/schema';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { exportC3D } from '../src/exporters/c3d';
import { number, readParameters } from '../src/importers/c3d/parameters';
import { editC3DParameters } from '../src/exporters/c3dParameters';
import { dataLabelNames, type DataLabelKind } from '../src/motion/dataLabels';
import {
  applyCrop,
  openSessionEvent,
  renameSessionData,
  restoreOriginal,
  selectCrop,
  setData,
  undoEdit,
  redoEdit,
  useSession,
} from '../src/state/session';
import { dataSections, filterDataSections } from '../src/components/dataSections';

const current = () => useSession.getState().data!;
const kinds: DataLabelKind[] = ['plate', 'body', 'signal', 'ik', 'id'];

it('validates names within each collection and never mixes EMG and body signal namespaces', () => {
  const data = parseC3D(physicalFixture(), 'synthetic');
  const signal = data.analogs[0].signal;
  data.signals = [
    { name: 'EMG1', group: 'EMG', unit: 'V', signal },
    { name: 'EMG2', group: 'EMG', unit: 'V', signal },
    { name: 'Body', group: 'RigidBodies', unit: 'mm', signal },
  ];
  data.rigidBodies = [
    { name: 'Body', markers: [], position: signal },
    { name: 'Body2', markers: [], position: signal },
  ];
  data.forcePlatforms.push({ ...data.forcePlatforms[0], name: 'Second' });
  data.source.info = {
    modelResults: {
      ik: { entries: [{ name: 'Angle' }, { name: 'Other' }] },
      id: { entries: [{ name: 'Moment' }, { name: 'Other' }] },
    },
  };
  setData(data);
  for (const [kind, duplicate] of [
    ['plate', 'Second'],
    ['body', 'Body2'],
    ['signal', 'EMG2'],
    ['ik', 'Other'],
    ['id', 'Other'],
  ] as const)
    expect(() => renameSessionData({ kind, index: 0 }, duplicate)).toThrow('already');
  renameSessionData({ kind: 'signal', index: 0 }, 'Body');
  expect(current().signals![0].name).toBe('Body');
  expect(current().rigidBodies![0].name).toBe('Body');
  expect(current().signals![0].signal).toBe(signal);
  renameSessionData({ kind: 'signal', index: 0 }, 'Body');
  expect(useSession.getState().history.past).toHaveLength(1);
});

it('retains the original C3D platform index when an earlier unsupported platform is omitted', () => {
  const editor = editC3DParameters(physicalFixture(), 'FORCE_PLATFORM');
  const param = (name: string, dims: number[], values: number[], kind = 2) => {
    const raw = new Uint8Array(values.length * kind),
      view = new DataView(raw.buffer);
    values.forEach((n, i) =>
      kind === 2 ? view.setInt16(i * kind, n, true) : view.setFloat32(i * kind, n, true),
    );
    editor.parameter(name, kind, dims, raw);
  };
  param('USED', [], [2]);
  param('TYPE', [2], [99, 2]);
  param('ORIGIN', [3, 2], [0, 0, -40, 0, 0, -40], 4);
  const corners = [100, 100, 0, -100, 100, 0, -100, -100, 0, 100, -100, 0];
  param('CORNERS', [3, 4, 2], [...corners, ...corners], 4);
  param('CHANNEL', [6, 2], [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
  const source = editor.finish(),
    data = parseC3D(source, 'synthetic');
  expect(data.forcePlatforms).toHaveLength(1);
  expect(data.forcePlatforms[0].sourceIndex).toBe(1);
  setData(data);
  renameSessionData({ kind: 'plate', index: 0 }, 'Kept plate');
  const output = exportC3D(
    source,
    0,
    data.timeline.frameCount,
    undefined,
    undefined,
    undefined,
    current().source.dataLabels,
  );
  expect(readParameters(new DataView(output)).params.get('FORCE_PLATFORM:LABELS')?.values).toEqual([
    'Plate 1',
    'Kept plate',
  ]);
  expect(parseC3D(output, 'reopened').forcePlatforms).toEqual(current().forcePlatforms);
});

it('all remaining H5 collections rename, undo, redo and export without changing numerical data or time rows', async () => {
  await h5.ready;
  const folder = resolve('.local/data-labels');
  mkdirSync(folder, { recursive: true });
  const sourcePath = resolve(folder, 'synthetic.h5');
  writeFileSync(sourcePath, Buffer.from(fixture.base64, 'base64'));
  const input = new h5.File(sourcePath, 'r');
  try {
    const original = parseH5Tree(input, 'synthetic.h5');
    setData(original);
    const originalNames = kinds.map((kind) => dataLabelNames(original, kind)[0]);
    const names = kinds.map((kind) => `${kind}_Ä中_${'long'.repeat(90)}`);
    kinds.forEach((kind, index) => {
      expect(() => renameSessionData({ kind, index: 0 }, ' ')).toThrow();
      expect(() => renameSessionData({ kind, index: -1 }, 'Missing')).toThrow();
      renameSessionData({ kind, index: 0 }, ` ${names[index]} `);
      expect(dataLabelNames(current(), kind)[0]).toBe(names[index]);
    });
    expect(() => renameSessionData({ kind: 'ik', index: 0 }, 'Time')).toThrow('reserved');
    expect(current().rigidBodies![0].name).toBe(
      current().signals!.find((s) => s.group === 'RigidBodies')!.name,
    );
    expect(current().forcePlatforms[0].force).toBe(original.forcePlatforms[0].force);
    expect(current().rigidBodies![0].position).toBe(original.rigidBodies![0].position);
    expect(current().signals![0].signal).toBe(original.signals![0].signal);
    expect(current().markers).toBe(original.markers);
    expect(current().analogs).toBe(original.analogs);
    expect(filterDataSections(dataSections(current()), names[0])[0].entries[0].rename).toEqual({
      kind: 'plate',
      index: 0,
    });
    for (let i = 0; i < kinds.length; i++) undoEdit();
    expect(useSession.getState().dirty).toBe(false);
    expect(kinds.map((kind) => dataLabelNames(current(), kind)[0])).toEqual(originalNames);
    for (let i = 0; i < kinds.length; i++) redoEdit();
    const output = createH5Output(h5, input, resolve(folder, 'renamed.h5'));
    try {
      writeCroppedH5(
        h5,
        input,
        output,
        0,
        original.timeline.frameCount,
        undefined,
        original,
        undefined,
        undefined,
        current().source.dataLabels,
      );
      const reopened = parseH5Tree(output, 'reopened.h5');
      expect(kinds.map((kind) => dataLabelNames(reopened, kind)[0])).toEqual(names);
      expect(reopened.forcePlatforms).toEqual(current().forcePlatforms);
      expect(reopened.rigidBodies).toEqual(current().rigidBodies);
      expect(reopened.signals).toEqual(current().signals);
      const editedAttrs = new Set([
        `/${original.forcePlatforms[0].sourcePath}@Name`,
        `/${original.rigidBodies![0].sourcePath}@Name`,
        '/EMG@Labels',
        '/IKResults@Labels',
        '/IDResults@Labels',
      ]);
      const compare = (a: h5.Group | h5.Dataset, b: h5.Group | h5.Dataset) => {
        for (const [key, attr] of Object.entries(a.attrs))
          if (!editedAttrs.has(`${a.path}@${key}`))
            expect(b.attrs[key].value, `${a.path}@${key}`).toEqual(attr.value);
        if (a instanceof h5.Group && b instanceof h5.Group) {
          expect(b.keys()).toEqual(a.keys());
          for (const key of a.keys())
            compare(a.get(key) as h5.Group | h5.Dataset, b.get(key) as h5.Group | h5.Dataset);
        } else {
          expect((b as h5.Dataset).value, a.path).toEqual((a as h5.Dataset).value);
          expect((b as h5.Dataset).dtype).toEqual((a as h5.Dataset).dtype);
        }
      };
      compare(input, output);
      for (const group of ['IKResults', 'IDResults']) {
        const before = (input.get(group) as h5.Group).attrs.Labels.value as string[];
        const after = (output.get(group) as h5.Group).attrs.Labels.value as string[];
        expect(after[0]).toBe(before[0]); // The hidden time row remains row 0.
        expect(after[1]).toBe(names[group === 'IKResults' ? 3 : 4]);
      }
    } finally {
      output.close();
    }
    selectCrop(0, 2);
    applyCrop();
    expect(kinds.map((kind) => dataLabelNames(current(), kind)[0])).toEqual(names);
    expect(useSession.getState().history.past).toHaveLength(0);
    renameSessionData({ kind: 'plate', index: 0 }, 'After crop');
    undoEdit();
    expect(current().forcePlatforms[0].name).toBe(names[0]);
    expect(useSession.getState().dirty).toBe(true);
    restoreOriginal();
    expect(current()).toBe(original);
  } finally {
    input.close();
  }
});

it('C3D force names round trip without altering calibration, raw samples or plate identity', () => {
  const source = physicalFixture(),
    original = parseC3D(source, 'synthetic.c3d');
  setData(original);
  renameSessionData({ kind: 'plate', index: 0 }, 'Left force platform');
  for (let step = 0; step < 3; step++) {
    const data = current();
    const output = exportC3D(
      source,
      0,
      original.timeline.frameCount,
      undefined,
      undefined,
      undefined,
      data.source.dataLabels,
    );
    const reopened = parseC3D(output, 'reopened.c3d');
    expect(reopened.forcePlatforms).toEqual(data.forcePlatforms);
    expect(reopened.markers).toEqual(original.markers);
    expect(reopened.analogs).toEqual(original.analogs);
    const before = readParameters(new DataView(source)).params,
      after = readParameters(new DataView(output)).params;
    for (const [key, p] of before)
      if (key !== 'POINT:DATA_START') expect(after.get(key)?.values).toEqual(p.values);
    const a = (number(before, 'POINT:DATA_START', 0) - 1) * 512,
      b = (number(after, 'POINT:DATA_START', 0) - 1) * 512;
    expect(new Uint8Array(output, b)).toEqual(new Uint8Array(source, a));
    if (step === 0) undoEdit();
    else redoEdit();
  }
});

it('event navigation shares session selection, seeks, pauses and clears stale editor identity after edits/loads', () => {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  setData(data);
  useSession.setState({ playing: true });
  openSessionEvent(1);
  expect(useSession.getState().eventEditor).toEqual({ index: 1 });
  expect(useSession.getState().frame).toBe(Math.round(data.events[1].time * data.timeline.rate));
  expect(useSession.getState().playing).toBe(false);
  const request = useSession.getState().eventEditor;
  openSessionEvent(1);
  expect(useSession.getState().eventEditor).not.toBe(request);
  renameSessionData({ kind: 'plate', index: 0 }, 'Plate renamed');
  expect(useSession.getState().eventEditor).toBeNull();
  openSessionEvent(0);
  setData(data);
  expect(useSession.getState().eventEditor).toBeNull();
  openSessionEvent(999);
  expect(useSession.getState().eventEditor).toBeNull();
});

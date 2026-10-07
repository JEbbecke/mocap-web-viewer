import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import fixtures from './fixtures/c3d.json';
import h5Fixture from './fixtures/current-h5.json';
import { parseC3D } from '../src/importers/c3d/importer';
import { parseH5Tree } from '../src/importers/h5/schema';
import { exportC3D } from '../src/exporters/c3d';
import { writeC3DLabels } from '../src/exporters/c3dLabels';
import { editC3DParameters } from '../src/exporters/c3dParameters';
import { number, readParameters } from '../src/importers/c3d/parameters';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { physicalFixture } from './helpers/c3d';
import {
  redoEdit,
  renameSessionAnalog,
  renameSessionMarker,
  setData,
  undoEdit,
  useSession,
} from '../src/state/session';

const buffer = (s: string) => Uint8Array.from(Buffer.from(s, 'base64')).buffer;
for (const [variant, source] of [
  ...Object.entries(fixtures).map(([name, encoded]) => [name, buffer(encoded)] as const),
  ['force plate', physicalFixture()] as const,
]) {
  it(`${variant}: analog labels round trip through undo/redo without changing calibration or samples`, () => {
    const original = parseC3D(source, 'synthetic');
    setData(original);
    const label = 'EMG_Ä'.repeat(35);
    renameSessionAnalog(0, label);
    for (let step = 0; step < 3; step++) {
      const data = useSession.getState().data!;
      const output = exportC3D(
        source,
        0,
        original.timeline.frameCount,
        undefined,
        undefined,
        data.source.analogLabelsEdited ? data.analogs.map((a) => a.name) : undefined,
      );
      const reopened = parseC3D(output, 'renamed');
      expect(reopened.analogs).toEqual(data.analogs);
      expect(reopened.analogs[0].name).toBe(step === 1 ? original.analogs[0].name : label);
      expect(reopened.markers).toEqual(original.markers);
      expect(reopened.forcePlatforms).toEqual(original.forcePlatforms);
      expect(reopened.events).toEqual(original.events);
      const before = readParameters(new DataView(source)).params;
      const after = readParameters(new DataView(output)).params;
      for (const [key, p] of before)
        if (!/^ANALOG:LABELS\d*$/.test(key) && key !== 'POINT:DATA_START')
          expect(after.get(key)?.values).toEqual(p.values);
      const a = (number(before, 'POINT:DATA_START', 0) - 1) * 512;
      const b = (number(after, 'POINT:DATA_START', 0) - 1) * 512;
      expect(new Uint8Array(output, b)).toEqual(new Uint8Array(source, a));
      if (step === 0) undoEdit();
      else redoEdit();
    }
  });
}
for (const [variant, encoded] of Object.entries(fixtures)) {
  it(`${variant}: rename/undo/redo exports current labels, raw samples and unrelated metadata`, () => {
    const source = buffer(encoded),
      original = parseC3D(source, 'synthetic');
    const snapshot = source.slice(0);
    setData(original);
    const label = 'R_Knee_Ä'.repeat(20);
    renameSessionMarker(0, label);
    for (const expected of [label, original.markers.labels[0], label]) {
      const data = useSession.getState().data!;
      const output = exportC3D(
        source,
        0,
        original.timeline.frameCount,
        undefined,
        data.source.labelsEdited ? data.markers.labels : undefined,
      );
      const reopened = parseC3D(output, 'reopened');
      expect(reopened.markers.labels[0]).toBe(expected);
      expect(reopened.markers.positions).toEqual(original.markers.positions);
      expect(reopened.markers.valid).toEqual(original.markers.valid);
      expect(reopened.markers.residuals).toEqual(original.markers.residuals);
      expect(reopened.analogs).toEqual(original.analogs);
      expect(reopened.events).toEqual(original.events);
      const before = readParameters(new DataView(source)),
        after = readParameters(new DataView(output));
      for (const [key, param] of before.params)
        if (!/^POINT:(LABELS\d*|DATA_START)$/.test(key))
          expect(after.params.get(key)?.values).toEqual(param.values);
      const rawStart = (number(before.params, 'POINT:DATA_START', 0) - 1) * 512;
      const outStart = (number(after.params, 'POINT:DATA_START', 0) - 1) * 512;
      expect(new Uint8Array(output, outStart)).toEqual(new Uint8Array(source, rawStart));
      if (expected === label) undoEdit();
      else redoEdit();
    }
    expect(source).toEqual(snapshot);
  });
}
it.each(['POINT', 'ANALOG'] as const)(
  'segments long C3D %s labels within record capacity; removes stale segments',
  (group) => {
    const source = buffer(fixtures.intelFloat);
    const editor = editC3DParameters(source, group);
    const used = new Uint8Array(2);
    new DataView(used.buffer).setInt16(0, 300, true);
    editor.parameter('USED', 2, [], used);
    const many = editor.finish();
    const short = Array.from({ length: 300 }, (_, i) => `*${i}`);
    const long = short.map((s) => s + 'x'.repeat(255 - s.length));
    const grown = writeC3DLabels(many, long, group);
    const p = readParameters(new DataView(grown)).params;
    expect(p.has(`${group}:LABELS3`)).toBe(true);
    expect(p.get(`${group}:LABELS`)?.dimensions[0]).toBe(255);
    const restored = writeC3DLabels(grown, short, group);
    const q = readParameters(new DataView(restored)).params;
    expect(q.has(`${group}:LABELS3`)).toBe(false);
    expect([...q.get(`${group}:LABELS`)!.values, ...q.get(`${group}:LABELS2`)!.values]).toEqual(
      short,
    );
    expect(() => writeC3DLabels(source, ['x'.repeat(256), 'B'])).toThrow('255');
  },
);
it('combines relabeling with C3D event edits and crop', () => {
  const source = buffer(fixtures.intelFloat),
    original = parseC3D(source, 'synthetic');
  const labels = ['Renamed', '*34'];
  const reopened = parseC3D(
    exportC3D(source, 1, 3, [{ label: 'Contact', context: '', time: 0 }], labels),
    'cropped',
  );
  expect(reopened.markers.labels).toEqual(labels);
  expect(reopened.markers.positions).toEqual(original.markers.positions.slice(6));
  expect(reopened.events[0].label).toBe('Contact');
  expect(reopened.events[0].time).toBeCloseTo(0);
});

it.each(['marker', 'analog'] as const)(
  'H5 %s rename/undo/redo preserves every other source value',
  async (kind) => {
    await h5.ready;
    const folder = resolve('.local/marker-export-tests');
    mkdirSync(folder, { recursive: true });
    const path = resolve(folder, 'synthetic.h5');
    writeFileSync(path, Buffer.from(h5Fixture.base64, 'base64'));
    const input = new h5.File(path, 'r');
    try {
      const original = parseH5Tree(input, 'synthetic.h5');
      setData(original);
      const label = 'Knee_Ä中'.repeat(60);
      (kind === 'marker' ? renameSessionMarker : renameSessionAnalog)(0, label);
      for (let step = 0; step < 3; step++) {
        const data = useSession.getState().data!;
        const output = createH5Output(h5, input, resolve(folder, `renamed-${step}.h5`));
        try {
          writeCroppedH5(
            h5,
            input,
            output,
            0,
            original.timeline.frameCount,
            undefined,
            original,
            kind === 'marker' ? data.markers.labels : undefined,
            kind === 'analog' ? data.analogs.map((a) => a.name) : undefined,
          );
          const reopened = parseH5Tree(output, 'reopened');
          expect(reopened.analogs).toEqual(data.analogs);
          expect(reopened.markers).toEqual({
            ...original.markers,
            labels: data.markers.labels,
          });
          const compare = (a: h5.Group | h5.Dataset, b: h5.Group | h5.Dataset) => {
            expect(Object.keys(b.attrs)).toEqual(Object.keys(a.attrs));
            for (const [key, attr] of Object.entries(a.attrs)) {
              if (
                (a.path === (kind === 'marker' ? '/Trajectories/Labeled' : '/Analog') &&
                  key === 'Labels') ||
                (a.path ===
                  `/MetaData/C3DParameters/${kind === 'marker' ? 'POINT' : 'ANALOG'}/LABELS` &&
                  key === 'value')
              )
                continue;
              expect(b.attrs[key].value, `${a.path}@${key}`).toEqual(attr.value);
            }
            if (a instanceof h5.Group && b instanceof h5.Group) {
              expect(b.keys()).toEqual(a.keys());
              for (const key of a.keys())
                compare(a.get(key) as h5.Group | h5.Dataset, b.get(key) as h5.Group | h5.Dataset);
            } else {
              const sourceValues = (a as h5.Dataset).value;
              const expectedValues =
                kind === 'marker' && /^\/RigidBodies\/[^/]+\/Markers$/.test(a.path)
                  ? (sourceValues as string[]).map((name) =>
                      name === original.markers.labels[0] ? data.markers.labels[0] : name,
                    )
                  : sourceValues;
              expect((b as h5.Dataset).value, a.path).toEqual(expectedValues);
              expect((b as h5.Dataset).dtype).toEqual((a as h5.Dataset).dtype);
            }
          };
          compare(input, output);
          const name = kind === 'marker' ? data.markers.labels[0] : data.analogs[0].name;
          const oldName = kind === 'marker' ? original.markers.labels[0] : original.analogs[0].name;
          expect(name).toBe(step === 1 ? oldName : label);
        } finally {
          output.close();
        }
        if (step === 0) undoEdit();
        else redoEdit();
      }
    } finally {
      input.close();
    }
  },
);

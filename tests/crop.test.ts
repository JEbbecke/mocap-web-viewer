import { physicalFixture } from './helpers/c3d';
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cropMotionData, cropSeries } from '../src/motion/crop';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters } from '../src/importers/c3d/parameters';
import { parseH5Tree } from '../src/importers/h5/schema';
import { exportC3D } from '../src/exporters/c3d';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { croppedFilename } from '../src/exporters';
import type { MotionData } from '../src/motion/types';
import c3dFixtures from './fixtures/c3d.json';
import h5Fixture from './fixtures/current-h5.json';

const buffer = (encoded: string) => Uint8Array.from(Buffer.from(encoded, 'base64')).buffer;
function compare(actual: MotionData, expected: MotionData) {
  expect(actual.timeline).toEqual(expected.timeline);
  expect(actual.markers).toEqual(expected.markers);
  expect(actual.analogs).toEqual(expected.analogs);
  expect(actual.forcePlatforms).toEqual(expected.forcePlatforms);
  expect(actual.source.originalPositionUnit).toEqual(expected.source.originalPositionUnit);
  // The complete source hierarchy records the file's own temporal attributes;
  // after reimport these describe the cropped file rather than the original.
  const { hierarchy: actualHierarchy, ...actualMetadata } = actual.source.metadata;
  const { hierarchy: expectedHierarchy, ...expectedMetadata } = expected.source.metadata;
  void actualHierarchy;
  void expectedHierarchy;
  expect(actualMetadata).toEqual(expectedMetadata);
  expect(actual.events).toHaveLength(expected.events.length);
  actual.events.forEach((e, i) => {
    expect(e.label).toBe(expected.events[i].label);
    expect(e.context).toBe(expected.events[i].context);
    expect(e.time).toBeCloseTo(expected.events[i].time, 6);
  });
}

describe('non-destructive physical-time cropping', () => {
  it('selects samples using rate and offset, preserving fractional origins', () => {
    const series = {
      values: Float64Array.from({ length: 10 }, (_, i) => i),
      rate: 500,
      startTime: 0.001,
      components: 1,
    };
    const cut = cropSeries(series, 0.004, 0.01);
    expect([...cut.values]).toEqual([2, 3, 4]);
    expect(cut.startTime).toBeCloseTo(0.001);
    cut.values[0] = 99;
    expect(series.values[2]).toBe(2);
  });
  it('rejects invalid ranges and accumulates repeated crops', () => {
    const source = parseC3D(buffer(c3dFixtures.intelFloat), 'trial.c3d');
    for (const [a, b] of [
      [0, 0],
      [2, 1],
      [-1, 2],
      [0, 4],
      [0.5, 2],
    ])
      expect(() => cropMotionData(source, a, b)).toThrow();
    const first = cropMotionData(source, 1, 3);
    const second = cropMotionData(first, 0, 1);
    expect(second.source.crop).toEqual({ start: 1, end: 2 });
    expect(second.timeline.frameCount).toBe(1);
    expect(source.timeline.frameCount).toBe(3);
    expect(first.markers.positions.buffer).not.toBe(source.markers.positions.buffer);
    expect(croppedFilename('trial.hdf5')).toBe('trial_cropped.hdf5');
  });
});

describe('C3D source-preserving round trips', () => {
  for (const [name, encoded] of Object.entries(c3dFixtures)) {
    it(`${name}: byte-identical no-op and cropped samples, validity, analog and events`, () => {
      const bytes = buffer(encoded);
      const original = parseC3D(bytes, name);
      const snapshot = bytes.slice(0);
      expect(exportC3D(bytes, 0, 3)).toEqual(bytes);
      for (const [start, end] of [
        [0, 1],
        [1, 2],
        [1, 3],
        [2, 3],
      ]) {
        const exported = exportC3D(bytes, start, end);
        compare(parseC3D(exported, name), cropMotionData(original, start, end));
      }
      expect(bytes).toEqual(snapshot);
    });
  }
});

it('one physical second contains 200 points and 2000 synchronized force/analog samples', () => {
  const input = physicalFixture();
  const original = parseC3D(input, 'physical.c3d');
  const expected = cropMotionData(original, 100, 300);
  expect(expected.timeline.firstFrame).toBe(136);
  expect(expected.timeline.frameCount).toBe(200);
  expect(expected.analogs[0].signal.values.length).toBe(2000);
  expect(expected.forcePlatforms).toHaveLength(1);
  expect(expected.forcePlatforms[0].cop.values.length).toBe(6000);
  expect(expected.events.map((e) => e.label)).toEqual(['B', 'C']);
  const output = exportC3D(input, 100, 300);
  compare(parseC3D(output, 'physical.c3d'), expected);
  const a = readParameters(new DataView(input)).params;
  const b = readParameters(new DataView(output)).params;
  for (const key of [
    'VENDOR:CALIBRATION',
    'FORCE_PLATFORM:CORNERS',
    'FORCE_PLATFORM:ORIGIN',
    'ANALOG:OFFSET',
    'ANALOG:SCALE',
  ])
    expect(b.get(key)?.values).toEqual(a.get(key)?.values);
});

it('preserves extended TRIAL frame origins above 65535', () => {
  const source = physicalFixture();
  const view = new DataView(source),
    p = readParameters(view).params;
  const first = 70000;
  for (const [key, value] of [
    ['TRIAL:ACTUAL_START_FIELD', first],
    ['TRIAL:ACTUAL_END_FIELD', first + 399],
  ] as const) {
    const offset = p.get(key)!.storage!.offset;
    view.setUint16(offset, value & 65535, true);
    view.setUint16(offset + 2, Math.floor(value / 65536), true);
  }
  const original = parseC3D(source, 'extended.c3d');
  const output = exportC3D(source, 100, 300);
  const cropped = parseC3D(output, 'extended.c3d');
  expect(cropped.timeline.firstFrame).toBe(70099);
  compare(cropped, cropMotionData(original, 100, 300));
});

it('filters header-only events and preserves labels, flags and absolute timestamps', () => {
  const source = physicalFixture(),
    view = new DataView(source);
  const p = readParameters(view).params;
  view.setUint16(p.get('EVENT:USED')!.storage!.offset, 0, true);
  view.setUint16(298, 12345, true);
  view.setUint16(300, 3, true);
  [0.43, 0.68, 1.68].forEach((t, i) => {
    view.setFloat32(304 + i * 4, t, true);
    view.setUint8(376 + i, i % 2);
    new Uint8Array(source).set(new TextEncoder().encode(`Evt${i}`), 396 + i * 4);
  });
  const output = exportC3D(source, 100, 300);
  compare(parseC3D(output, 'header.c3d'), cropMotionData(parseC3D(source, 'header.c3d'), 100, 300));
  const result = new DataView(output);
  expect(result.getUint16(300, true)).toBe(1);
  expect(result.getUint8(376)).toBe(1);
  expect(result.getFloat32(304, true)).toBe(view.getFloat32(308, true));
});

it('refuses crops that discard required force baseline or undocumented trailing records', () => {
  const source = physicalFixture(),
    v = new DataView(source),
    p = readParameters(v).params;
  const offset = p.get('FORCE_PLATFORM:ZERO')!.storage!.offset;
  v.setInt16(offset, 37, true);
  v.setInt16(offset + 2, 40, true);
  expect(() => exportC3D(source, 100, 300)).toThrow('baseline');
  expect(() => exportC3D(source, 0, 300)).not.toThrow();
  const extended = new Uint8Array(source.byteLength + 512);
  extended.set(new Uint8Array(source));
  extended[extended.length - 1] = 99;
  expect(() => exportC3D(extended.buffer, 0, 300)).toThrow('trailing records');
});

describe('HDF5 actual-file round trips', () => {
  it('preserves source metadata and raw arrays through no-op and crop', async () => {
    const h5 = await import('h5wasm/node');
    await h5.ready;
    const dir = await mkdtemp(join(tmpdir(), 'ibo-crop-'));
    try {
      const path = join(dir, 'source.h5');
      await writeFile(path, Buffer.from(h5Fixture.base64, 'base64'));
      const source = new h5.File(path, 'r');
      try {
        const original = parseH5Tree(source, 'source.h5');
        for (const [start, end] of [
          [0, original.timeline.frameCount],
          [0, 1],
          [0, 2],
          [1, 3],
        ]) {
          const dest = join(dir, `crop-${start}-${end}.h5`);
          const output = createH5Output(h5, source, dest);
          try {
            writeCroppedH5(h5, source, output, start, end);
          } finally {
            output.close();
          }
          const reopened = new h5.File(dest, 'r');
          try {
            compare(
              parseH5Tree(reopened, 'cropped.h5'),
              start === 0 && end === original.timeline.frameCount
                ? original
                : cropMotionData(original, start, end),
            );
            if (start !== 0 || end !== original.timeline.frameCount)
              expect(
                (reopened.get('Trajectories') as InstanceType<typeof h5.Group>).attrs.EndFrame
                  .value,
              ).toBe(BigInt(original.timeline.firstFrame + end - 1));
          } finally {
            reopened.close();
          }
        }
      } finally {
        source.close();
      }
      expect(await readFile(path)).toEqual(Buffer.from(h5Fixture.base64, 'base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it('H5 keeps independent-rate force, Tz, moving geometry, Type, raw units and static metadata', async () => {
  const h5 = await import('h5wasm/node');
  await h5.ready;
  const dir = await mkdtemp(join(tmpdir(), 'ibo-physical-h5-'));
  const input = new h5.File(join(dir, 'input.h5'), 'w');
  try {
    const meta = input.create_group('MetaData');
    meta.create_group('Project').create_attribute('Project', 'Synthetic crop validation');
    meta.create_dataset({
      name: 'StaticCalibration',
      data: new Float64Array([1, 2, 3]),
      shape: [3],
    });
    const traj = input.create_group('Trajectories');
    traj.create_attribute('SamplingFrequency', 200);
    traj.create_attribute('StartFrame', 36);
    const labeled = traj.create_group('Labeled');
    labeled.create_attribute('Labels', ['A']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({
      name: 'Data',
      shape: [1, 4, 400],
      data: Float64Array.from({ length: 1600 }, (_, i) => i),
    });
    labeled.create_dataset({
      name: 'Residuals',
      shape: [1, 400],
      data: Float64Array.from({ length: 400 }, (_, i) => (i === 123 ? -1 : 0.5)),
    });
    labeled.create_dataset({
      name: 'Type',
      shape: [1, 400],
      data: Int8Array.from({ length: 400 }, (_, i) => i % 3),
    });
    const analog = input.create_group('Analog');
    analog.create_attribute('SamplingFrequency', 2000);
    analog.create_attribute('StartFrame', 360);
    analog.create_attribute('Labels', ['EMG']);
    analog.create_attribute('Units', ['V']);
    analog.create_dataset({
      name: 'Data',
      shape: [1, 4000],
      data: Float64Array.from({ length: 4000 }, (_, i) => i * 0.123),
    });
    const plate = input.create_group('ForcePlates').create_group('0');
    for (const [name, value] of Object.entries({
      Name: 'Synthetic plate',
      SamplingFrequency: 2000,
      CoordinateSystem: 1,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
      NumSamples: 4000,
      StartFrame: 360,
    }))
      plate.create_attribute(name, value);
    for (const name of ['Force', 'Moment', 'COP'])
      plate.create_dataset({
        name,
        shape: [3, 4000],
        data: Float64Array.from({ length: 12000 }, (_, i) => i + 0.123456789),
      });
    plate.create_dataset({
      name: 'Tz',
      shape: [3, 4000],
      data: Float64Array.from({ length: 12000 }, (_, i) => i + 0.5),
    });
    plate.create_dataset({
      name: 'Corners',
      shape: [3, 4, 400],
      data: Float64Array.from({ length: 4800 }, (_, i) => i),
    });
    plate.create_dataset({
      name: 'Position',
      shape: [3, 400],
      data: Float64Array.from({ length: 1200 }, (_, i) => i),
    });
    plate.create_dataset({
      name: 'Rotation',
      shape: [3, 3],
      data: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    });
    plate.create_dataset({ name: 'Origin', shape: [3, 1], data: new Float64Array([1, 2, 3]) });
    input.create_group('Events');
    input.flush();
    const original = parseH5Tree(input, 'synthetic.h5');
    const output = new h5.File(join(dir, 'output.h5'), 'w');
    try {
      writeCroppedH5(h5, input, output, 100, 300);
      compare(parseH5Tree(output, 'cropped.h5'), cropMotionData(original, 100, 300));
      const dataset = (path: string) => output.get(path) as InstanceType<typeof h5.Dataset>;
      expect([...(dataset('Trajectories/Labeled/Type').value as Int8Array)]).toEqual(
        Array.from({ length: 200 }, (_, i) => (i + 100) % 3),
      );
      expect(dataset('ForcePlates/0/Position').shape).toEqual([3, 200]);
      expect(dataset('ForcePlates/0/Rotation').shape).toEqual([3, 3]);
      expect(dataset('MetaData/StaticCalibration').value).toEqual(new Float64Array([1, 2, 3]));
      expect(
        (output.get('ForcePlates/0') as InstanceType<typeof h5.Group>).attrs.NumSamples.value,
      ).toBe(2000);
    } finally {
      output.close();
    }
    const short = new h5.File(join(dir, 'three-samples.h5'), 'w');
    try {
      writeCroppedH5(h5, input, short, 100, 103);
      compare(parseH5Tree(short, 'short.h5'), cropMotionData(original, 100, 103));
    } finally {
      short.close();
    }
    const unsupported = new h5.File(join(dir, 'unsupported.h5'), 'w');
    try {
      analog.create_attribute('StartTime', 0.05);
      expect(() => writeCroppedH5(h5, input, unsupported, 100, 300)).toThrow('explicit timing');
      analog.delete_attribute('StartTime');
    } finally {
      unsupported.close();
    }
    (input.get('Events') as InstanceType<typeof h5.Group>).create_attribute('UnknownTiming', 1);
    const rejected = new h5.File(join(dir, 'rejected.h5'), 'w');
    try {
      expect(() => writeCroppedH5(h5, input, rejected, 100, 300)).toThrow('Events');
    } finally {
      rejected.close();
    }
  } finally {
    input.close();
    await rm(dir, { recursive: true, force: true });
  }
});

const localReferences = existsSync('.local/reference.json')
  ? (JSON.parse(await readFile('.local/reference.json', 'utf8')) as { path: string }[])
  : [];
describe('optional local C3D source round trips (never committed)', () => {
  localReferences.forEach((reference, index) => {
    it.skipIf(!existsSync(reference.path))(
      `local C3D reference ${index + 1}: all samples and platforms`,
      async () => {
        const source = Uint8Array.from(await readFile(reference.path)).buffer;
        const data = parseC3D(source, 'local.c3d');
        const start = Math.floor(data.timeline.frameCount / 4),
          end = Math.floor((data.timeline.frameCount * 3) / 4);
        compare(
          parseC3D(exportC3D(source, start, end), 'local.c3d'),
          cropMotionData(data, start, end),
        );
      },
    );
  });
});

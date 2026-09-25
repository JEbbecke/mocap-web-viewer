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
import { writeCroppedH5 } from '../src/exporters/h5';
import { croppedFilename } from '../src/exporters';
import type { MotionData } from '../src/motion/types';
import c3dFixtures from './fixtures/c3d.json';
import h5Fixture from './fixtures/h5.json';

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

/** Independent synthetic C3D encoder: 200 Hz points, 2000 Hz raw six-axis plate. */
function physicalFixture() {
  const bytes = new Uint8Array(4096 + 400 * 64 * 4);
  const v = new DataView(bytes.buffer);
  bytes[0] = 2;
  bytes[1] = 80;
  v.setUint16(2, 1, true);
  v.setUint16(4, 60, true);
  v.setUint16(6, 37, true);
  v.setUint16(8, 436, true);
  v.setFloat32(12, -0.5, true);
  v.setUint16(16, 9, true);
  v.setUint16(18, 10, true);
  v.setFloat32(20, 200, true);
  bytes.set([0, 80, 7, 84], 512);
  let pos = 516;
  function record(id: number, name: string, payload: number[]) {
    bytes[pos++] = name.length;
    v.setInt8(pos++, id);
    bytes.set(new TextEncoder().encode(name), pos);
    pos += name.length;
    v.setInt16(pos, payload.length + 2, true);
    pos += 2;
    bytes.set(payload, pos);
    pos += payload.length;
  }
  const group = (id: number, name: string) => record(-id, name, [0]);
  function param(
    id: number,
    name: string,
    kind: number,
    dims: number[],
    values: number[] | string,
  ) {
    const raw = new Uint8Array(typeof values === 'string' ? values.length : values.length * kind);
    const d = new DataView(raw.buffer);
    if (typeof values === 'string') raw.set(new TextEncoder().encode(values));
    else
      values.forEach((x, i) =>
        kind === 4 ? d.setFloat32(i * 4, x, true) : d.setInt16(i * 2, x, true),
      );
    record(id, name, [kind & 255, dims.length, ...dims, ...raw, 0]);
  }
  group(1, 'POINT');
  param(1, 'USED', 2, [], [1]);
  param(1, 'FRAMES', 2, [], [400]);
  param(1, 'RATE', 4, [], [200]);
  param(1, 'SCALE', 4, [], [-0.5]);
  param(1, 'DATA_START', 2, [], [9]);
  param(1, 'UNITS', -1, [2], 'mm');
  param(1, 'LABELS', -1, [1, 1], 'A');
  group(2, 'ANALOG');
  param(2, 'USED', 2, [], [6]);
  param(2, 'RATE', 4, [], [2000]);
  param(2, 'SCALE', 4, [6], [1, 1, 1, 1, 1, 1]);
  param(2, 'OFFSET', 2, [6], [10, 20, 30, 40, 50, 60]);
  param(2, 'GEN_SCALE', 4, [], [0.1]);
  param(2, 'LABELS', -1, [2, 6], 'FxFyFzMxMyMz');
  group(3, 'FORCE_PLATFORM');
  param(3, 'USED', 2, [], [1]);
  param(3, 'TYPE', 2, [1], [2]);
  param(3, 'CHANNEL', 2, [6, 1], [1, 2, 3, 4, 5, 6]);
  param(3, 'ORIGIN', 4, [3, 1], [0, 0, -40]);
  param(3, 'CORNERS', 4, [3, 4, 1], [100, 100, 0, -100, 100, 0, -100, -100, 0, 100, -100, 0]);
  param(3, 'ZERO', 2, [2], [0, 0]);
  group(4, 'EVENT');
  param(4, 'USED', 2, [], [4]);
  param(4, 'TIMES', 4, [2, 4], [0, 0.43, 0, 0.68, 0, 1.18, 0, 1.68]);
  param(4, 'LABELS', -1, [1, 4], 'ABCD');
  param(4, 'CONTEXTS', -1, [1, 4], 'LRLR');
  group(5, 'VENDOR');
  param(5, 'CALIBRATION', 4, [3], [1.234, 5.678, 9.012]);
  group(6, 'TRIAL');
  param(6, 'ACTUAL_START_FIELD', 2, [2], [37, 0]);
  param(6, 'ACTUAL_END_FIELD', 2, [2], [436, 0]);
  for (let f = 0; f < 400; f++) {
    let offset = 4096 + f * 256;
    [f, f + 1, f + 2, f === 123 ? -1 : 5].forEach((x) => {
      v.setFloat32(offset, x, true);
      offset += 4;
    });
    for (let sub = 0; sub < 10; sub++)
      for (let c = 0; c < 6; c++) {
        v.setFloat32(offset, 1000 + f * 10 + sub + c, true);
        offset += 4;
      }
  }
  return bytes.buffer;
}

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
          [0, 3],
          [0, 1],
          [0, 2],
          [1, 3],
        ]) {
          const dest = join(dir, `crop-${start}-${end}.h5`);
          const output = new h5.File(dest, 'w');
          try {
            writeCroppedH5(h5, source, output, start, end);
          } finally {
            output.close();
          }
          const reopened = new h5.File(dest, 'r');
          try {
            compare(parseH5Tree(reopened, 'cropped.h5'), cropMotionData(original, start, end));
            if (start !== 0 || end !== original.timeline.frameCount)
              expect(
                (reopened.get('Trajectories') as InstanceType<typeof h5.Group>).attrs.EndFrame
                  .value,
              ).toBe(10 + end - 1);
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
    meta.create_attribute('Project', 'Synthetic crop validation');
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
      shape: [1, 1, 400],
      data: Float64Array.from({ length: 400 }, (_, i) => (i === 123 ? -1 : 0.5)),
    });
    labeled.create_dataset({
      name: 'Type',
      shape: [1, 400],
      data: Int8Array.from({ length: 400 }, (_, i) => i % 3),
    });
    const analog = input.create_group('Analog');
    analog.create_attribute('SamplingFrequency', 2000);
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
      NumSamples: 3,
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
      shape: [4000],
      data: Float64Array.from({ length: 4000 }, (_, i) => i + 0.5),
    });
    plate.create_dataset({
      name: 'Location',
      shape: [3, 4, 400],
      data: Float64Array.from({ length: 4800 }, (_, i) => i),
    });
    plate.create_dataset({
      name: 'Position',
      shape: [4, 400],
      data: Float64Array.from({ length: 1600 }, (_, i) => i),
    });
    plate.create_dataset({ name: 'Rotation', shape: [3, 3, 3], data: new Float64Array(27) });
    plate.create_dataset({ name: 'Offset', shape: [3], data: new Float64Array([1, 2, 3]) });
    const sampleMajor = (input.get('ForcePlates') as InstanceType<typeof h5.Group>).create_group(
      '1',
    );
    for (const [name, value] of Object.entries({
      Name: 'Sample-major plate',
      SamplingFrequency: 200,
      CoordinateSystem: 1,
      unit_force: 'N',
      unit_moment: 'Nm',
      unit_position: 'm',
    }))
      sampleMajor.create_attribute(name, value);
    for (const name of ['Force', 'Moment', 'COP'])
      sampleMajor.create_dataset({
        name,
        shape: [400, 3],
        data: Float64Array.from({ length: 1200 }, (_, i) => i + 0.01),
      });
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
      expect(dataset('ForcePlates/0/Position').shape).toEqual([4, 200]);
      expect(dataset('ForcePlates/0/Rotation').shape).toEqual([3, 3, 3]);
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
      analog.delete_attribute('SamplingFrequency');
      analog.create_attribute('SamplingFrequency', 150);
      expect(() => writeCroppedH5(h5, input, unsupported, 100, 101)).toThrow('sampling grid');
      analog.delete_attribute('SamplingFrequency');
      analog.create_attribute('SamplingFrequency', 2000);
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

describe('optional private source round trips (never committed)', () => {
  for (const name of ['03_PRE_GANG12_01.c3d', 'P01_pre_gait_16_0001.c3d']) {
    const path = resolve('../ibo-biomech', name);
    it.skipIf(!existsSync(path))(`${name}: all samples and platforms`, async () => {
      const source = Uint8Array.from(await readFile(path)).buffer;
      const data = parseC3D(source, name);
      const start = Math.floor(data.timeline.frameCount / 4),
        end = Math.floor((data.timeline.frameCount * 3) / 4);
      const result = exportC3D(source, start, end);
      compare(parseC3D(result, name), cropMotionData(data, start, end));
    });
  }
  for (const name of ['03_PRE_GANG12_01.h5', 'virtual_marker.h5']) {
    const path = resolve('../ibo-biomech', name);
    it.skipIf(!existsSync(path))(`${name}: preserves legacy and converter layouts`, async () => {
      const h5 = await import('h5wasm/node');
      await h5.ready;
      const dir = await mkdtemp(join(tmpdir(), 'ibo-private-crop-'));
      const source = new h5.File(path, 'r');
      const output = new h5.File(join(dir, 'crop.h5'), 'w');
      try {
        const data = parseH5Tree(source, name);
        const start = Math.floor(data.timeline.frameCount / 4),
          end = Math.floor((data.timeline.frameCount * 3) / 4);
        writeCroppedH5(h5, source, output, start, end);
        compare(parseH5Tree(output, name), cropMotionData(data, start, end));
      } finally {
        output.close();
        source.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});

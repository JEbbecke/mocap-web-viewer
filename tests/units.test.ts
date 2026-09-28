import { describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import { physicalFixture } from './helpers/c3d';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters } from '../src/importers/c3d/parameters';
import { extractPlatforms } from '../src/importers/c3d/forces';
import { parseH5Tree } from '../src/importers/h5/schema';
import { exportC3D } from '../src/exporters/c3d';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { cropMotionData } from '../src/motion/crop';
import { updateEvent } from '../src/motion/events';
import { MOTION_UNITS, millimetres, momentScale } from '../src/motion/units';
import { sceneLength } from '../src/viewer/scale';

// Independent encodings: the expected scientific values below never use the
// production conversion helpers. Raw samples and source metadata are also checked.
function knownC3D(unit: string, sourceUnitsPerMm: number) {
  const bytes = physicalFixture(),
    view = new DataView(bytes);
  const p = readParameters(view).params;
  const set = (key: string, values: number[]) => {
    const storage = p.get(key)!.storage!;
    values.forEach((v, i) => view.setFloat32(storage.offset + i * 4, v, true));
  };
  const units = p.get('POINT:UNITS')!.storage!;
  new Uint8Array(bytes, units.offset, units.bytes).set(new TextEncoder().encode(unit.padEnd(2)));
  set('POINT:SCALE', [-0.5 * sourceUnitsPerMm]);
  set(
    'FORCE_PLATFORM:CORNERS',
    [100, 100, 0, -100, 100, 0, -100, -100, 0, 100, -100, 0].map((v) => v * sourceUnitsPerMm),
  );
  set('FORCE_PLATFORM:ORIGIN', [0, 0, -40 * sourceUnitsPerMm]);
  set('ANALOG:SCALE', [1, 1, 1, 1, 1, 1]);
  set('ANALOG:GEN_SCALE', [1]);
  // Existing integer offsets are retained and explicitly accounted for.
  for (let frame = 0; frame < 400; frame++) {
    let at = 4096 + frame * 256;
    [1234.5 * sourceUnitsPerMm, 0, 0, 5].forEach((v) => {
      view.setFloat32(at, v, true);
      at += 4;
    });
    for (let sub = 0; sub < 10; sub++)
      [
        0,
        0,
        500,
        10000 * sourceUnitsPerMm,
        -20000 * sourceUnitsPerMm,
        3000 * sourceUnitsPerMm,
      ].forEach((v, c) => {
        view.setFloat32(at, v + (c + 1) * 10, true);
        at += 4;
      });
  }
  return bytes;
}

describe.each([
  ['mm', 1],
  ['cm', 0.1],
  ['m', 0.001],
] as const)('C3D %s boundary', (unit, factor) => {
  it('preserves 1234.5 mm, wrench physics, source units, crop and edited-event exports', () => {
    const source = knownC3D(unit, factor),
      snapshot = source.slice(0);
    const motion = parseC3D(source, 'synthetic.c3d');
    expect(motion.units).toEqual(MOTION_UNITS);
    expect(motion.markers.positions[0]).toBeCloseTo(1234.5, 3);
    expect(motion.markers.residuals![0]).toBeCloseTo(2.5, 5);
    const plate = motion.forcePlatforms[0];
    expect(motion.forcePlatforms).toHaveLength(1);
    expect(plate.force.values.slice(0, 3)).toEqual(new Float64Array([0, 0, 500]));
    expect(plate.moment.values.slice(0, 3)).toEqual(new Float64Array([10, -20, 3]));
    expect(plate.cop.values[0]).toBeCloseTo(40, 5);
    expect(plate.cop.values[1]).toBeCloseTo(20, 5);
    expect(plate.freeMoment!.values[2]).toBeCloseTo(3, 5);
    expect(plate.origin![2]).toBeCloseTo(-40, 5);
    expect(plate.corners!.values[0]).toBeCloseTo(100, 5);
    expect(exportC3D(source, 0, 400)).toEqual(source);
    for (const [start, end] of [
      [0, 400],
      [100, 300],
    ]) {
      const cut = cropMotionData(motion, start, end);
      const changed = updateEvent(cut, 0, { ...cut.events[0], label: 'Unit test event' });
      const output = exportC3D(source, start, end, changed.events);
      const reopened = parseC3D(output, 'reopened.c3d');
      expect(reopened.markers).toEqual(cut.markers);
      expect(reopened.forcePlatforms).toEqual(cut.forcePlatforms);
      expect(reopened.analogs).toEqual(cut.analogs);
      expect(reopened.units).toEqual(MOTION_UNITS);
      expect(reopened.events[0].label).toBe('Unit test event');
      expect(reopened.events[0].time).toBeCloseTo(changed.events[0].time, 6);
      const params = readParameters(new DataView(output)).params;
      expect(params.get('POINT:UNITS')!.values[0]).toBe(unit);
      expect(params.get('FORCE_PLATFORM:ORIGIN')!.values).toEqual(
        readParameters(new DataView(source)).params.get('FORCE_PLATFORM:ORIGIN')!.values,
      );
      const offset = (Number(params.get('POINT:DATA_START')!.values[0]) - 1) * 512;
      expect(new DataView(output).getFloat32(offset, true)).toBeCloseTo(1234.5 * factor, 3);
    }
    expect(source).toEqual(snapshot);
  });
});

it.each([
  ['Nmm', 10000, -20000, 3000],
  ['Nm', 10, -20, 3],
] as const)(
  'honors explicit C3D type-2 %s channels independently of POINT:mm',
  (unit, mx, my, mz) => {
    const p = readParameters(new DataView(knownC3D('mm', 1))).params;
    const analogs = [0, 0, 500, mx, my, mz].map((v, i) => ({
      name: 'synthetic',
      unit: i < 3 ? 'N' : unit,
      signal: { values: new Float64Array([v]), components: 1, rate: 100, startTime: 0 },
    }));
    const warnings: string[] = [];
    const plate = extractPlatforms(p, analogs, 1, warnings)[0];
    expect(warnings).toEqual([]);
    expect(plate.moment.values).toEqual(new Float64Array([10, -20, 3]));
    expect(plate.cop.values).toEqual(new Float64Array([40, 20, 0]));
    expect(analogs[3].signal.values[0]).toBe(mx);
  },
);

it.each([3, 4])(
  'keeps type-%i calibration and moment dimensions independent of mm normalization',
  (type) => {
    const p = readParameters(new DataView(knownC3D('mm', 1))).params;
    p.set('FORCE_PLATFORM:TYPE', { dimensions: [1], values: [type] });
    const n = type === 3 ? 8 : 6;
    p.set('FORCE_PLATFORM:CHANNEL', {
      dimensions: [n, 1],
      values: Array.from({ length: n }, (_, i) => i + 1),
    });
    p.set('FORCE_PLATFORM:ORIGIN', { dimensions: [3, 1], values: [100, 100, -40] });
    if (type === 4)
      p.set('FORCE_PLATFORM:CAL_MATRIX', {
        dimensions: [6, 6, 1],
        values: Array.from({ length: 36 }, (_, i) => (i % 7 === 0 ? (i / 7 < 3 ? 100 : 1000) : 0)),
      });
    const raw = type === 3 ? [0, 0, 0, 0, 100, 100, 100, 100] : [0, 0, 5, 10, -20, 3];
    const analogs = raw.map((v) => ({
      name: 'synthetic',
      unit: 'V',
      signal: { values: new Float64Array([v]), components: 1, rate: 100, startTime: 0 },
    }));
    const warnings: string[] = [];
    const plate = extractPlatforms(p, analogs, 1, warnings)[0];
    expect(plate.force.values[2]).toBe(type === 3 ? 400 : 500);
    expect(plate.moment.values).toEqual(new Float64Array(type === 3 ? [0, 0, 0] : [-40, 30, 3]));
    expect(plate.cop.values[0]).toBe(type === 3 ? 0 : -60);
    expect(plate.cop.values[1]).toBe(type === 3 ? 0 : -80);
    expect(plate.freeMoment!.values[2]).toBe(type === 3 ? 0 : 3);
    expect(warnings.length).toBe(type === 3 ? 1 : 0);
    expect(analogs.map((a) => a.signal.values[0])).toEqual(raw);
  },
);

describe.each([
  ['mm', 1, 'Nmm', 1],
  ['m', 0.001, 'Nm', 0.001],
] as const)('H5 %s / %s boundaries', (unit, distanceFactor, momentUnit, torqueFactor) => {
  it('preserves known physical quantities, raw metadata and numerical values through export/crop', async () => {
    await h5.ready;
    const folder = resolve('.local/unit-tests');
    mkdirSync(folder, { recursive: true });
    const input = new h5.File(resolve(folder, `synthetic-${unit}.h5`), 'w');
    try {
      const traj = input.create_group('Trajectories');
      traj.create_attribute('SamplingFrequency', 100);
      traj.create_attribute('StartFrame', 0);
      const labeled = traj.create_group('Labeled');
      labeled.create_attribute('Labels', ['Synthetic']);
      labeled.create_attribute('Unit', unit);
      labeled.create_dataset({
        name: 'Data',
        shape: [1, 4, 3],
        data: new Float64Array(
          [1234.5, 1234.5, 1234.5, 0, 0, 0, 0, 0, 0]
            .map((v) => v * distanceFactor)
            .concat([1, 1, 1]),
        ),
      });
      labeled.create_dataset({
        name: 'Residuals',
        shape: [1, 3],
        data: new Float64Array([2.5 * distanceFactor, -1, NaN]),
      });
      const plate = input.create_group('ForcePlates').create_group('0');
      for (const [k, v] of Object.entries({
        Name: 'Synthetic',
        SamplingFrequency: 200,
        CoordinateSystem: 1,
        unit_position: unit,
        unit_force: 'N',
        unit_moment: momentUnit,
      }))
        plate.create_attribute(k, v);
      for (const [name, values] of Object.entries({
        Force: [0, 0, 500],
        Moment: [10000, -20000, 3000].map((v) => v * torqueFactor),
        COP: [40, 20, 0].map((v) => v * distanceFactor),
        Tz: [0, 0, 3000 * torqueFactor],
      }))
        plate.create_dataset({
          name,
          shape: [3, 6],
          data: new Float64Array(values.flatMap((v) => Array(6).fill(v))),
        });
      plate.create_dataset({
        name: 'Corners',
        shape: [3, 4],
        data: new Float64Array(
          [100, -100, -100, 100, 100, 100, -100, -100, 0, 0, 0, 0].map((v) => v * distanceFactor),
        ),
      });
      plate.create_dataset({
        name: 'Origin',
        shape: [3, 1],
        data: new Float64Array([0, 0, -40 * distanceFactor]),
      });
      plate.create_dataset({
        name: 'Position',
        shape: [3],
        data: new Float64Array([100 * distanceFactor, 0, 0]),
      });
      const analog = input.create_group('Analog');
      analog.create_attribute('Labels', ['Voltage']);
      analog.create_attribute('Units', ['V']);
      analog.create_attribute('SamplingFrequency', 200);
      analog.create_dataset({
        name: 'Data',
        shape: [1, 6],
        data: new Float64Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
      });
      const motion = parseH5Tree(input, 'synthetic.h5');
      expect(motion.markers.positions[0]).toBeCloseTo(1234.5, 10);
      expect(motion.markers.residuals![0]).toBe(2.5);
      expect(motion.markers.residuals![1]).toBe(-1);
      expect(motion.markers.residuals![2]).toBeNaN();
      const p = motion.forcePlatforms[0];
      expect(p.force.values[2]).toBe(500);
      expect(p.moment.values[0]).toBe(10);
      expect(p.cop.values[0]).toBe(40);
      expect(p.corners!.values[0]).toBe(100);
      expect(p.origin![2]).toBe(-40);
      expect(p.position!.values[0]).toBe(100);
      expect(p.freeMoment!.values[2]).toBe(3);
      expect(motion.units).toEqual(MOTION_UNITS);
      for (const [start, end] of [
        [0, 3],
        [1, 3],
      ]) {
        const cut = cropMotionData(motion, start, end);
        const output = createH5Output(
          h5,
          input,
          resolve(folder, `synthetic-${unit}-${start}-out.h5`),
        );
        try {
          writeCroppedH5(h5, input, output, start, end);
          const reopened = parseH5Tree(output, 'reopened.h5');
          expect(reopened.markers).toEqual(cut.markers);
          expect(reopened.forcePlatforms).toEqual(cut.forcePlatforms);
          expect(reopened.analogs).toEqual(cut.analogs);
          expect(reopened.units).toEqual(MOTION_UNITS);
          const raw = output.get('Trajectories/Labeled/Data') as h5.Dataset;
          expect((raw.value as Float64Array)[0]).toBe(1234.5 * distanceFactor);
          expect((output.get('Trajectories/Labeled') as h5.Group).attrs.Unit.value).toBe(unit);
          expect((output.get('ForcePlates/0') as h5.Group).attrs.unit_moment.value).toBe(
            momentUnit,
          );
          for (const field of ['Origin', 'Corners', 'Position'])
            expect((output.get(`ForcePlates/0/${field}`) as h5.Dataset).value).toEqual(
              (input.get(`ForcePlates/0/${field}`) as h5.Dataset).value,
            );
        } finally {
          output.close();
        }
      }
    } finally {
      input.close();
    }
  });
});

it('separates scientific conversions from scene scale and rejects unknown units', () => {
  expect(sceneLength(1234.5)).toBeCloseTo(1.2345, 12);
  expect(sceneLength(500 * 1)).toBe(0.5); // 500 N at the display setting 1 mm/N
  expect(millimetres(' CM ')).toBe(10);
  expect(momentScale('N·mm')).toBe(0.001);
  expect(momentScale('N·m')).toBe(1);
  expect(() => millimetres('inch')).toThrow();
  expect(() => momentScale('V')).toThrow();
  expect(() => parseC3D(knownC3D('in', 1), 'unsupported.c3d')).toThrow('Unsupported position unit');
});

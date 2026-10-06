import { beforeAll, describe, expect, it } from 'vitest';
import * as h5 from 'h5wasm/node';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { physicalFixture } from './helpers/c3d';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters, nums, number } from '../src/importers/c3d/parameters';
import { parseH5Tree } from '../src/importers/h5/schema';
import { writeSemanticH5 } from '../src/exporters/semanticH5';
import { exportSemanticC3D } from '../src/exporters/semanticC3D';
import { conversionPlan } from '../src/exporters/conversion';
import { cropMotionData } from '../src/motion/crop';
import type { C3DPlateDefinition, MotionData, Series } from '../src/motion/types';

const folder = resolve('.local/cross-format-validation');
let sequence = 0;
beforeAll(async () => {
  await h5.ready;
  mkdirSync(folder, { recursive: true });
});
const series = (vector: number[], moment = false): Series => ({
  rate: 2000,
  startTime: 0,
  components: 3,
  values: Float64Array.from(
    { length: 120 },
    (_, i) => ((vector[i % 3] * (Math.floor(i / 3) + 1)) / 4) * (moment ? 0.001 : 1),
  ),
});
const copSeries = (vector: number[]): Series => ({
  ...series(vector),
  values: Float64Array.from({ length: 120 }, (_, i) => vector[i % 3]),
});

/** Independent known loads: no production wrench routine generates the expected data. */
function fixture(edit?: (file: h5.File) => void): MotionData {
  const data = cropMotionData(parseC3D(physicalFixture(), 'synthetic.c3d'), 0, 4);
  data.analogs.forEach((a, i) => {
    a.sourceChannel = i;
  });
  const corners = data.forcePlatforms[0].corners!.values;
  const definitions: C3DPlateDefinition[] = [
    {
      type: 2,
      channels: [0, 1, 2, 3, 4, 5],
      corners,
      origin: [0, 0, -40],
    },
  ];
  const append = (values: number[]) =>
    values.map((value, j) => {
      const identity = data.analogs.length;
      data.analogs.push({
        name: `Native ${identity}`,
        unit: 'V',
        sourceChannel: identity,
        signal: {
          rate: 2000,
          startTime: 0,
          components: 1,
          values: Float64Array.from({ length: 40 }, (_, i) => (value * (i + 1)) / 4),
        },
      });
      return identity;
    });
  const channels3 = append([2, 3, 4, 5, 10, 20, 30, 40]);
  const polynomial = new Float64Array(12);
  polynomial[5] = 0.125;
  polynomial[11] = 0.0625;
  definitions.push({
    type: 3,
    channels: channels3,
    corners,
    origin: [100, 100, -20],
    copPolynomial: polynomial,
  });
  data.forcePlatforms.push({
    name: 'Native type 3',
    coordinateFrame: 'global',
    provenance: 'Synthetic',
    corners: data.forcePlatforms[0].corners,
    origin: new Float64Array([100, 100, -20]),
    force: series([5, 9, 100]),
    moment: series([-4180, 100, 0], true),
    cop: copSeries([-0.875, -39.1875, 0]),
    freeMoment: series([-261.25, 12.5, -188.0625], true),
  });
  const channels4 = append([10, 20, 30, 4, 5, 6]);
  const calibration = new Float64Array(36);
  [2, 3, 4, 500, 600, 700].forEach((v, i) => {
    calibration[i * 7] = v;
  });
  calibration[6] = 0.5; // Off-diagonal term catches a transposed calibration matrix.
  definitions.push({ type: 4, channels: channels4, corners, origin: [0, 0, -10], calibration });
  data.forcePlatforms.push({
    name: 'Native type 4',
    coordinateFrame: 'global',
    provenance: 'Synthetic',
    corners: data.forcePlatforms[0].corners,
    origin: new Float64Array([0, 0, -10]),
    force: series([30, 60, 120]),
    moment: series([1400, 3300, 4200], true),
    cop: copSeries([-27.5, 1400 / 120, 0]),
    freeMoment: series([0, 0, 6200], true),
  });
  const path = resolve(folder, `native-${sequence++}.h5`);
  const file = new h5.File(path, 'w');
  try {
    writeSemanticH5(file, data);
    const analogGroup = file.get('Analog') as h5.Group;
    analogGroup.delete_attribute('Channels');
    analogGroup.create_attribute(
      'Channels',
      new BigInt64Array(Array.from({ length: 20 }, (_, i) => BigInt(i))),
    );
    const root = (file.get('MetaData') as h5.Group).create_group('C3DParameters');
    const point = root.create_group('POINT'),
      analog = root.create_group('ANALOG'),
      fp = root.create_group('FORCE_PLATFORM');
    const attr = (group: h5.Group, name: string, shape: number[], values: number[]) =>
      group.create_group(name).create_attribute('value', new Float64Array(values), shape);
    point.create_group('UNITS').create_attribute('value', ['mm']);
    attr(analog, 'USED', [1], [20]);
    attr(analog, 'GEN_SCALE', [1], [0.5]);
    const originalScale = readParameters(new DataView(physicalFixture())).params;
    const scale = [
      ...Array(6).fill(number(originalScale, 'ANALOG:GEN_SCALE', 0) * 2),
      ...Array(14).fill(0.5),
    ];
    attr(analog, 'SCALE', [20], scale);
    attr(
      analog,
      'OFFSET',
      [20],
      [10, 20, 30, 40, 50, 60, ...Array.from({ length: 14 }, (_, i) => i - 7)],
    );
    attr(fp, 'USED', [1], [3]);
    attr(fp, 'TYPE', [3], [2, 3, 4]);
    attr(
      fp,
      'CHANNEL',
      [8, 3],
      Array.from(
        { length: 24 },
        (_, i) => (definitions[i % 3].channels[Math.floor(i / 3)] ?? -1) + 1,
      ),
    );
    attr(
      fp,
      'ORIGIN',
      [3, 3],
      Array.from({ length: 9 }, (_, i) => definitions[i % 3].origin[Math.floor(i / 3)]),
    );
    attr(
      fp,
      'CORNERS',
      [3, 4, 3],
      Array.from(
        { length: 36 },
        (_, i) => corners[(Math.floor(i / 3) % 4) * 3 + Math.floor(i / 12)],
      ),
    );
    attr(
      fp,
      'CAL_MATRIX',
      [6, 6, 3],
      Array.from(
        { length: 108 },
        (_, i) =>
          definitions[i % 3].calibration?.[(Math.floor(i / 3) % 6) * 6 + Math.floor(i / 18)] ?? 0,
      ),
    );
    attr(
      fp,
      'FPCOPPOLY',
      [6, 2, 3],
      Array.from(
        { length: 36 },
        (_, i) =>
          definitions[i % 3].copPolynomial?.[(Math.floor(i / 3) % 2) * 6 + Math.floor(i / 6)] ?? 0,
      ),
    );
    edit?.(file);
    const input = parseH5Tree(file, 'native.h5');
    // Canonical names are user-editable without affecting original plate identities.
    input.forcePlatforms[0].name = 'Native type 2';
    return input;
  } finally {
    file.close();
  }
}

function compare(actual: MotionData, expected: MotionData) {
  expect(actual.analogs.length).toBeGreaterThanOrEqual(expected.analogs.length);
  for (const [i, original] of expected.analogs.entries())
    actual.analogs[i].signal.values.forEach((v, j) =>
      expect(v).toBeCloseTo(original.signal.values[j], 5),
    );
  expect(actual.forcePlatforms.map((p) => p.name)).toEqual(
    expected.forcePlatforms.map((p) => p.name),
  );
  for (const [i, original] of expected.forcePlatforms.entries())
    for (const key of ['force', 'moment', 'cop', 'freeMoment'] as const)
      actual.forcePlatforms[i][key]!.values.forEach((v, j) =>
        expect(v).toBeCloseTo(original[key]!.values[j], 4),
      );
}

describe('existing force-platform channels', () => {
  it('retains original TYPE-2/3/4 definitions, calibration and corrected COP without adding channels or applying scaling twice', () => {
    const input = fixture(),
      before = structuredClone(input);
    const plan = conversionPlan(input, 'C3D');
    expect(
      plan.plates.map((p) => p.reused?.type),
      plan.report.warnings.join(' '),
    ).toEqual([2, 3, 4]);
    expect(plan.report.warnings.join(' ')).not.toMatch(
      /derived six-axis|stored COP|stored free moment/,
    );
    const bytes = exportSemanticC3D(input),
      actual = parseC3D(bytes, 'native.c3d');
    compare(actual, input);
    expect(actual.analogs).toHaveLength(20);
    const { params } = readParameters(new DataView(bytes));
    expect(nums(params, 'FORCE_PLATFORM:CHANNEL')).toEqual([
      1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 0, 0,
    ]);
    expect(nums(params, 'FORCE_PLATFORM:TYPE')).toEqual([2, 3, 4]);
    expect(number(params, 'ANALOG:GEN_SCALE', 0)).toBe(1);
    expect(nums(params, 'ANALOG:SCALE')[6]).toBe(0.25);
    expect(nums(params, 'ANALOG:OFFSET')[6]).toBe(0);
    expect(input).toEqual(before);
    writeFileSync(resolve(folder, 'synthetic-native.c3d'), new Uint8Array(bytes));
    // Independent h5py/ezc3d validation uses this wholly synthetic source pair.
    copyFileSync(
      resolve(folder, `native-${sequence - 1}.h5`),
      resolve(folder, 'synthetic-native.h5'),
    );
  });
  it('resolves reordered/renamed analog channels by original identities after crop', () => {
    const input = cropMotionData(fixture(), 1, 3);
    input.analogs.reverse();
    input.analogs.forEach((a, i) => {
      a.name = `Renamed ${i}`;
    });
    expect(conversionPlan(input, 'C3D').plates.every((p) => p.reused)).toBe(true);
    const actual = parseC3D(exportSemanticC3D(input), 'cropped.c3d');
    compare(actual, input);
    expect(actual.timeline).toEqual(input.timeline);
    expect(actual.analogs).toHaveLength(20);
  });
  it.each([
    'missing channel',
    'changed signal',
    'wrong units',
    'changed origin',
    'missing matrix',
    'wrong COP',
  ])('falls back only for the incompatible plate: %s', (kind) => {
    const input = fixture(),
      p = input.forcePlatforms[2];
    if (kind === 'missing channel') input.analogs.pop();
    if (kind === 'changed signal') input.analogs[19].signal.values[0] += 1;
    if (kind === 'wrong units') input.analogs[19].unit = 'N';
    if (kind === 'changed origin') p.c3dSource!.definition!.origin[2] -= 1;
    if (kind === 'missing matrix') p.c3dSource!.definition!.calibration = undefined;
    if (kind === 'wrong COP') p.cop.values[0] += 1;
    const plan = conversionPlan(input, 'C3D');
    expect(plan.plates.map((p) => !!p.reused)).toEqual([true, true, false]);
    expect(plan.report.warnings.join(' ')).toMatch(
      /Native type 4: original channels cannot be reused/,
    );
    const bytes = exportSemanticC3D(input),
      actual = parseC3D(bytes, 'mixed.c3d');
    expect(actual.analogs).toHaveLength(input.analogs.length + 6);
    expect(nums(readParameters(new DataView(bytes)).params, 'FORCE_PLATFORM:TYPE')).toEqual([
      2, 3, 2,
    ]);
    if (kind !== 'wrong COP') compare(actual, input);
  });
  it.each(['missing', 'dimensions', 'units'])(
    'uses the fallback for unavailable or malformed embedded metadata: %s',
    (kind) => {
      const input = fixture((file) => {
        const root = file.get('MetaData/C3DParameters') as h5.Group;
        if (kind === 'missing')
          (root.get('FORCE_PLATFORM/TYPE') as h5.Group).delete_attribute('value');
        if (kind === 'dimensions') {
          const node = root.get('FORCE_PLATFORM/CHANNEL') as h5.Group;
          node.delete_attribute('value');
          node.create_attribute('value', new Float64Array(24), [3, 8]);
        }
        if (kind === 'units') {
          const node = root.get('POINT/UNITS') as h5.Group;
          node.delete_attribute('value');
          node.create_attribute('value', ['cm']);
        }
      });
      const plan = conversionPlan(input, 'C3D');
      expect(plan.plates.every((p) => !p.reused)).toBe(true);
      expect(parseC3D(exportSemanticC3D(input), 'fallback.c3d').analogs).toHaveLength(38);
    },
  );
  it('rejects reuse when float32 calibration changes a reconstructed force, while retaining the derived fallback', () => {
    const input = fixture(),
      p = input.forcePlatforms[2],
      definition = p.c3dSource!.definition!;
    definition.calibration![0] = 100000001;
    definition.calibration![6] = -100000000;
    for (const identity of [14, 15])
      input.analogs[identity].signal.values = Float64Array.from(
        { length: 40 },
        (_, i) => (i + 1) / 4,
      );
    p.force = series([1, 3, 120]);
    p.moment = series([1970, 3010, 4200], true);
    p.cop = copSeries([-3010 / 120, 1970 / 120, 0]);
    p.freeMoment = series([0, 0, 4200 + (1970 + 9030) / 120], true);
    const plan = conversionPlan(input, 'C3D');
    expect(plan.plates.map((p) => !!p.reused)).toEqual([true, true, false]);
    expect(plan.report.warnings.join(' ')).toMatch(
      /float32 encoding of original channels differs from stored force/,
    );
    compare(parseC3D(exportSemanticC3D(input), 'precision.c3d'), input);
  });
});

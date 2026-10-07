import { beforeAll, describe, expect, it } from 'vitest';
import * as h5 from 'h5wasm/node';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { physicalFixture } from './helpers/c3d';
import { parseC3D } from '../src/importers/c3d/importer';
import { parseH5Tree } from '../src/importers/h5/schema';
import { exportSemanticC3D } from '../src/exporters/semanticC3D';
import { writeSemanticH5 } from '../src/exporters/semanticH5';
import { conversionPlan } from '../src/exporters/conversion';
import { cropMotionData } from '../src/motion/crop';
import { readParameters, number, nums, strings } from '../src/importers/c3d/parameters';
import { exportC3D } from '../src/exporters/c3d';
import { writeCroppedH5 } from '../src/exporters/h5';
import {
  setData,
  renameSessionMarker,
  undoEdit,
  redoEdit,
  useSession,
  editSessionEvent,
} from '../src/state/session';
import type { MotionData } from '../src/motion/types';
import { explorerDatasets } from '../src/explorer/datasets';
import { cross, mul } from '../src/motion/math';
import type { Vec3 } from '../src/motion/types';

const folder = resolve('.local/cross-format-validation');
let sequence = 0;
beforeAll(async () => {
  await h5.ready;
  mkdirSync(folder, { recursive: true });
});
const source = () => parseC3D(physicalFixture(), 'synthetic.c3d');
function asH5(data: MotionData, name = `semantic-${sequence++}.h5`) {
  const path = resolve(folder, name);
  const output = new h5.File(path, 'w');
  try {
    writeSemanticH5(output, data);
    return parseH5Tree(output, name);
  } finally {
    output.close();
  }
}
function compareValues(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 1e-5) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    if (Number.isNaN(expected[i])) expect(actual[i]).toBeNaN();
    else
      expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(
        tolerance + Math.abs(expected[i]) * 1e-6,
      );
  }
}
function compareScience(actual: MotionData, expected: MotionData) {
  expect(actual.timeline).toEqual(expected.timeline);
  expect(actual.markers.labels).toEqual(expected.markers.labels);
  expect(actual.markers.valid).toEqual(expected.markers.valid);
  compareValues(actual.markers.positions, expected.markers.positions);
  expected.analogs.forEach((a, i) => {
    expect(actual.analogs[i].name).toBe(a.name);
    expect(actual.analogs[i].unit).toBe(a.unit);
    expect(actual.analogs[i].signal.rate).toBe(a.signal.rate);
    compareValues(actual.analogs[i].signal.values, a.signal.values);
  });
  expect(actual.events).toHaveLength(expected.events.length);
  actual.events.forEach((e, i) => {
    expect(e.label).toBe(expected.events[i].label);
    expect(e.context).toBe(expected.events[i].context);
    expect(e.time).toBeCloseTo(expected.events[i].time, 6);
  });
  expect(actual.forcePlatforms.length).toBe(expected.forcePlatforms.length);
  actual.forcePlatforms.forEach((p, i) => {
    const original = expected.forcePlatforms[i];
    expect(p.name).toBe(original.name);
    expect(p.coordinateFrame).toBe('global');
    for (const key of ['force', 'moment', 'cop', 'freeMoment', 'corners'] as const) {
      expect(p[key]).toBeDefined();
      compareValues(p[key]!.values, original[key]!.values, key === 'cop' ? 1e-3 : 1e-5);
    }
  });
}

describe('semantic cross-format conversion', () => {
  it('writes current institute H5: mm positions, N forces, Nmm moments, absolute clocks and nonzero source frames', () => {
    const input = source();
    const actual = asH5(input, 'synthetic-from-c3d.h5');
    compareScience(actual, input);
    compareValues(actual.markers.residuals!, input.markers.residuals!, 0);
    expect(actual.source.h5Layout).toBe('institute-current');
    expect(actual.source.eventSchema).toBe('institute-current');
    expect(actual.timeline.firstFrame).toBe(36);
    expect(actual.source.timeOrigin).toBe(0.18);
    const file = new h5.File(resolve(folder, 'synthetic-from-c3d.h5'), 'r');
    try {
      const plate = file.get('ForcePlates/0') as h5.Group;
      expect(plate.attrs.unit_moment.value).toBe('Nmm');
      const moment = file.get('ForcePlates/0/Moment') as h5.Dataset;
      expect(Number((moment.value as Float64Array)[0])).toBeCloseTo(
        input.forcePlatforms[0].moment.values[0] * 1000,
      );
      expect((file.get('Trajectories/Labeled/Data') as h5.Dataset).shape).toEqual([1, 4, 400]);
      expect(file.get('MetaData/C3DParameters')).toBeNull();
      expect((file.get('Events/Frame') as h5.Dataset).metadata.type).toBe(0);
    } finally {
      file.close();
    }
  });
  it('writes independently reconstructible derived TYPE-2 C3D with identity scaling and preserves science', () => {
    const input = asH5(source());
    const bytes = exportSemanticC3D(input);
    const actual = parseC3D(bytes, 'converted.c3d');
    compareScience(actual, input);
    expect(actual.analogs.length).toBe(input.analogs.length + 6);
    const { params } = readParameters(new DataView(bytes));
    expect(strings(params, 'POINT:UNITS')).toEqual(['mm']);
    expect(nums(params, 'FORCE_PLATFORM:TYPE')).toEqual([2]);
    expect(nums(params, 'FORCE_PLATFORM:ORIGIN')).toEqual([0, 0, 0]);
    expect(nums(params, 'FORCE_PLATFORM:CHANNEL')).toEqual([7, 8, 9, 10, 11, 12]);
    expect(number(params, 'ANALOG:GEN_SCALE', 0)).toBe(1);
    expect(nums(params, 'ANALOG:SCALE').every((v) => v === 1)).toBe(true);
    writeFileSync(resolve(folder, 'synthetic-derived.c3d'), new Uint8Array(bytes));
  });
  it('preserves tilted plates and lab axes without exporting render coordinates', () => {
    const input = source();
    const turn = (values: Float32Array | Float64Array) => {
      for (let i = 0; i < values.length; i += 3) {
        const [x, y, z] = values.subarray(i, i + 3);
        values.set([y, z, x], i);
      }
    };
    turn(input.markers.positions);
    for (const key of ['force', 'moment', 'cop', 'freeMoment', 'corners'] as const)
      turn(input.forcePlatforms[0][key]!.values);
    const hdf = asH5(input, 'synthetic-tilted.h5');
    const bytes = exportSemanticC3D(hdf);
    compareScience(parseC3D(bytes, 'tilted.c3d'), hdf);
    writeFileSync(resolve(folder, 'synthetic-tilted.c3d'), new Uint8Array(bytes));
  });
  it('preserves oblique plate axes through float32 geometry and wrench encoding', () => {
    const input = source();
    const turn = (values: Float32Array | Float64Array) => {
      const yaw = 0.3,
        pitch = 0.4;
      for (let i = 0; i < values.length; i += 3) {
        const [x, y, z] = values.subarray(i, i + 3);
        const yy = Math.cos(pitch) * y - Math.sin(pitch) * z;
        values.set(
          [
            Math.cos(yaw) * x - Math.sin(yaw) * yy,
            Math.sin(yaw) * x + Math.cos(yaw) * yy,
            Math.sin(pitch) * y + Math.cos(pitch) * z,
          ],
          i,
        );
      }
    };
    turn(input.markers.positions);
    for (const key of ['force', 'moment', 'cop', 'freeMoment', 'corners'] as const)
      turn(input.forcePlatforms[0][key]!.values);
    const hdf = asH5(input, 'synthetic-oblique.h5');
    const bytes = exportSemanticC3D(hdf);
    compareScience(parseC3D(bytes, 'oblique.c3d'), hdf);
    writeFileSync(resolve(folder, 'synthetic-oblique.c3d'), new Uint8Array(bytes));
  });
  it('creates force acquisition channels even when H5 has no general analog channels', () => {
    const input = asH5(source());
    input.analogs = [];
    const actual = parseC3D(exportSemanticC3D(input), 'force-only.c3d');
    compareScience(actual, input);
    expect(actual.analogs).toHaveLength(6);
  });
  it('uses current renamed, edited, undo/redo and cropped state for both targets without changing history', () => {
    setData(source());
    renameSessionMarker(0, 'Edited');
    undoEdit();
    redoEdit();
    editSessionEvent('update', 0, {
      label: 'Changed',
      context: 'Left',
      time: 0.45,
      description: 'Edited description',
    });
    const state = useSession.getState();
    const cut = cropMotionData(state.data!, 40, 100);
    const actualH5 = asH5(cut, 'synthetic-edited.h5');
    expect(actualH5.markers.labels).toEqual(['Edited']);
    expect(actualH5.timeline.firstFrame).toBe(76);
    expect(actualH5.events[0].label).toBe('Changed');
    expect(actualH5.events[0].time).toBeCloseTo(0.25);
    const bytes = exportSemanticC3D(actualH5);
    compareScience(parseC3D(bytes, 'edited.c3d'), actualH5);
    expect(useSession.getState().data).toBe(state.data);
    expect(useSession.getState().history).toBe(state.history);
    expect(useSession.getState().dirty).toBe(state.dirty);
    const datasets = explorerDatasets(parseC3D(bytes, 'edited.c3d'));
    expect(datasets.find((d) => d.name === 'Edited')).toBeDefined();
    writeFileSync(resolve(folder, 'synthetic-edited.c3d'), new Uint8Array(bytes));
  });
  it('retains same-format no-op byte identity and existing H5 source-tree serialization', () => {
    const original = physicalFixture();
    expect(new Uint8Array(exportC3D(original, 0, 400))).toEqual(new Uint8Array(original));
    const input = new h5.File(resolve(folder, 'synthetic-from-c3d.h5'), 'r');
    const output = new h5.File(resolve(folder, 'same-format.h5'), 'w');
    try {
      writeCroppedH5(h5, input, output, 0, 400);
      compareScience(parseH5Tree(output, 'same.h5'), parseH5Tree(input, 'input.h5'));
    } finally {
      output.close();
      input.close();
    }
    expect(conversionPlan(source(), 'C3D').report).toMatchObject({
      sameFormat: true,
      errors: [],
      warnings: [],
    });
  });
  it('handles one-frame trials and no analogs/plates/events', () => {
    const input = cropMotionData(source(), 0, 1);
    input.analogs = [];
    input.forcePlatforms = [];
    input.events = [];
    const hdf = asH5(input);
    compareScience(parseC3D(exportSemanticC3D(hdf), 'one.c3d'), hdf);
  });
  it('preserves extended source frames using TRIAL fields', () => {
    const input = source();
    input.timeline.firstFrame = 80000;
    const hdf = asH5(input, 'synthetic-extended.h5');
    const actual = parseC3D(exportSemanticC3D(hdf), 'extended.c3d');
    expect(actual.timeline.firstFrame).toBe(80000);
    expect(actual.events[0].time).toBeCloseTo(input.events[0].time, 5);
    writeFileSync(
      resolve(folder, 'synthetic-extended.c3d'),
      new Uint8Array(exportSemanticC3D(hdf)),
    );
  });
  it('preserves Unicode labels and standard event descriptions/subjects', () => {
    const input = source();
    input.markers.labels = ['Märkér'];
    input.events[0].description = '  meaningful description  ';
    input.events[0].subject = 'Synthetic';
    const actual = parseC3D(exportSemanticC3D(asH5(input)), 'unicode.c3d');
    expect(actual.markers.labels).toEqual(['Märkér']);
    expect(actual.events[0].description).toBe('meaningful description');
    expect(conversionPlan(asH5(input), 'C3D').report.warnings.join(' ')).toMatch(/whitespace/);
    expect(actual.events[0].subject).toBe('Synthetic');
  });
  it('explicitly reports float32/residual precision, retains invalid points, and flags unknown residuals', () => {
    const input = asH5(source());
    input.markers.residuals![0] = NaN;
    const plan = conversionPlan(input, 'C3D');
    expect(plan.report.warnings.join(' ')).toMatch(/precision.*Unknown residual/s);
    const actual = parseC3D(exportSemanticC3D(input), 'quality.c3d');
    expect(actual.markers.valid).toEqual(input.markers.valid);
    expect(actual.markers.residuals![0]).toBe(0);
    expect(actual.markers.residuals![123]).toBe(-1);
  });
  it('maps supported subject metadata and never includes a local filesystem path in fresh H5 provenance', () => {
    const input = source();
    input.name = 'C:\\private\\synthetic.c3d';
    input.source.info = {
      subject: { id: { values: ['Synthetic ID'] }, mass: { values: ['75'], unit: 'kg' } },
      provenance: { sourcePath: { values: ['C:\\private\\file.c3d'] } },
    };
    const hdf = asH5(input);
    expect(hdf.source.info?.subject?.id?.values).toEqual(['Synthetic ID']);
    expect(hdf.source.info?.provenance?.originalFiles?.values).toEqual(['synthetic.c3d']);
    expect(hdf.source.info?.provenance?.sourcePath).toBeUndefined();
    const actual = parseC3D(exportSemanticC3D(hdf), 'subject.c3d');
    expect(actual.source.info?.subject?.mass).toEqual({ values: ['75'], unit: 'kg' });
  });
  it('embeds imported H5 project, file, location, coordinates and full subject metadata in C3D parameters', () => {
    const name = 'synthetic-metadata.h5';
    asH5(source(), name);
    const file = new h5.File(resolve(folder, name), 'a');
    let input: MotionData;
    try {
      const project = file.get('MetaData/Project') as h5.Group;
      for (const [key, value] of Object.entries({
        Project: 'Synthetic motion study',
        ProjectPI: 'Synthetic investigator',
        SubjectID: ['SYN-1', 'SYN-2'],
        SubjectGroup: ['Control', 'Repeat'],
        Age: ['25', '26'],
        Sex: ['F', 'M'],
        BodyHeight: ['175', '180'],
        BodyHeightUnit: 'cm',
        BodyMass: ['70', '75'],
        BodyMassUnit: 'kg',
        Condition: 'Ä long condition 🧪 '.repeat(80),
      }))
        project.create_attribute(key, value);
      const fileInfo = file.get('MetaData/FileInfo') as h5.Group;
      for (const [key, value] of Object.entries({
        PathFile: 'C:\\synthetic\\recording.h5',
        FileCreationLocal: '2026-10-06 10:00:00',
        FileCreationUTC: '2026-10-06T08:00:00Z',
        LastUpdate: '2026-10-06T09:00:00Z',
      }))
        fileInfo.create_attribute(key, value);
      const location = (file.get('MetaData') as h5.Group).create_group('Location');
      location.create_attribute('Lat', 52.5);
      location.create_attribute('Lon', 13.4);
      (file.get('Trajectories') as h5.Group).create_attribute(
        'GlobalCoordinateSystem',
        'X anterior, Y left, Z up',
      );
      input = parseH5Tree(file, name);
    } finally {
      file.close();
    }
    const before = structuredClone(input.source.info);
    const plan = conversionPlan(input, 'C3D');
    expect(plan.report.warnings.join(' ')).not.toMatch(
      /Project\/file\/location metadata|Subject group, multi-valued demographics/,
    );
    expect(plan.report.included).toContain('Recording and subject metadata in C3D parameters');
    const bytes = exportSemanticC3D(input);
    const { params } = readParameters(new DataView(bytes));
    expect(strings(params, 'JE_METADATA:VERSION')).toEqual(['1']);
    expect(JSON.parse(strings(params, 'JE_METADATA:PROJECT').join(''))).toEqual(
      before?.provenance?.project,
    );
    const actual = parseC3D(bytes, 'metadata.c3d');
    for (const key of ['created', 'subject', 'provenance', 'location', 'coordinateSystem'] as const)
      expect(actual.source.info?.[key]).toEqual(before?.[key]);
    compareScience(actual, input);
    expect(input.source.info).toEqual(before);
    const cropped = parseC3D(exportC3D(bytes, 5, 15, actual.events), 'metadata-crop.c3d');
    expect(cropped.source.info).toEqual(actual.source.info);
    writeFileSync(resolve(folder, 'synthetic-metadata.c3d'), new Uint8Array(bytes));
  });
});

describe('compatibility and loss guards', () => {
  it('retains slightly irregular surveyed corners without geometry warnings and preserves reconstructed science', () => {
    const input = source(),
      p = input.forcePlatforms[0];
    // Corner 2 does not define the axes: its perturbation moves the centroid only.
    p.corners!.values[6] += 1;
    p.corners!.values[7] -= 1;
    p.corners!.values[8] += 0.5;
    const shift: Vec3 = [0.25, -0.25, 0.125];
    for (let i = 0; i < p.cop.values.length; i++) p.cop.values[i] += shift[i % 3];
    const hdf = asH5(input, 'synthetic-surveyed-corners.h5');
    const originalCorners = hdf.forcePlatforms[0].corners!.values.slice();
    const plan = conversionPlan(hdf, 'C3D');
    expect(plan.plates).toHaveLength(1);
    expect(plan.report.warnings.join(' ')).not.toMatch(/corners|geometry/i);
    const bytes = exportSemanticC3D(hdf);
    const actual = parseC3D(bytes, 'surveyed.c3d');
    compareScience(actual, hdf);
    expect(actual.forcePlatforms[0].corners!.values).toEqual(originalCorners);
    expect(hdf.forcePlatforms[0].corners!.values).toEqual(originalCorners);
    writeFileSync(resolve(folder, 'synthetic-surveyed-corners.c3d'), new Uint8Array(bytes));
  });
  it.each(['angle', 'midpoints', 'plane', 'crossed', 'duplicate', 'nonfinite'] as const)(
    'rejects %s corner geometry rather than silently changing measured corners',
    (kind) => {
      const input = asH5(source()),
        p = input.forcePlatforms[0],
        corners = p.corners!.values;
      if (kind === 'angle') {
        const shift = 200 * Math.tan((2 * Math.PI) / 180);
        corners[0] += shift;
        corners[3] += shift;
      }
      if (kind === 'midpoints') {
        for (let i = 1; i < corners.length; i += 3) corners[i] *= 4.5;
        corners[6] += 5;
        corners[9] -= 5;
      }
      if (kind === 'plane') corners[8] = 1.01;
      if (kind === 'crossed') {
        const saved = corners.slice(3, 6);
        corners.set(corners.subarray(6, 9), 3);
        corners.set(saved, 6);
      }
      if (kind === 'duplicate') corners.set(corners.subarray(3, 6), 6);
      if (kind === 'nonfinite') corners[6] = NaN;
      const original = corners.slice();
      const plan = conversionPlan(input, 'C3D');
      expect(plan.plates).toHaveLength(0);
      expect(plan.report.warnings.join(' ')).toMatch(
        /Force platform.*omitted:.*(geometry|order|nonfinite)/,
      );
      expect(corners).toEqual(original);
    },
  );
  it('accepts small geometry errors at the chosen limits and keeps them invariant under lab translation', () => {
    const input = asH5(source()),
      p = input.forcePlatforms[0];
    p.corners!.values[8] = 0.999;
    expect(conversionPlan(input, 'C3D').plates).toHaveLength(1);
    for (let i = 0; i < p.corners!.values.length; i += 3) {
      p.corners!.values[i] += 100000;
      p.corners!.values[i + 1] -= 100000;
    }
    expect(conversionPlan(input, 'C3D').plates).toHaveLength(1);
  });
  it('omits plate geometry that degenerates in float32 and moving pose metadata', () => {
    const input = asH5(source());
    for (let i = 0; i < input.forcePlatforms[0].corners!.values.length; i += 3)
      input.forcePlatforms[0].corners!.values[i] += 1e12;
    expect(conversionPlan(input, 'C3D').plates).toHaveLength(0);
    const moving = asH5(source());
    moving.forcePlatforms[0].position = {
      values: new Float64Array([0, 0, 0, 1, 0, 0]),
      components: 3,
      rate: 1,
      startTime: 0,
    };
    expect(conversionPlan(moving, 'C3D').report.warnings.join(' ')).toMatch(/moving position/);
  });
  it('preserves long units, whitespace, Unicode and multi-record metadata without truncation', () => {
    const input = asH5(source());
    input.source.info!.subject = {
      mass: { values: ['75'], unit: 'X'.repeat(256) },
      name: { values: ['  Synthetic\t🧪\nname\0  '] },
      condition: {
        values: ['X'.repeat(33000), ...Array.from({ length: 260 }, (_, i) => `Value ${i}`)],
      },
    };
    input.source.info!.manufacturer = 'Synthetic instruments';
    input.source.info!.software = 'Synthetic recorder 1.0';
    const bytes = exportSemanticC3D(input);
    const { params } = readParameters(new DataView(bytes));
    expect(params.has('SUBJECT:BODYMASS')).toBe(false);
    expect(params.has('JE_METADATA:SUBJECT_CONDITION2')).toBe(true);
    const actual = parseC3D(bytes, 'subject.c3d');
    expect(actual.source.info?.subject).toEqual(input.source.info!.subject);
    expect(actual.source.info?.manufacturer).toBe('Synthetic instruments');
    expect(actual.source.info?.software).toBe('Synthetic recorder 1.0');
  });
  it('rejects metadata exceeding the C3D parameter section capacity instead of truncating it', () => {
    const input = asH5(source());
    input.source.info!.subject = { condition: { values: ['X'.repeat(131000)] } };
    expect(() => exportSemanticC3D(input)).toThrow(/parameter section exceeds 255 blocks/);
  });
  it.each(['offset', 'irregular', 'count', 'ratio', 'different-rate'] as const)(
    'blocks %s analog clocks without resampling',
    (kind) => {
      const input = asH5(source());
      const s = input.analogs[0].signal;
      if (kind === 'offset') s.times = s.times!.map((t) => t + 0.001);
      if (kind === 'irregular') s.times![4] += 0.00001;
      if (kind === 'count') s.values = s.values.slice(1);
      if (kind === 'ratio') s.rate = 333;
      if (kind === 'different-rate') s.rate = 4000;
      expect(conversionPlan(input, 'C3D').report.errors.length).toBeGreaterThan(0);
      expect(() => exportSemanticC3D(input)).toThrow(/Analog/);
    },
  );
  it.each(['moving', 'unresolved', 'clock', 'nonfinite'] as const)(
    'reports and omits a %s unsupported force plate',
    (kind) => {
      const input = asH5(source()),
        p = input.forcePlatforms[0];
      if (kind === 'moving')
        p.corners!.values = Float64Array.from([...p.corners!.values, ...p.corners!.values]);
      if (kind === 'unresolved') p.coordinateFrame = 'unresolved';
      if (kind === 'clock') p.force.times![0] += 0.0001;
      if (kind === 'nonfinite') p.force.values[0] = Infinity;
      const plan = conversionPlan(input, 'C3D');
      expect(plan.plates).toHaveLength(0);
      expect(plan.report.warnings.join(' ')).toMatch(/Force platform.*omitted/);
      expect(parseC3D(exportSemanticC3D(input), 'safe.c3d').forcePlatforms).toHaveLength(0);
    },
  );
  it('exports the unchanged wrench with reconstructed COP/free moment and warns about corrected stored values', () => {
    const baseline = asH5(source());
    const input = source(),
      p = input.forcePlatforms[0];
    const delta: Vec3 = [10, -5, 0];
    for (let i = 0; i < p.cop.values.length; i += 3) {
      const adjustment = mul(
        cross(Array.from(p.force.values.subarray(i, i + 3)) as Vec3, delta),
        0.001,
      );
      for (let axis = 0; axis < 3; axis++) {
        p.cop.values[i + axis] += delta[axis];
        p.freeMoment!.values[i + axis] += adjustment[axis];
      }
    }
    const hdf = asH5(input, 'synthetic-corrected-cop.h5');
    const copBefore = hdf.forcePlatforms[0].cop.values.slice();
    const freeBefore = hdf.forcePlatforms[0].freeMoment!.values.slice();
    const plan = conversionPlan(hdf, 'C3D');
    expect(plan.report.errors).toEqual([]);
    expect(plan.plates).toHaveLength(1);
    expect(plan.report.warnings.join(' ')).toMatch(
      /stored COP is inconsistent.*4000 samples.*11.18 mm.*Stored COP is omitted.*reconstruct COP/s,
    );
    expect(plan.report.warnings.join(' ')).toMatch(
      /stored free moment.*omitted.*reconstructed COP/s,
    );
    expect(plan.report.warnings.join(' ')).not.toMatch(/Force platform.*omitted:/);
    const bytes = exportSemanticC3D(hdf);
    const actual = parseC3D(bytes, 'corrected.c3d');
    compareScience(actual, baseline);
    expect(hdf.forcePlatforms[0].cop.values).toEqual(copBefore);
    expect(hdf.forcePlatforms[0].freeMoment!.values).toEqual(freeBefore);
    writeFileSync(resolve(folder, 'synthetic-corrected-cop.c3d'), new Uint8Array(bytes));
  });
  it.each(['COP', 'free-moment', 'derived-clock', 'scalar-free'] as const)(
    'retains force/moment and warns about omitted %s derived data',
    (kind) => {
      const input = asH5(source()),
        p = input.forcePlatforms[0];
      if (kind === 'COP') p.cop.values[0] = NaN;
      if (kind === 'free-moment') p.freeMoment!.values[2] += 100;
      if (kind === 'derived-clock') {
        p.cop.times = p.cop.times!.slice();
        p.freeMoment!.times = p.freeMoment!.times!.slice();
        p.cop.times![0] += 0.0001;
        p.freeMoment!.times![0] += 0.0001;
      }
      if (kind === 'scalar-free')
        p.freeMoment = {
          ...p.freeMoment!,
          components: 1,
          values: new Float64Array(p.force.values.length / 3),
        };
      const plan = conversionPlan(input, 'C3D');
      expect(plan.plates).toHaveLength(1);
      expect(plan.report.errors).toEqual([]);
      expect(plan.report.warnings.join(' ')).toMatch(
        /stored (COP|free moment).*omitted from the exported C3D/s,
      );
      const actual = parseC3D(exportSemanticC3D(input), 'derived.c3d');
      expect(actual.forcePlatforms).toHaveLength(1);
      compareValues(actual.forcePlatforms[0].force.values, p.force.values);
      compareValues(actual.forcePlatforms[0].moment.values, p.moment.values);
    },
  );
  it('exports zero-load samples with undefined reconstructed COP instead of requiring finite stored COP', () => {
    const input = asH5(source()),
      p = input.forcePlatforms[0];
    p.force.values.fill(0, 0, 3);
    p.moment.values.fill(0, 0, 3);
    expect(conversionPlan(input, 'C3D').report.warnings.join(' ')).toMatch(/stored COP.*omitted/s);
    const actual = parseC3D(exportSemanticC3D(input), 'zero-load.c3d').forcePlatforms[0];
    expect(Array.from(actual.force.values.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(actual.cop.values.subarray(0, 3)).every(Number.isNaN)).toBe(true);
  });
  it('reports richer H5 body/model/metadata loss, exports unmapped compatible EMG once, and preserves mapped analogs once', () => {
    const input = asH5(source());
    input.rigidBodies = [
      { name: 'Synthetic body', markers: ['A'], position: input.forcePlatforms[0].cop },
    ];
    input.source.info!.modelResults = { ik: { variables: 2 }, id: { variables: 3 } };
    input.signals = [
      {
        name: input.analogs[0].name,
        group: 'EMG',
        unit: input.analogs[0].unit,
        signal: input.analogs[0].signal,
        analogIndex: 0,
      },
      { name: 'Dedicated EMG', group: 'EMG', unit: 'V', signal: input.analogs[1].signal },
    ];
    const plan = conversionPlan(input, 'C3D');
    expect(plan.analogs).toHaveLength(input.analogs.length + 1);
    expect(plan.report.warnings.join(' ')).toMatch(
      /rigid bodies omitted.*IK results.*ID results/is,
    );
    const actual = parseC3D(exportSemanticC3D(input), 'emg.c3d');
    expect(actual.analogs.filter((a) => a.name === 'Dedicated EMG')).toHaveLength(1);
    expect(actual.rigidBodies).toBeUndefined();
  });
  it('reports independent EMG samples that cannot fit a C3D analog grid', () => {
    const input = asH5(source());
    input.signals = [
      {
        name: 'Independent',
        group: 'EMG',
        unit: 'V',
        signal: { ...input.analogs[0].signal, startTime: 0.5, times: undefined },
      },
    ];
    expect(conversionPlan(input, 'C3D').report.warnings.join(' ')).toMatch(
      /EMG Independent omitted/,
    );
  });
  it('blocks overlong event/marker fields, incompatible point rates and excessive analog counts before writing', () => {
    const input = asH5(source());
    input.markers.labels = ['X'.repeat(256)];
    expect(() => exportSemanticC3D(input)).toThrow(/marker labels/);
    input.markers.labels = ['A'];
    input.events[0].description = 'X'.repeat(256);
    expect(() => exportSemanticC3D(input)).toThrow(/events/);
    input.events = [];
    input.timeline.rate = 200.1;
    expect(() => exportSemanticC3D(input)).toThrow(/Point rate/);
    input.timeline.rate = 200;
    input.analogs = Array.from({ length: 256 }, (_, i) => ({
      ...input.analogs[0],
      name: `Channel ${i}`,
    }));
    expect(() => exportSemanticC3D(input)).toThrow(/capacity/);
  });
});

it.skipIf(
  process.env.JE_VALIDATE_REFERENCE !== '1' ||
    !existsSync(resolve('reference-data/authoritative_reference.h5')),
)('reuses authoritative plate definitions and analogs, preserving corrected COP read-only', () => {
  const file = new h5.File(resolve('reference-data/authoritative_reference.h5'), 'r');
  try {
    const input = parseH5Tree(file, 'authoritative_reference.h5');
    const plan = conversionPlan(input, 'C3D');
    expect(plan.report.errors.length === 0, 'compatible recording').toBe(true);
    expect(
      plan.plates.length === input.forcePlatforms.length,
      'all source plates are retained',
    ).toBe(true);
    expect(
      plan.plates.every((p) => p.reused),
      'all original definitions are reused',
    ).toBe(true);
    expect(
      /stored COP|stored free moment|derived six-axis|cannot be reused|corners|geometry/i.test(
        plan.report.warnings.join(' '),
      ),
      'source plate definitions need no force-loss or geometry warnings',
    ).toBe(false);
    const bytes = exportSemanticC3D(input);
    const actual = parseC3D(bytes, 'reused.c3d');
    expect(
      actual.analogs.length === input.analogs.length,
      'all source analog channels are retained',
    ).toBe(true);
    const { params } = readParameters(new DataView(bytes));
    expect(
      isDeepStrictEqual(
        nums(params, 'FORCE_PLATFORM:TYPE'),
        input.forcePlatforms.map((p) => p.c3dSource!.definition!.type),
      ),
      'original plate types are retained',
    ).toBe(true);
    expect(
      isDeepStrictEqual(params.get('FORCE_PLATFORM:CHANNEL')?.dimensions, [
        Math.max(...input.forcePlatforms.map((p) => p.c3dSource!.definition!.channels.length)),
        input.forcePlatforms.length,
      ]),
      'original channel dimensions are retained',
    ).toBe(true);
    const polynomial = input.forcePlatforms.flatMap((p) =>
      Array.from(p.c3dSource!.definition!.copPolynomial ?? new Float64Array(12)),
    );
    expect(
      isDeepStrictEqual(nums(params, 'FORCE_PLATFORM:FPCOPPOLY'), polynomial.map(Math.fround)),
      'original COP correction parameters are retained',
    ).toBe(true);
    for (const [index, original] of input.forcePlatforms.entries()) {
      const plate = actual.forcePlatforms.find((p) => p.name === original.name);
      expect(Boolean(plate), `source plate ${index}: retained`).toBe(true);
      for (const key of ['force', 'moment'] as const)
        expect(
          plate![key].values.every(
            (v, i) =>
              Math.abs(v - original[key].values[i]) <=
              1e-5 + Math.abs(original[key].values[i]) * 1e-6,
          ),
          `source plate ${index}: ${key} values`,
        ).toBe(true);
      expect(
        plate!.corners!.values.every((v, i) => v === Math.fround(original.corners!.values[i])),
        `source plate ${index}: original corner coordinates and order`,
      ).toBe(true);
      for (const key of ['cop', 'freeMoment'] as const)
        expect(
          plate![key]!.values.every(
            (v, i) =>
              (Number.isNaN(v) && Number.isNaN(original[key]!.values[i])) ||
              Math.abs(v - original[key]!.values[i]) <=
                (key === 'cop' ? 1e-3 : 1e-5) + Math.abs(original[key]!.values[i]) * 1e-6,
          ),
          `source plate ${index}: ${key} values`,
        ).toBe(true);
    }
    // Contains private measurements; ignored local output only, never a fixture.
    writeFileSync(resolve('.local/authoritative-force-export.c3d'), new Uint8Array(bytes));
  } finally {
    file.close();
  }
});

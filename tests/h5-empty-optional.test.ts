import { beforeAll, expect, it } from 'vitest';
import * as h5 from 'h5wasm/node';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseH5Tree } from '../src/importers/h5/schema';
import { writeCroppedH5 } from '../src/exporters/h5';
import { writeSemanticH5 } from '../src/exporters/semanticH5';
import { exportSemanticC3D } from '../src/exporters/semanticC3D';
import { conversionPlan } from '../src/exporters/conversion';
import { parseC3D } from '../src/importers/c3d/importer';
import { cropMotionData } from '../src/motion/crop';
import { dataSections } from '../src/components/dataSections';
import { fileInfoSections } from '../src/components/fileInfoSections';
import { explorerDatasets } from '../src/explorer/datasets';
import { setData, renameSessionMarker, undoEdit, redoEdit, useSession } from '../src/state/session';

const folder = resolve('.local/empty-h5-validation');
let sequence = 0;
beforeAll(async () => {
  await h5.ready;
  mkdirSync(folder, { recursive: true });
});
function synthetic(action: (file: h5.File) => void) {
  const file = new h5.File(resolve(folder, `synthetic-${sequence++}.h5`), 'w');
  try {
    file.create_group('MetaData').create_group('Project');
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 100);
    const labeled = trajectories.create_group('Labeled');
    labeled.create_attribute('Labels', ['Synthetic marker']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({ name: 'Data', shape: [1, 4, 3], data: new Float64Array(12) });
    action(file);
  } finally {
    file.close();
  }
}
function numeric(group: h5.Group, name: string, shape: number[], values?: number[]) {
  return group.create_dataset({
    name,
    shape,
    data: values ? Float64Array.from(values) : new Float64Array(shape.reduce((a, b) => a * b, 1)),
    dtype: '<d',
  });
}
function channels(
  file: h5.File,
  name: string,
  shape: number[],
  labels?: string[],
  units?: string[],
  rate?: number,
) {
  const group = file.create_group(name);
  numeric(group, 'Data', shape);
  if (labels)
    group.create_attribute(
      'Labels',
      labels.length ? labels : new Float64Array(0),
      [labels.length],
      labels.length ? 'S' : '<d',
    );
  if (units)
    group.create_attribute(
      'Units',
      units.length ? units : new Float64Array(0),
      [units.length],
      units.length ? 'S' : '<d',
    );
  if (rate !== undefined) group.create_attribute('SamplingFrequency', rate);
  return group;
}
function unavailable(file: h5.File) {
  const data = parseH5Tree(file, 'synthetic.h5');
  expect(data.analogs).toEqual([]);
  expect(data.signals).toEqual([]);
  expect(data.rigidBodies).toEqual([]);
  expect(data.forcePlatforms).toEqual([]);
  expect(data.events).toEqual([]);
  expect(data.warnings).toEqual([]);
  expect(data.timeline.frameCount).toBe(3);
  expect(dataSections(data).map((s) => s.name)).toEqual(['Markers']);
  expect(
    explorerDatasets(data)
      .filter((d) => d.path[0] !== 'Metadata')
      .map((d) => d.path[0]),
  ).toEqual(['Trajectories']);
  return data;
}

it('imports zero-channel EMG with zero-length typed Labels from h5wasm', () => {
  synthetic((file) => {
    const emg = file.create_group('EMG');
    for (const key of ['Labels', 'Units', 'Channels'])
      emg.create_attribute(key, new Float64Array(0), [0], '<d');
    emg.create_dataset({ name: 'Data', shape: [0, 0], data: new Float64Array(0) });
    const data = parseH5Tree(file, 'synthetic.h5');
    expect(data.signals).toEqual([]);
    expect(data.warnings).toEqual([]);
  });
});

it('imports absent optional categories and empty descriptive metadata', () => {
  synthetic((file) => {
    const project = file.get('MetaData/Project') as h5.Group;
    project.create_attribute('SubjectID', '');
    project.create_attribute('BodyMass', new Float64Array(0), [0], '<d');
    const meta = file.get('MetaData') as h5.Group;
    meta.create_group('FileInfo').create_attribute('OriginalFiles', new Float64Array(0), [0], '<d');
    const location = meta.create_group('Location');
    location.create_attribute('Lat', 'Unknown');
    location.create_attribute('Lon', '');
    const data = unavailable(file);
    expect(data.source.info?.subject?.id).toBeUndefined();
    expect(data.source.info?.subject?.mass).toBeUndefined();
    expect(data.source.info?.location?.latitude).toBeUndefined();
    expect(fileInfoSections(data).some((s) => s.title === 'Location')).toBe(false);
  });
});

it.each(['Analog', 'EMG', 'IKResults', 'IDResults'])(
  '%s accepts an empty group, zero channels, and zero samples without pseudo-signals',
  (name) => {
    for (const form of ['group', 'zero channels', 'retained grid', 'zero samples'])
      synthetic((file) => {
        if (form === 'group') file.create_group(name);
        else if (form === 'zero channels') channels(file, name, [0, 0], []);
        else if (form === 'retained grid') {
          const group = channels(file, name, [0, 3]);
          numeric(group, 'Time', [3], [0, 0.01, 0.02]);
        } else channels(file, name, [2, 0], ['A', 'B'], ['V', 'V']);
        const data = unavailable(file);
        if (name === 'EMG' && form !== 'group') expect(data.source.info?.emgChannels).toBe(0);
        expect(data.source.info?.modelResults?.ik).toBeUndefined();
        expect(data.source.info?.modelResults?.id).toBeUndefined();
      });
  },
);

it('keeps genuinely populated EMG, including all-zero recorded samples', () => {
  synthetic((file) => {
    channels(file, 'EMG', [2, 3], ['A', 'B'], ['V', 'mV'], 100);
    const data = parseH5Tree(file, 'synthetic.h5');
    expect(data.signals).toHaveLength(2);
    expect(data.signals![0]).toMatchObject({
      name: 'A',
      unit: 'V',
      signal: { rate: 100, components: 1 },
    });
    expect(data.signals![0].signal.values).toEqual(new Float64Array(3));
    expect(data.source.info?.emgChannels).toBe(2);
    expect(data.warnings).toEqual([]);
  });
});

it.each([
  [
    'too few labels',
    [2, 3],
    ['A'],
    ['V', 'V'],
    100,
    'contains 2 channels but EMG/Labels contains 1 labels',
  ],
  [
    'too many labels',
    [2, 3],
    ['A', 'B', 'C'],
    ['V', 'V'],
    100,
    'contains 2 channels but EMG/Labels contains 3 labels',
  ],
  ['missing labels', [2, 3], undefined, ['V', 'V'], 100, 'EMG/Labels'],
  ['empty string label', [1, 3], [''], ['V'], 100, 'nonempty text'],
  ['rank one empty', [0], [], [], undefined, '[channels,samples]'],
  ['rank three', [1, 1, 3], ['A'], ['V'], 100, '[channels,samples]'],
  ['channels without labels or samples', [2, 0], [], [], undefined, 'EMG/Labels'],
  ['labels without channels', [0, 0], ['A'], [], undefined, 'EMG/Labels'],
  ['missing units', [1, 3], ['A'], undefined, 100, 'EMG/Units'],
  ['mismatched units', [2, 3], ['A', 'B'], ['V'], 100, 'EMG/Units'],
  ['blank units', [1, 3], ['A'], [''], 100, 'EMG/Units'],
  ['missing clock', [1, 3], ['A'], ['V'], undefined, 'Time or SamplingFrequency required'],
  ['invalid rate', [1, 3], ['A'], ['V'], 0, 'sampling rate'],
] as const)('rejects EMG with %s', (_name, shape, labels, units, rate, error) => {
  synthetic((file) => {
    channels(file, 'EMG', [...shape], labels && [...labels], units && [...units], rate);
    expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow(error);
  });
});

it.each(['Analog', 'EMG', 'IKResults', 'IDResults'])(
  '%s rejects inconsistent non-empty data, empty clocks and orphaned metadata',
  (name) => {
    synthetic((file) => {
      channels(file, name, [1, 3], [], ['V'], 100);
      expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow(`${name}/Labels`);
    });
    synthetic((file) => {
      const group = channels(file, name, [1, 3], ['A'], ['V'], 100);
      numeric(group, 'Time', [0]);
      expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow(`${name}/Time`);
    });
    synthetic((file) => {
      const group = file.create_group(name);
      group.create_attribute('Labels', ['A']);
      expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow(`${name}/Labels`);
    });
  },
);

it('validates populated EMG timestamps, channel identities and declared counts', () => {
  for (const field of ['Time', 'Channels', 'NumSamples'])
    synthetic((file) => {
      const group = channels(file, 'EMG', [1, 3], ['A'], ['V'], 100);
      if (field === 'Time') numeric(group, 'Time', [3], [0, 0, 0.02]);
      if (field === 'Channels') group.create_attribute('Channels', new Float64Array([1, 2]));
      if (field === 'NumSamples') group.create_attribute('NumSamples', 4);
      expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow(
        `EMG${field === 'NumSamples' ? '@' : '/'}${field}`,
      );
    });
});

it('accepts empty Events and complete zero-row event columns; rejects partial events', () => {
  synthetic((file) => {
    file.create_group('Events');
    unavailable(file);
  });
  synthetic((file) => {
    const group = file.create_group('Events');
    for (const field of ['Name', 'Description', 'Context', 'Subject'])
      group.create_dataset({ name: field, shape: [0], data: [], dtype: 'S' });
    for (const field of ['Time', 'Frame', 'GenericFlag', 'IconID']) numeric(group, field, [0]);
    unavailable(file);
  });
  synthetic((file) => {
    file
      .create_group('Events')
      .create_dataset({ name: 'Name', shape: [1], data: ['Synthetic'], dtype: 'S' });
    expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow('Missing Description');
  });
});

function plate(file: h5.File, samples: number) {
  const group = file.create_group('ForcePlates').create_group('0');
  for (const field of ['Force', 'Moment', 'COP']) numeric(group, field, [3, samples]);
  if (samples)
    for (const [key, value] of Object.entries({
      SamplingFrequency: 100,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
      CoordinateSystem: 1,
    }))
      group.create_attribute(key, value);
  return group;
}
it('omits empty plate collections and zero-sample plates; rejects inconsistent populated forces', () => {
  synthetic((file) => {
    file.create_group('ForcePlates').create_group('0');
    unavailable(file);
  });
  synthetic((file) => {
    plate(file, 0);
    unavailable(file);
  });
  synthetic((file) => {
    const group = plate(file, 3);
    const root = {
      get: (path: string) =>
        path === 'ForcePlates'
          ? {
              keys: () => ['0'],
              get: () => ({
                attrs: group.attrs,
                get: (field: string) =>
                  field === 'Moment'
                    ? { shape: [3, 2], value: new Float64Array(6) }
                    : group.get(field),
              }),
            }
          : file.get(path),
    };
    expect(() => parseH5Tree(root, 'synthetic.h5')).toThrow('inconsistent vector lengths');
  });
  synthetic((file) => {
    const group = plate(file, 3);
    group.delete_attribute('unit_force');
    expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow('ForcePlates/0');
  });
});
it('omits empty optional plate geometry and rejects malformed populated poses', () => {
  synthetic((file) => {
    const group = plate(file, 3);
    for (const [field, shape] of [
      ['Corners', [3, 4, 0]],
      ['Position', [3, 0]],
      ['Rotation', [3, 3, 0]],
      ['Origin', [3, 0]],
      ['Tz', [3, 0]],
    ] as const)
      numeric(group, field, [...shape]);
    const data = parseH5Tree(file, 'synthetic.h5');
    expect(data.forcePlatforms[0].corners).toBeUndefined();
    expect(data.forcePlatforms[0].position).toBeUndefined();
    expect(data.forcePlatforms[0].rotation).toBeUndefined();
    expect(data.forcePlatforms[0].origin).toBeUndefined();
    expect(data.forcePlatforms[0].freeMoment).toBeUndefined();
    expect(data.warnings).toEqual([]);
  });
  synthetic((file) => {
    numeric(plate(file, 3), 'Position', [2, 3]);
    expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow('Position');
  });
});

it('omits empty rigid bodies and rejects inconsistent populated body positions/rotations', () => {
  synthetic((file) => {
    file.create_group('RigidBodies').create_group('0');
    unavailable(file);
  });
  synthetic((file) => {
    const body = file.create_group('RigidBodies').create_group('0');
    numeric(body, 'Position', [3, 0]);
    numeric(body, 'Rotation', [3, 3, 0]);
    unavailable(file);
  });
  synthetic((file) => {
    const body = file.create_group('RigidBodies').create_group('0');
    numeric(body, 'Position', [0, 3]);
    expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow('Position');
  });
  for (const field of ['Position', 'Rotation'])
    synthetic((file) => {
      const body = file.create_group('RigidBodies').create_group('0');
      body.create_attribute('Unit', 'mm');
      numeric(body, 'Position', field === 'Position' ? [3, 2] : [3, 3]);
      if (field === 'Rotation') numeric(body, field, [3, 2, 3]);
      expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow(field);
    });
});

it('omits empty quality/residual arrays and still rejects populated arrays with wrong axes', () => {
  const empty = [
    ['Residuals', [1, 0]],
    ['Type', [0, 0]],
    ['Virtual', [0]],
    ['CameraMasks', [1, 0, 3]],
    ['CameraMasksKnown', [0]],
  ] as const;
  synthetic((file) => {
    const group = file.get('Trajectories/Labeled') as h5.Group;
    for (const [field, shape] of empty) numeric(group, field, [...shape]);
    const data = unavailable(file);
    expect(data.markers.residuals).toBeUndefined();
    expect(data.markers.quality?.type).toBeUndefined();
    expect(data.markers.quality?.cameraMasks).toBeUndefined();
  });
  for (const [field, shape] of [
    ['Residuals', [1, 2]],
    ['Type', [3, 1]],
    ['Virtual', [2]],
    ['CameraMasks', [1, 2, 2]],
    ['CameraMasksKnown', [2]],
  ] as const)
    synthetic((file) => {
      numeric(file.get('Trajectories/Labeled') as h5.Group, field, [...shape]);
      expect(() => parseH5Tree(file, 'synthetic.h5')).toThrow(field);
    });
});

it.each(['absent', 'zero channels', 'zero samples'])(
  'preserves %s EMG through H5 crop/rename export and editing history',
  (form) => {
    synthetic((file) => {
      if (form === 'zero channels') {
        const group = channels(file, 'EMG', [0, 3]);
        numeric(group, 'Time', [3], [0, 0.01, 0.02]);
      } else if (form === 'zero samples') channels(file, 'EMG', [1, 0], ['A']);
      const data = unavailable(file);
      setData(data, new File([], 'synthetic.h5'));
      renameSessionMarker(0, 'Renamed');
      expect(useSession.getState().dirty).toBe(true);
      undoEdit();
      expect(useSession.getState().data!.markers.labels).toEqual(data.markers.labels);
      redoEdit();
      expect(useSession.getState().data!.markers.labels).toEqual(['Renamed']);
      const output = new h5.File(resolve(folder, `roundtrip-${sequence++}.h5`), 'w');
      try {
        writeCroppedH5(h5, file, output, 1, 3, undefined, data, ['Renamed']);
        const reopened = parseH5Tree(output, 'synthetic.h5');
        expect(reopened.timeline).toEqual(cropMotionData(data, 1, 3).timeline);
        expect(reopened.markers.labels).toEqual(['Renamed']);
        expect(reopened.signals).toEqual([]);
        expect(reopened.warnings).toEqual([]);
        expect(explorerDatasets(reopened).some((d) => d.path[0] === 'EMG')).toBe(false);
        expect(
          fileInfoSections(reopened)
            .flatMap((s) => s.rows)
            .find((r) => r.label === 'EMG channels')?.values ?? ['0'],
        ).toEqual(['0']);
      } finally {
        output.close();
      }
    });
  },
);

it('converts H5 without optional recordings to C3D and back without fabricated channels or false category losses', () => {
  synthetic((file) => {
    for (const name of ['EMG', 'Analog', 'IKResults', 'IDResults']) channels(file, name, [0, 0]);
    const data = unavailable(file);
    const plan = conversionPlan(data, 'C3D');
    expect(plan.report.errors).toEqual([]);
    expect(
      plan.report.warnings.filter((w) => /EMG|rigid|IK results|ID results|force platform/i.test(w)),
    ).toEqual([]);
    const c3d = parseC3D(exportSemanticC3D(data), 'synthetic.c3d');
    expect(c3d.analogs).toEqual([]);
    expect(c3d.forcePlatforms).toEqual([]);
    expect(c3d.events).toEqual([]);
    const output = new h5.File(resolve(folder, `converted-${sequence++}.h5`), 'w');
    try {
      writeSemanticH5(output, c3d);
      expect(output.get('EMG')).toBeNull();
      expect(output.get('Analog')).toBeNull();
      expect(output.get('ForcePlates')).toBeNull();
      const reopened = unavailable(output);
      expect(reopened.markers.positions).toEqual(data.markers.positions);
      expect(reopened.markers.labels).toEqual(data.markers.labels);
    } finally {
      output.close();
    }
  });
});

it('crops the retained marker-frame axis of empty quality arrays without creating samples', () => {
  synthetic((file) => {
    const labeled = file.get('Trajectories/Labeled') as h5.Group;
    numeric(labeled, 'Residuals', [0, 3]);
    numeric(labeled, 'Type', [0, 3]);
    numeric(labeled, 'CameraMasks', [1, 0, 3]);
    const data = unavailable(file);
    const output = new h5.File(resolve(folder, `empty-quality-cropped-${sequence++}.h5`), 'w');
    try {
      writeCroppedH5(h5, file, output, 1, 3, undefined, data);
      const reopened = parseH5Tree(output, 'synthetic.h5');
      expect(reopened.timeline.frameCount).toBe(2);
      expect(reopened.markers.residuals).toBeUndefined();
      expect(reopened.markers.quality?.type).toBeUndefined();
      expect(reopened.markers.quality?.cameraMasks).toBeUndefined();
      expect((output.get('Trajectories/Labeled/CameraMasks') as h5.Dataset).shape).toEqual([
        1, 0, 2,
      ]);
    } finally {
      output.close();
    }
  });
});

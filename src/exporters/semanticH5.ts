import type * as H5 from 'h5wasm';
import type { MotionData, Series } from '../motion/types';
import { requireConversion } from './conversion';

const integer = (group: H5.Group, key: string, value: number) =>
  group.create_attribute(key, BigInt64Array.of(BigInt(value)), [], '<q');

/** Fresh current institute hierarchy from normalized science, not raw C3D
 * parameters. Same-format H5 continues to use the independent preserving writer. */
export function writeSemanticH5(output: H5.File, data: MotionData) {
  requireConversion(data, 'H5');
  const { frameCount: frames, rate, firstFrame } = data.timeline;
  const origin = data.source.timeOrigin ?? firstFrame / rate;
  const ds = (group: H5.Group, name: string, values: Float64Array, shape: number[]) =>
    group.create_dataset({ name, data: values, shape, dtype: '<d' });
  const clock = (group: H5.Group, s: Series) => {
    const n = s.values.length / s.components;
    group.create_attribute('SamplingFrequency', s.rate);
    integer(group, 'NumSamples', n);
    const absolute = (s.times?.[0] ?? s.startTime) + origin;
    // StartFrame is a stream index, not a point index. It is included only when
    // it really is integral; explicit Time remains authoritative.
    const first = absolute * s.rate;
    if (Math.abs(first - Math.round(first)) < 1e-8) {
      integer(group, 'StartFrame', Math.round(first));
      integer(group, 'EndFrame', Math.round(first) + n - 1);
    }
    ds(
      group,
      'Time',
      Float64Array.from(
        { length: n },
        (_, i) => origin + (s.times?.[i] ?? s.startTime + i / s.rate),
      ),
      [n],
    );
  };
  const tensor = (
    group: H5.Group,
    name: string,
    s: Series,
    axes: number[],
    scale = 1,
    corner = false,
  ) => {
    const n = s.values.length / s.components;
    const values = new Float64Array(s.values.length);
    for (let c = 0; c < s.components; c++)
      for (let i = 0; i < n; i++) {
        const component = corner ? (c % 4) * 3 + Math.floor(c / 4) : c;
        values[c * n + i] = s.values[i * s.components + component] * scale;
      }
    ds(group, name, values, [...axes, n]);
  };
  const traj = output.create_group('Trajectories'),
    labeled = traj.create_group('Labeled');
  traj.create_attribute('SamplingFrequency', rate);
  integer(traj, 'NumFrames', frames);
  integer(traj, 'StartFrame', firstFrame);
  integer(traj, 'EndFrame', firstFrame + frames - 1);
  const coordinateSystem = data.source.info?.coordinateSystem;
  if (coordinateSystem) traj.create_attribute('GlobalCoordinateSystem', coordinateSystem);
  labeled.create_attribute('Labels', data.markers.labels);
  labeled.create_attribute('Unit', 'mm');
  labeled.create_attribute(
    'ResidualStatus',
    'Separate residuals; negative values indicate invalid points',
  );
  integer(labeled, 'NumLabeled', data.markers.labels.length);
  const points = new Float64Array(data.markers.labels.length * 4 * frames).fill(NaN);
  const residuals = new Float64Array(data.markers.labels.length * frames);
  for (let m = 0; m < data.markers.labels.length; m++)
    for (let f = 0; f < frames; f++) {
      const index = f * data.markers.labels.length + m;
      for (let a = 0; a < 3; a++)
        points[(m * 4 + a) * frames + f] = data.markers.positions[index * 3 + a];
      residuals[m * frames + f] = data.markers.valid[index]
        ? (data.markers.residuals?.[index] ?? NaN)
        : -1;
    }
  ds(labeled, 'Data', points, [data.markers.labels.length, 4, frames]);
  ds(labeled, 'Residuals', residuals, [data.markers.labels.length, frames]);
  ds(
    labeled,
    'Time',
    Float64Array.from({ length: frames }, (_, i) => origin + i / rate),
    [frames],
  );
  if (data.analogs.length) {
    const group = output.create_group('Analog'),
      first = data.analogs[0].signal;
    // C3D has one common grid. A mismatched caller must not silently mix channels.
    if (
      data.analogs.some(
        (a) =>
          a.signal.components !== 1 ||
          a.signal.rate !== first.rate ||
          a.signal.values.length !== first.values.length ||
          a.signal.startTime !== first.startTime,
      )
    )
      throw new Error('C3D-derived analog channels must share one scalar sample grid.');
    const n = first.values.length;
    const values = new Float64Array(data.analogs.length * n);
    data.analogs.forEach((a, i) => values.set(a.signal.values, i * n));
    group.create_attribute(
      'Labels',
      data.analogs.map((a) => a.name),
    );
    group.create_attribute(
      'Units',
      data.analogs.map((a) => a.unit),
    );
    group.create_attribute(
      'Channels',
      BigInt64Array.from(data.analogs, (_, i) => BigInt(i + 1)),
    );
    clock(group, first);
    ds(group, 'Data', values, [data.analogs.length, n]);
  }
  if (data.forcePlatforms.length) {
    const parent = output.create_group('ForcePlates');
    data.forcePlatforms.forEach((p, i) => {
      const group = parent.create_group(String(i));
      for (const [key, value] of Object.entries({
        Name: p.name,
        FreeMomentFrame: 'global',
        unit_force: 'N',
        unit_moment: 'Nmm',
        unit_position: 'mm',
        Provenance: p.provenance,
      }))
        group.create_attribute(key, value);
      integer(group, 'CoordinateSystem', 1);
      integer(group, 'FrameStep', 1);
      clock(group, p.force);
      tensor(group, 'Force', p.force, [3]);
      tensor(group, 'Moment', p.moment, [3], 1000);
      tensor(group, 'COP', p.cop, [3]);
      if (p.freeMoment)
        tensor(group, 'Tz', p.freeMoment, p.freeMoment.components === 3 ? [3] : [], 1000);
      if (p.corners) tensor(group, 'Corners', p.corners, [3, 4], 1, true);
      if (p.position) tensor(group, 'Position', p.position, [3]);
      if (p.rotation) tensor(group, 'Rotation', p.rotation, [3, 3]);
      if (p.origin) ds(group, 'Origin', p.origin, [3, 1]);
    });
  }
  const events = output.create_group('Events');
  for (const [key, field] of [
    ['Name', 'label'],
    ['Description', 'description'],
    ['Context', 'context'],
    ['Subject', 'subject'],
  ] as const)
    events.create_dataset({
      name: key,
      data: data.events.map((e) => e[field] ?? ''),
      shape: [data.events.length],
      dtype: 'S',
    });
  ds(
    events,
    'Time',
    Float64Array.from(data.events, (e) => origin + e.time),
    [data.events.length],
  );
  for (const [key, values] of [
    ['Frame', data.events.map((e) => Math.round(firstFrame + e.time * rate))],
    ['GenericFlag', data.events.map((e) => e.genericFlag ?? 0)],
    ['IconID', data.events.map((e) => e.iconId ?? 0)],
  ] as const)
    events.create_dataset({
      name: key,
      data: BigInt64Array.from(values, BigInt),
      shape: [values.length],
      dtype: '<q',
    });
  const meta = output.create_group('MetaData'),
    project = meta.create_group('Project');
  const subjectFields = {
    id: 'SubjectID',
    group: 'SubjectGroup',
    age: 'Age',
    sex: 'Sex',
    height: 'BodyHeight',
    mass: 'BodyMass',
    condition: 'Condition',
  } as const;
  for (const [field, key] of Object.entries(subjectFields)) {
    const value = data.source.info?.subject?.[field as keyof typeof subjectFields];
    if (value?.values.length === 1) {
      project.create_attribute(key, value.values[0]);
      if (value.unit) project.create_attribute(`${key}Unit`, value.unit);
    }
  }
  const fileInfo = meta.create_group('FileInfo');
  fileInfo.create_attribute('OriginalFiles', [data.name.split(/[\\/]/).at(-1) ?? '']);
  fileInfo.create_attribute('ConversionSourceFormat', data.source.format);
  fileInfo.create_attribute('ConvertedBy', 'JE Motion Lab');
}

export async function exportSemanticH5(data: MotionData): Promise<ArrayBuffer> {
  const h5 = await import('h5wasm');
  const { FS } = await h5.ready;
  const path = '/converted.h5';
  const output = new h5.File(path, 'w');
  try {
    writeSemanticH5(output, data);
    output.flush();
    return (FS.readFile(path) as Uint8Array).slice().buffer;
  } finally {
    output.close();
    if (FS.analyzePath(path).exists) FS.unlink(path);
  }
}

import type { MotionData, Series, ForcePlatform, MotionEvent } from '../../motion/types';
import { positiveRate, uniqueLabels } from '../../motion/math';
import { forceScale, millimetres, momentScale, MOTION_UNITS } from '../../motion/units';
import { validateMotion } from '../../motion/validation';
import { h5RecordingInfo } from './metadata';
import { h5Layout } from './layout';
import {
  embeddedC3DAnalogEncoding,
  embeddedC3DPlate,
  embeddedC3DPlateType,
} from './c3dForceMetadata';

/** Structural subset of h5wasm, also usable with an in-memory test tree. */
export interface H5Node {
  attrs?: Record<string, { value: unknown; shape?: number[] | null }>;
  shape?: number[] | null;
  value?: unknown;
  metadata?: { type: number };
  get?: (path: string) => unknown;
  keys?: () => string[];
}
function node(parent: H5Node, path: string, required = false): H5Node | undefined {
  const item = parent.get?.(path) as H5Node | null;
  if (required && !item) throw new Error(`Missing ${path} in institute H5 schema.`);
  return item || undefined;
}

/** Read an explicit clock without assuming a shared sample count or rate. */
function clock(
  parent: H5Node,
  path: string,
  count: number,
  origin: number,
): Float64Array | undefined {
  const t = node(parent, 'Time');
  if (!t) return;
  const d = numeric(t, `${path}/Time`);
  if (d.shape.length !== 1 || d.values.length !== count)
    throw new Error(`${path}/Time: sample count does not match data.`);
  const times = Float64Array.from(d.values, (v) => Number(v) - origin);
  for (let i = 0; i < count; i++)
    if (!Number.isFinite(times[i]) || (i > 0 && times[i] <= times[i - 1]))
      throw new Error(`${path}/Time: timestamps must be finite and strictly increasing.`);
  return times;
}

function timed(series: Series, times?: Float64Array): Series {
  return times ? { ...series, times, startTime: times[0] ?? 0 } : series;
}

function tensor(n: H5Node, path: string, components: number, rate: number, scale = 1): Series {
  const d = numeric(n, path),
    count = d.shape.at(-1)!;
  if (d.values.length !== components * count)
    throw new Error(`${path}: unsupported shape ${d.shape}.`);
  const values = new Float64Array(d.values.length);
  for (let f = 0; f < count; f++)
    for (let c = 0; c < components; c++)
      values[f * components + c] = Number(d.values[c * count + f]) * scale;
  return { values, components, rate, startTime: 0 };
}
const attr = (n: H5Node | undefined, key: string) => n?.attrs?.[key]?.value;
function scalar(value: unknown): unknown {
  return ArrayBuffer.isView(value) || Array.isArray(value)
    ? (value as unknown as ArrayLike<unknown>)[0]
    : value;
}
function str(value: unknown, fallback = ''): string {
  return String(scalar(value) ?? fallback)
    .replace(/\0/g, '')
    .trim();
}
function stringArray(value: unknown): string[] {
  // h5wasm returns zero-length attributes as typed arrays, even for Labels/Units.
  if (ArrayBuffer.isView(value) && (value as unknown as ArrayLike<unknown>).length === 0) return [];
  return Array.isArray(value) ? value.map((v) => str(v)) : value == null ? [] : [str(value)];
}
function numeric(
  n: H5Node | undefined,
  path: string,
): { values: ArrayLike<number>; shape: number[] } {
  if (!n?.shape) throw new Error(`Missing numeric H5 dataset: ${path}.`);
  const values = n.value;
  if (
    (n.metadata && ![0, 1, 8].includes(n.metadata.type)) ||
    (Array.isArray(values) && values.some((v) => typeof v !== 'number' && typeof v !== 'bigint'))
  )
    throw new Error(`Invalid numeric dataset type: ${path}.`);
  if (!ArrayBuffer.isView(values) && !Array.isArray(values))
    throw new Error(`Invalid numeric dataset: ${path}.`);
  const shape = n.shape;
  if (
    shape.some((s) => !Number.isSafeInteger(s) || s < 0) ||
    shape.reduce((a, b) => a * b, 1) !== (values as unknown as ArrayLike<number>).length
  )
    throw new Error(`Invalid dimensions: ${path}.`);
  return { values: values as unknown as ArrayLike<number>, shape };
}
/** Empty optional arrays keep their documented rank/axes; they are not pseudo-signals. */
function optionalArray(
  n: H5Node | undefined,
  path: string,
  axes: number[],
  emptyComponents = true,
) {
  if (!n) return;
  const d = numeric(n, path);
  if (
    d.shape.length !== axes.length ||
    d.shape.some(
      (size, i) =>
        size !== axes[i] &&
        !(d.values.length === 0 && size === 0 && (emptyComponents || i === axes.length - 1)),
    )
  )
    throw new Error(`${path}: expected [${axes}], found [${d.shape}].`);
  return d.values.length ? d : undefined;
}
function vector(n: H5Node | undefined, path: string, rate: number, scale: number): Series {
  const { values, shape } = numeric(n, path);
  if (shape.length !== 2 || shape[0] !== 3)
    throw new Error(`${path}: expected [3,samples], found [${shape}].`);
  const count = shape[1];
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++) out[i * 3 + a] = Number(values[a * count + i]) * scale;
  return { values: out, rate, components: 3, startTime: 0 };
}
function corners(
  n: H5Node | undefined,
  path: string,
  pointCount: number,
  forceCount: number,
  pointRate: number,
  forceRate: number,
  scale: number,
): Series | undefined {
  if (!n) return;
  const { values, shape } = numeric(n, path);
  if (shape[0] !== 3 || shape[1] !== 4 || ![2, 3].includes(shape.length))
    throw new Error(`${path}: expected [3,4] or [3,4,samples], found [${shape}].`);
  const count = shape[2] ?? 1;
  if (count === 0) return;
  let isStatic = true;
  for (let a = 0; a < 12 && isStatic; a++)
    for (let f = 1; f < count; f++)
      if (values[a * count + f] !== values[a * count]) {
        isStatic = false;
        break;
      }
  if (!isStatic && count !== pointCount && count !== forceCount) {
    throw new Error(`${path}: unknown geometry sampling rate.`);
  }
  const out = new Float64Array((isStatic ? 1 : count) * 12);
  for (let f = 0; f < (isStatic ? 1 : count); f++)
    for (let c = 0; c < 4; c++)
      for (let a = 0; a < 3; a++)
        out[f * 12 + c * 3 + a] = Number(values[(a * 4 + c) * count + f]) * scale;
  return {
    values: out,
    // Static geometry has no time axis; keep a stable nominal rate even for one-frame trials.
    rate: !isStatic && count === pointCount ? pointRate : forceRate,
    components: 12,
    startTime: 0,
  };
}

export function parseH5Tree(root: H5Node, name: string): MotionData {
  const layout = h5Layout(root);
  const traj = node(root, 'Trajectories', true)!,
    labeled = node(root, 'Trajectories/Labeled', true)!;
  const markerData = node(labeled, 'Data');
  if (!markerData) throw new Error('Missing Trajectories/Labeled/Data dataset.');
  const { values, shape } = numeric(markerData, 'Trajectories/Labeled/Data');
  const rawLabels = stringArray(attr(labeled, 'Labels'));
  if (shape.length !== 3 || shape[1] !== 4 || rawLabels.length !== shape[0])
    throw new Error('Unsupported H5 marker layout: expected [labels,4,frames].');
  const count = shape[0],
    frameCount = shape[2],
    rate = positiveRate(Number(scalar(attr(traj, 'SamplingFrequency'))), 'Marker');
  const warnings: string[] = [],
    unit = str(attr(labeled, 'Unit')),
    scale = millimetres(unit);
  const checkCount = (group: H5Node, key: string, expected: number, path: string) => {
    const value = attr(group, key);
    if (value != null && Number(scalar(value)) !== expected) {
      const message = `${path}@${key}: does not match dataset sample count.`;
      throw new Error(message);
    }
  };
  const checkExtent = (group: H5Node, samples: number, path: string) => {
    if (attr(group, 'StartFrame') == null) return;
    const start = Number(scalar(attr(group, 'StartFrame')));
    const step = Number(scalar(attr(group, 'FrameStep')) ?? 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(step) || step < 1) {
      throw new Error(`${path}: invalid StartFrame/FrameStep.`);
    }
    if (attr(group, 'EndFrame') != null)
      checkCount(group, 'EndFrame', start + (samples - 1) * step, path);
  };
  checkCount(traj, 'NumFrames', frameCount, 'Trajectories');
  checkCount(labeled, 'NumLabeled', count, 'Trajectories/Labeled');
  if (attr(traj, 'EndFrame') != null && attr(traj, 'StartFrame') != null)
    checkCount(
      traj,
      'EndFrame',
      Number(scalar(attr(traj, 'StartFrame'))) + frameCount - 1,
      'Trajectories',
    );
  const labels = uniqueLabels(rawLabels),
    positions = new Float64Array(frameCount * count * 3),
    valid = new Uint8Array(frameCount * count);
  const resNode = node(labeled, 'Residuals');
  const res = optionalArray(resNode, 'Trajectories/Labeled/Residuals', [count, frameCount]);
  if (res && res.shape.join(',') !== `${count},${frameCount}`)
    throw new Error('H5 residual dimensions do not match markers.');
  const residuals = res ? new Float64Array(frameCount * count) : undefined;
  const pointClock = clock(labeled, 'Trajectories/Labeled', frameCount, 0);
  const timeOrigin = pointClock?.[0] ?? Number(scalar(attr(traj, 'StartFrame')) ?? 0) / rate;
  if (pointClock)
    for (let i = 0; i < frameCount; i++)
      if (Math.abs(pointClock[i] - timeOrigin - i / rate) > 1e-7)
        throw new Error(
          'Trajectories/Labeled/Time: irregular marker clock is unsupported by frame playback.',
        );
  const streamStart = (group: H5Node, streamRate: number) =>
    attr(group, 'StartFrame') != null
      ? Number(scalar(attr(group, 'StartFrame'))) / streamRate - timeOrigin
      : 0;
  for (let f = 0; f < frameCount; f++)
    for (let m = 0; m < count; m++) {
      const i = f * count + m;
      for (let a = 0; a < 3; a++)
        positions[i * 3 + a] = Number(values[(m * 4 + a) * frameCount + f]) * scale;
      const residual = res ? Number(res.values[m * frameCount + f]) : 0;
      if (residuals) residuals[i] = residual < 0 ? -1 : residual * scale;
      valid[i] =
        !(residual < 0) && [0, 1, 2].every((a) => Number.isFinite(positions[i * 3 + a])) ? 1 : 0;
    }
  // Validate semantic channel axes before deciding whether a category is unavailable.
  // Model samples stay lazy: only their shape/type, metadata and explicit clock are read.
  const channelLayout = (group: H5Node, path: string, requireUnits = true) => {
    const data = node(group, 'Data'),
      labels = stringArray(attr(group, 'Labels')),
      units = stringArray(attr(group, 'Units'));
    const channels = attr(group, 'Channels') as ArrayLike<number> | undefined;
    for (const key of ['Labels', 'Units']) {
      const value = attr(group, key);
      if (
        stringArray(value).length &&
        !(
          typeof value === 'string' ||
          (Array.isArray(value) && value.every((v) => typeof v === 'string'))
        )
      )
        throw new Error(`${path}/${key}: expected text metadata.`);
    }
    const shape = data?.shape ?? [0, 0];
    if (
      shape.length !== 2 ||
      shape.some((size) => !Number.isSafeInteger(size) || size < 0) ||
      (data?.metadata && ![0, 1, 8].includes(data.metadata.type))
    )
      throw new Error(`${path}/Data: expected numeric [channels,samples].`);
    if (shape[0] !== labels.length)
      throw new Error(
        `${path}/Data contains ${shape[0]} channels but ${path}/Labels contains ${labels.length} labels.`,
      );
    if (labels.some((label) => !label))
      throw new Error(`${path}/Labels: channel labels must contain nonempty text.`);
    const empty = shape.includes(0);
    if (
      (units.length && units.length !== labels.length) ||
      (!empty && requireUnits && units.length !== labels.length)
    )
      throw new Error(`${path}/Units: one unit per channel is required.`);
    if (units.some((unit) => !unit))
      throw new Error(`${path}/Units: units must contain nonempty text.`);
    if (
      channels &&
      (channels.length !== labels.length ||
        Array.from(channels).some((c) => !Number.isSafeInteger(Number(c))))
    )
      throw new Error(`${path}/Channels: expected one integer identity per channel.`);
    if (data && empty) numeric(data, `${path}/Data`);
    checkCount(group, 'NumSamples', shape[1], path);
    const times = clock(
      group,
      path,
      shape[1],
      path === 'IKResults' || path === 'IDResults' ? 0 : timeOrigin,
    );
    if (attr(group, 'SamplingFrequency') != null)
      positiveRate(Number(scalar(attr(group, 'SamplingFrequency'))), path);
    return { data, labels, units, empty, samples: shape[1], times };
  };
  for (const path of ['IKResults', 'IDResults']) {
    const group = node(root, path);
    if (group) channelLayout(group, path, false);
  }
  const analogs: MotionData['analogs'] = [],
    analog = node(root, 'Analog');
  if (analog) {
    const layout = channelLayout(analog, 'Analog');
    const names = uniqueLabels(layout.labels);
    if (!layout.empty) {
      const data = numeric(layout.data, 'Analog/Data');
      const analogRate = positiveRate(Number(scalar(attr(analog, 'SamplingFrequency'))), 'Analog'),
        n = layout.samples;
      const units = layout.units;
      const channels = attr(analog, 'Channels') as ArrayLike<number> | undefined;
      checkExtent(analog, n, 'Analog');
      const times = layout.times;
      for (let c = 0; c < names.length; c++)
        analogs.push({
          name: names[c],
          unit: units[c] || 'unknown',
          sourceChannel: channels ? Number(channels[c]) : undefined,
          signal: timed(
            {
              values: Float64Array.from({ length: n }, (_, i) => Number(data.values[c * n + i])),
              rate: analogRate,
              components: 1,
              startTime: streamStart(analog, analogRate),
            },
            times,
          ),
        });
    }
  }
  const forcePlatforms: ForcePlatform[] = [],
    plates = node(root, 'ForcePlates');
  for (const key of plates?.keys?.() || []) {
    const path = `ForcePlates/${key}`,
      plate = node(plates!, key)!;
    const vectorFields = ['Force', 'Moment', 'COP'];
    const vectors = vectorFields.map((field) => node(plate, field));
    if (vectors.every((n) => !n || n.shape?.includes(0))) {
      if (vectors.some(Boolean) && !vectors.every(Boolean))
        throw new Error(`${path}: Force, Moment and COP must be supplied together.`);
      for (const field of plate.keys?.() ?? []) {
        const n = node(plate, field)!;
        const axes =
          field === 'Time'
            ? [0]
            : field === 'Corners'
              ? [3, 4, 0]
              : field === 'Rotation'
                ? [3, 3, 0]
                : [3, 0];
        if (optionalArray(n, `${path}/${field}`, axes, false))
          throw new Error(`${path}: geometry or clock without force samples.`);
      }
      checkCount(plate, 'NumSamples', 0, path);
      continue;
    }
    try {
      const plateName = str(attr(plate, 'Name'), `Plate ${key}`),
        forceRate = positiveRate(Number(scalar(attr(plate, 'SamplingFrequency'))), path);
      const ps = millimetres(str(attr(plate, 'unit_position'))),
        fs = forceScale(str(attr(plate, 'unit_force'))),
        ms = momentScale(str(attr(plate, 'unit_moment')));
      let force = vector(node(plate, 'Force'), `${path}/Force`, forceRate, fs),
        moment = vector(node(plate, 'Moment'), `${path}/Moment`, forceRate, ms),
        cop = vector(node(plate, 'COP'), `${path}/COP`, forceRate, ps);
      if (force.values.length !== moment.values.length || force.values.length !== cop.values.length)
        throw new Error('inconsistent vector lengths.');
      const countForce = force.values.length / 3;
      checkCount(plate, 'NumSamples', countForce, path);
      checkExtent(plate, countForce, path);
      const times = clock(plate, path, countForce, timeOrigin);
      force = timed({ ...force, startTime: streamStart(plate, forceRate) }, times);
      moment = timed({ ...moment, startTime: force.startTime }, times);
      cop = timed({ ...cop, startTime: force.startTime }, times);
      let geometry = corners(
        node(plate, 'Corners'),
        `${path}/Corners`,
        frameCount,
        countForce,
        rate,
        forceRate,
        ps,
      );
      if (geometry && geometry.values.length > 12)
        geometry = timed(
          geometry,
          geometry.values.length / 12 === countForce
            ? times
            : pointClock?.map((t) => t - timeOrigin),
        );
      const coord = Number(scalar(attr(plate, 'CoordinateSystem')));
      const rot = node(plate, 'Rotation');
      const coordinateFrame = coord === 1 ? 'global' : 'unresolved';
      if (coordinateFrame === 'unresolved')
        warnings.push(
          `${plateName}: force coordinate frame is unresolved; spatial force display is disabled until you confirm stored global coordinates.`,
        );
      let freeMoment: Series | undefined;
      const tz = node(plate, 'Tz');
      if (optionalArray(tz, `${path}/Tz`, [3, countForce], false)) {
        const d = numeric(tz, `${path}/Tz`);
        if (d.shape.length === 2 && d.shape[0] === 3 && d.shape[1] === countForce)
          freeMoment = timed(
            { ...vector(tz, `${path}/Tz`, forceRate, ms), startTime: force.startTime },
            times,
          );
        else throw new Error(`${path}/Tz: unsupported free moment shape ${d.shape}.`);
      }
      const positionNode = node(plate, 'Position'),
        originNode = node(plate, 'Origin');
      // Pose arrays may be static or have a final time axis independent of force samples.
      // Empty poses are unavailable; populated poses must have an established sample grid.
      const pose = (n: H5Node | undefined, field: string, axes: number[], scale: number) => {
        if (!n) return;
        const d = numeric(n, `${path}/${field}`);
        const staticPose = d.shape.length === axes.length;
        if (
          d.shape.length !== axes.length + (staticPose ? 0 : 1) ||
          axes.some((size, i) => d.shape[i] !== size)
        )
          throw new Error(`${path}/${field}: unsupported pose shape [${d.shape}].`);
        const components = axes.reduce((a, b) => a * b, 1);
        if (!d.values.length) return;
        if (staticPose)
          return {
            values: Float64Array.from(d.values, (v) => Number(v) * scale),
            components,
            rate: forceRate,
            startTime: 0,
          };
        const nSamples = d.shape.at(-1)!;
        if (nSamples !== 1 && nSamples !== frameCount && nSamples !== countForce)
          throw new Error(
            `${path}/${field}: cannot determine geometry sampling rate for ${nSamples} samples.`,
          );
        return tensor(n, `${path}/${field}`, components, forceRate, scale);
      };
      const position = pose(positionNode, 'Position', [3], ps);
      const rotation = pose(rot, 'Rotation', [3, 3], 1);
      const geometryClock = (s: Series | undefined) =>
        s &&
        timed(
          {
            ...s,
            rate: s.values.length / s.components === frameCount ? rate : forceRate,
            startTime: s.values.length / s.components === countForce ? force.startTime : 0,
          },
          s.values.length / s.components === countForce
            ? times
            : s.values.length / s.components === frameCount
              ? pointClock?.map((t) => t - timeOrigin)
              : undefined,
        );
      forcePlatforms.push({
        sourcePath: path,
        type: embeddedC3DPlateType(root, key),
        name: plateName,
        force,
        moment,
        cop,
        corners: geometry,
        freeMoment,
        position: geometryClock(position),
        rotation: geometryClock(rotation),
        origin:
          originNode &&
          optionalArray(
            originNode,
            `${path}/Origin`,
            originNode.shape?.length === 1 ? [3] : [3, 1],
            false,
          )
            ? Float64Array.from(numeric(originNode, `${path}/Origin`).values, (v) => Number(v) * ps)
            : undefined,
        poseFrame: node(plate, 'Corners') && coord === 1 ? 'global' : undefined,
        coordinateFrame,
        provenance: `Stored CoordinateSystem=${coord}`,
        c3dSource: embeddedC3DPlate(root, key),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        message.startsWith(`${path}/`) || message.startsWith(`${path}:`)
          ? message
          : `${path}: ${message}`,
      );
    }
  }
  const eventGroup = node(root, 'Events');
  const eventSchema = 'institute-current' as const;
  const events: MotionEvent[] = [];
  if (eventGroup?.keys?.().length) {
    const eventStrings = (key: string) => {
      const n = node(eventGroup!, key, true)!;
      if (
        n.shape?.length !== 1 ||
        !Array.isArray(n.value) ||
        !n.value.every((v) => typeof v === 'string')
      )
        throw new Error(`Events/${key}: expected one-dimensional strings.`);
      return n.value as string[];
    };
    const names = eventStrings('Name');
    const descriptions = eventStrings('Description');
    const contexts = eventStrings('Context');
    const subjects = eventStrings('Subject');
    const flags = numeric(node(eventGroup!, 'GenericFlag', true), 'Events/GenericFlag');
    const icons = numeric(node(eventGroup!, 'IconID', true), 'Events/IconID');
    const times = numeric(node(eventGroup!, 'Time', true), 'Events/Time');
    const frames = numeric(node(eventGroup!, 'Frame', true), 'Events/Frame');
    if (
      times.shape.length !== 1 ||
      frames.shape.length !== 1 ||
      flags.shape.length !== 1 ||
      icons.shape.length !== 1 ||
      [
        descriptions.length,
        times.values.length,
        frames.values.length,
        contexts.length,
        subjects.length,
        flags.values.length,
        icons.values.length,
      ].some((n) => n !== names.length)
    )
      throw new Error('Events: all eight columns must have matching one-dimensional rows.');
    names.forEach((label, i) => {
      const time = Number(times.values[i]) - timeOrigin;
      if (!Number.isFinite(time) || !Number.isSafeInteger(Number(frames.values[i])))
        throw new Error(`Events: invalid time/frame at row ${i}.`);
      if (
        !Number.isSafeInteger(Number(flags.values[i])) ||
        !Number.isSafeInteger(Number(icons.values[i]))
      )
        throw new Error(`Events: invalid flag/icon at row ${i}.`);
      events.push({
        label,
        description: descriptions[i],
        context: contexts[i],
        subject: subjects[i],
        time,
        sourceIndex: i,
        sourceFrame: Number(frames.values[i]),
        genericFlag: Number(flags.values[i]),
        iconId: Number(icons.values[i]),
      });
    });
  } else if (eventGroup?.keys?.().length || Object.keys(eventGroup?.attrs ?? {}).length)
    throw new Error('Events: unsupported empty collection with undocumented attributes.');
  const metadata: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(node(root, 'MetaData')?.attrs || {})) metadata[k] = a.value;
  metadata.globalCoordinateSystem = attr(traj, 'GlobalCoordinateSystem') ?? '';
  // Retain nested source attributes without flattening away hierarchy.
  const metadataTree = (group: H5Node, depth = 0): Record<string, unknown> => {
    if (depth > 32) throw new Error('H5 metadata hierarchy too deep.');
    return {
      attributes: Object.fromEntries(
        Object.entries(group.attrs ?? {}).map(([k, v]) => [k, v.value]),
      ),
      groups: Object.fromEntries(
        (group.keys?.() ?? []).flatMap((k) => {
          const child = node(group, k)!;
          return child.keys ? [[k, metadataTree(child, depth + 1)]] : [];
        }),
      ),
    };
  };
  metadata.hierarchy = metadataTree(root);
  if (node(root, 'MetaData'))
    metadata.sourceTree = (
      metadata.hierarchy as { groups: Record<string, unknown> }
    ).groups.MetaData;
  const signals: NonNullable<MotionData['signals']> = [];
  // IKResults/IDResults expose only variable catalogs/counts, not plotted signals.
  // Their original datasets remain available to the raw-tree exporter.
  for (const groupName of ['EMG']) {
    const group = node(root, groupName);
    if (!group) continue;
    const layout = channelLayout(group, groupName);
    if (layout.empty) continue;
    const data = numeric(layout.data, `${groupName}/Data`),
      labels = layout.labels;
    const n = layout.samples,
      times = layout.times;
    const storedRate = Number(scalar(attr(group, 'SamplingFrequency')));
    if (!times && !Number.isFinite(storedRate))
      throw new Error(`${groupName}: Time or SamplingFrequency required.`);
    const signalRate = Number.isFinite(storedRate)
      ? positiveRate(storedRate, groupName)
      : n > 1
        ? (n - 1) / (times![n - 1] - times![0])
        : rate;
    const units = layout.units;
    const channels = attr(group, 'Channels') as ArrayLike<number> | undefined;
    checkExtent(group, n, groupName);
    if (times?.length && (times[0] >= frameCount / rate || times.at(-1)! < 0))
      warnings.push(
        `${groupName}: timestamps do not overlap the marker recording; no alignment offset has been invented.`,
      );
    labels.forEach((name, c) => {
      const sourceChannel = channels ? Number(channels[c]) : undefined;
      const analogIndex =
        sourceChannel === undefined
          ? -1
          : analogs.findIndex((a) => a.sourceChannel === sourceChannel);
      const mapped = analogs[analogIndex];
      const same =
        mapped &&
        mapped.unit === (units[c] || 'unknown') &&
        mapped.signal.rate === signalRate &&
        mapped.signal.values.length === n &&
        (times
          ? mapped.signal.times?.length === n &&
            times.every((t, i) => t === mapped.signal.times![i])
          : !mapped.signal.times && mapped.signal.startTime === streamStart(group, signalRate)) &&
        mapped.signal.values.every((v, i) => Object.is(v, Number(data.values[c * n + i])));
      signals.push({
        name,
        sourceIndex: c,
        sourcePath: groupName,
        group: groupName,
        unit: units[c] || 'unknown',
        sourceChannel,
        ...(same ? { analogIndex } : {}),
        signal: same
          ? mapped.signal
          : timed(
              {
                values: Float64Array.from({ length: n }, (_, i) => Number(data.values[c * n + i])),
                rate: signalRate,
                components: 1,
                startTime: streamStart(group, signalRate),
              },
              times,
            ),
      });
    });
  }
  const rigidBodies: NonNullable<MotionData['rigidBodies']> = [],
    bodies = node(root, 'RigidBodies');
  for (const key of bodies?.keys?.() ?? []) {
    const body = node(bodies!, key)!,
      path = `RigidBodies/${key}`;
    const positionNode = node(body, 'Position');
    const positionData = optionalArray(positionNode, `${path}/Position`, [3, frameCount], false);
    if (!positionData) {
      if (optionalArray(node(body, 'Rotation'), `${path}/Rotation`, [3, 3, frameCount], false))
        throw new Error(`${path}/Rotation: data without body positions.`);
      const members = node(body, 'Markers');
      if (members && (members.shape?.length !== 1 || members.shape[0] !== 0))
        throw new Error(`${path}/Markers: data without body positions.`);
      checkCount(body, 'NumSamples', 0, path);
      continue;
    }
    const ps = millimetres(str(attr(body, 'Unit')));
    const position = vector(node(body, 'Position'), `${path}/Position`, rate, ps);
    if (position.values.length !== frameCount * 3)
      throw new Error(`${path}/Position: cannot establish body sampling from marker grid.`);
    checkCount(body, 'NumSamples', frameCount, path);
    checkExtent(body, frameCount, path);
    const times = pointClock?.map((t) => t - timeOrigin),
      rotationNode = node(body, 'Rotation');
    const rotation = optionalArray(rotationNode, `${path}/Rotation`, [3, 3, frameCount], false)
      ? timed(tensor(rotationNode!, `${path}/Rotation`, 9, rate), times)
      : undefined;
    if (rotation && rotation.values.length !== frameCount * 9)
      throw new Error(`${path}/Rotation: inconsistent body frame count.`);
    const bodyPosition = timed(position, times);
    rigidBodies.push({
      sourcePath: path,
      name: str(attr(body, 'Name'), key),
      markers: stringArray(node(body, 'Markers')?.value),
      position: bodyPosition,
      rotation,
    });
    signals.push({
      sourcePath: path,
      name: str(attr(body, 'Name'), key),
      group: 'RigidBodies',
      unit: MOTION_UNITS.position,
      signal: bodyPosition,
    });
  }
  const typeNode = node(labeled, 'Type'),
    masks = node(labeled, 'CameraMasks');
  const type = optionalArray(typeNode, 'Trajectories/Labeled/Type', [count, frameCount])
    ? tensor(typeNode!, 'Trajectories/Labeled/Type', count, rate)
    : undefined;
  if (type && type.values.length !== count * frameCount)
    throw new Error('Trajectories/Labeled/Type: frame count mismatch.');
  const cameraCount = masks?.shape?.[1] ?? 0;
  const maskData = optionalArray(masks, 'Trajectories/Labeled/CameraMasks', [
    count,
    cameraCount,
    frameCount,
  ])
    ? tensor(masks!, 'Trajectories/Labeled/CameraMasks', count * cameraCount, rate)
    : undefined;
  if (maskData && maskData.values.length !== count * cameraCount * frameCount)
    throw new Error('Trajectories/Labeled/CameraMasks: frame count mismatch.');
  const flag = (key: string) => {
    const n = node(labeled, key);
    if (!n) return;
    const d = optionalArray(n, `Trajectories/Labeled/${key}`, [count]);
    if (!d) return;
    if (d.shape.join(',') !== String(count))
      throw new Error(`${key}: expected one flag per marker.`);
    return Uint8Array.from(d.values);
  };
  const quality = {
    type: type && Int8Array.from(type.values),
    cameraMasks: maskData && Uint8Array.from(maskData.values),
    cameraCount,
    cameraMasksKnown: flag('CameraMasksKnown'),
    virtual: flag('Virtual'),
  };
  const firstFrame = Number(scalar(attr(traj, 'StartFrame')) ?? 0);
  if (!Number.isSafeInteger(firstFrame)) throw new Error('Invalid H5 StartFrame.');
  return validateMotion({
    units: MOTION_UNITS,
    name,
    source: {
      format: 'H5',
      originalPositionUnit: unit,
      metadata,
      info: h5RecordingInfo(root),
      timeOrigin,
      eventSchema,
      h5Layout: layout,
      c3dAnalogEncoding: embeddedC3DAnalogEncoding(root),
    },
    timeline: { frameCount, rate, firstFrame, duration: (frameCount - 1) / rate },
    markers: { labels, positions, valid, residuals, quality },
    analogs,
    signals,
    rigidBodies,
    forcePlatforms,
    events,
    warnings,
  });
}

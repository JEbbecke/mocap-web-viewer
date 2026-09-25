import type { MotionData, Series, ForcePlatform, MotionEvent } from '../../motion/types';
import { forceScale, metres, momentScale, positiveRate, uniqueLabels } from '../../motion/math';
import { validateMotion } from '../../motion/validation';

/** Structural subset of h5wasm, also usable with an in-memory test tree. */
export interface H5Node {
  attrs?: Record<string, { value: unknown }>;
  shape?: number[] | null;
  value?: unknown;
  metadata?: { type: number };
  get?: (path: string) => unknown;
  keys?: () => string[];
}
function node(parent: H5Node, path: string, required = false): H5Node | undefined {
  const item = parent.get?.(path) as H5Node | null;
  if (required && !item) throw new Error(`Unsupported institute H5 schema: missing ${path}.`);
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
  return Array.isArray(value) ? value.map((v) => str(v)) : value == null ? [] : [str(value)];
}
function numeric(
  n: H5Node | undefined,
  path: string,
): { values: ArrayLike<number>; shape: number[] } {
  if (!n?.shape) throw new Error(`Missing numeric H5 dataset: ${path}.`);
  const values = n.value;
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
function vector(n: H5Node | undefined, path: string, rate: number, scale: number): Series {
  const { values, shape } = numeric(n, path);
  if (shape.length !== 2 || (shape[0] !== 3 && shape[1] !== 3))
    throw new Error(`${path}: expected [3,samples] or [samples,3], found [${shape}].`);
  const componentFirst = shape[0] === 3,
    count = componentFirst ? shape[1] : shape[0];
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++)
      out[i * 3 + a] = Number(values[componentFirst ? a * count + i : i * 3 + a]) * scale;
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
  warnings: string[],
): Series | undefined {
  if (!n) return;
  const { values, shape } = numeric(n, path);
  if (shape[0] !== 3 || shape[1] !== 4 || ![2, 3].includes(shape.length))
    throw new Error(`${path}: expected [3,4] or [3,4,samples], found [${shape}].`);
  const count = shape[2] ?? 1;
  if (count === 0)
    return { values: new Float64Array(0), rate: forceRate, components: 12, startTime: 0 };
  let isStatic = true;
  for (let a = 0; a < 12 && isStatic; a++)
    for (let f = 1; f < count; f++)
      if (values[a * count + f] !== values[a * count]) {
        isStatic = false;
        break;
      }
  if (!isStatic && count !== pointCount && count !== forceCount) {
    warnings.push(`${path}: unknown geometry sampling rate; plate outline omitted.`);
    return;
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
  const traj = node(root, 'Trajectories', true)!,
    labeled = node(root, 'Trajectories/Labeled', true)!;
  const { values, shape } = numeric(node(labeled, 'Data', true), 'Trajectories/Labeled/Data');
  const rawLabels = stringArray(attr(labeled, 'Labels'));
  if (shape.length !== 3 || shape[1] !== 4 || rawLabels.length !== shape[0])
    throw new Error('Unsupported H5 marker layout: expected [labels,4,frames].');
  const count = shape[0],
    frameCount = shape[2],
    rate = positiveRate(Number(scalar(attr(traj, 'SamplingFrequency'))), 'Marker');
  const warnings: string[] = [],
    unit = str(attr(labeled, 'Unit'), 'mm'),
    scale = metres(unit);
  if (attr(labeled, 'Unit') == null)
    warnings.push('H5 marker unit is absent; mm is assumed, matching the Python reader.');
  const labels = uniqueLabels(rawLabels),
    positions = new Float64Array(frameCount * count * 3),
    valid = new Uint8Array(frameCount * count);
  const resNode = node(labeled, 'Residuals');
  const res = resNode ? numeric(resNode, 'Residuals') : undefined;
  if (res && ![`${count},${frameCount}`, `1,${count},${frameCount}`].includes(res.shape.join(',')))
    throw new Error('H5 residual dimensions do not match markers.');
  const residuals = res ? new Float64Array(frameCount * count) : undefined;
  const pointClock = clock(labeled, 'Trajectories/Labeled', frameCount, 0);
  const hasTrialClock =
    !!pointClock ||
    !!node(root, 'Analog/Time') ||
    Number(scalar(attr(node(root, 'Events'), 'SchemaVersion'))) === 1;
  const timeOrigin =
    pointClock?.[0] ?? (hasTrialClock ? Number(scalar(attr(traj, 'StartFrame')) ?? 0) / rate : 0);
  if (pointClock)
    for (let i = 0; i < frameCount; i++)
      if (Math.abs(pointClock[i] - timeOrigin - i / rate) > 1e-7)
        throw new Error(
          'Trajectories/Labeled/Time: irregular marker clock is unsupported by frame playback.',
        );
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
  const analogs: MotionData['analogs'] = [],
    analog = node(root, 'Analog');
  if (analog) {
    const names = uniqueLabels(stringArray(attr(analog, 'Labels')));
    if (names.length) {
      const data = numeric(node(analog, 'Data', true), 'Analog/Data');
      if (data.shape.length !== 2 || data.shape[0] !== names.length)
        throw new Error('H5 analog labels/dimensions do not match.');
      const analogRate = positiveRate(Number(scalar(attr(analog, 'SamplingFrequency'))), 'Analog'),
        n = data.shape[1];
      const units = stringArray(attr(analog, 'Units'));
      const times = clock(analog, 'Analog', n, timeOrigin);
      for (let c = 0; c < names.length; c++)
        analogs.push({
          name: names[c],
          unit: units[c] || 'unknown',
          signal: timed(
            {
              values: Float64Array.from({ length: n }, (_, i) => Number(data.values[c * n + i])),
              rate: analogRate,
              components: 1,
              startTime: 0,
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
    try {
      const plateName = str(attr(plate, 'Name'), `Plate ${key}`),
        forceRate = positiveRate(Number(scalar(attr(plate, 'SamplingFrequency'))), plateName);
      const ps = metres(str(attr(plate, 'unit_position'))),
        fs = forceScale(str(attr(plate, 'unit_force'))),
        ms = momentScale(str(attr(plate, 'unit_moment')));
      let force = vector(node(plate, 'Force'), `${path}/Force`, forceRate, fs),
        moment = vector(node(plate, 'Moment'), `${path}/Moment`, forceRate, ms),
        cop = vector(node(plate, 'COP'), `${path}/COP`, forceRate, ps);
      if (force.values.length !== moment.values.length || force.values.length !== cop.values.length)
        throw new Error('inconsistent vector lengths.');
      const countForce = force.values.length / 3;
      const times = clock(plate, path, countForce, timeOrigin);
      force = timed(force, times);
      moment = timed(moment, times);
      cop = timed(cop, times);
      let geometry: Series | undefined;
      try {
        geometry = corners(
          node(plate, 'Corners') ?? node(plate, 'Location'),
          `${path}/${node(plate, 'Corners') ? 'Corners' : 'Location'}`,
          frameCount,
          countForce,
          rate,
          forceRate,
          ps,
          warnings,
        );
        if (geometry && geometry.values.length > 12)
          geometry = timed(
            geometry,
            geometry.values.length / 12 === countForce
              ? times
              : pointClock?.map((t) => t - timeOrigin),
          );
      } catch (e) {
        warnings.push(String(e));
      }
      const coord = Number(scalar(attr(plate, 'CoordinateSystem')));
      const rot = node(plate, 'Rotation');
      const rv = rot ? numeric(rot, `${path}/Rotation`) : undefined;
      const placeholder =
        rv && rv.shape.join(',') === '3,3,3' && Array.from(rv.values).every((v) => v === 0);
      const converter =
        coord === 0 &&
        placeholder &&
        plateName.startsWith('forceplate_') &&
        attr(plate, 'origin') != null &&
        node(root, 'MetaData')?.attrs?.FileCreationUTC != null;
      const coordinateFrame = coord === 1 || converter ? 'global' : 'unresolved';
      if (converter)
        warnings.push(
          `${plateName}: legacy converter marks global data as local; stored global force/COP values retained (reference convention).`,
        );
      if (coordinateFrame === 'unresolved')
        warnings.push(
          `${plateName}: force coordinate frame is unresolved; spatial force display is disabled until you confirm stored global coordinates.`,
        );
      let freeMoment: Series | undefined;
      const tz = node(plate, 'Tz');
      if (tz) {
        const d = numeric(tz, `${path}/Tz`);
        if (d.shape.length === 2 && d.values.length === countForce * 3)
          freeMoment = timed(vector(tz, `${path}/Tz`, forceRate, ms), times);
        else if (d.values.length === countForce)
          freeMoment = timed(
            {
              values: Float64Array.from(d.values, (v) => Number(v) * ms),
              rate: forceRate,
              components: 1,
              startTime: 0,
            },
            times,
          );
        else throw new Error(`${path}/Tz: unsupported free moment shape ${d.shape}.`);
      }
      const positionNode = node(plate, 'Position'),
        originNode = node(plate, 'Origin') ?? node(plate, 'Offset');
      // Pose arrays may be static or have a final time axis independent of force samples.
      // A malformed optional pose must not discard otherwise usable global corners/forces.
      const pose = (n: H5Node | undefined, field: string, axes: number[], scale: number) => {
        if (!n) return;
        try {
          const d = numeric(n, `${path}/${field}`);
          const staticPose = d.shape.length === axes.length;
          if (
            d.shape.length !== axes.length + (staticPose ? 0 : 1) ||
            axes.some((size, i) => d.shape[i] !== size)
          )
            throw new Error(`${path}/${field}: unsupported pose shape [${d.shape}].`);
          const components = axes.reduce((a, b) => a * b, 1);
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
        } catch (error) {
          warnings.push(`${String(error)} Pose omitted; stored corners/forces retained.`);
        }
      };
      const position =
        positionNode?.shape?.[0] === 3 ? pose(positionNode, 'Position', [3], ps) : undefined;
      const rotation =
        rv && rv.shape[0] === 3 && rv.shape[1] === 3 && !placeholder
          ? pose(rot!, 'Rotation', [3, 3], 1)
          : undefined;
      const geometryClock = (s: Series | undefined) =>
        s &&
        timed(
          { ...s, rate: s.values.length / s.components === frameCount ? rate : forceRate },
          s.values.length / s.components === countForce
            ? times
            : s.values.length / s.components === frameCount
              ? pointClock?.map((t) => t - timeOrigin)
              : undefined,
        );
      forcePlatforms.push({
        name: plateName,
        force,
        moment,
        cop,
        corners: geometry,
        freeMoment,
        position: geometryClock(position),
        rotation: geometryClock(rotation),
        origin: originNode
          ? Float64Array.from(numeric(originNode, `${path}/Origin`).values, (v) => Number(v) * ps)
          : undefined,
        poseFrame: node(plate, 'Corners') && coord === 1 ? 'global' : undefined,
        coordinateFrame,
        provenance: converter
          ? 'Legacy converter: stored global vectors'
          : `Stored CoordinateSystem=${coord}`,
      });
    } catch (e) {
      warnings.push(
        `${path}: ${e instanceof Error ? e.message : String(e)} Platform omitted; marker/analog data retained.`,
      );
    }
  }
  const eventGroup = node(root, 'Events');
  const eventSchema =
    Number(scalar(attr(eventGroup, 'SchemaVersion'))) === 1 &&
    str(attr(eventGroup, 'Scope')) === 'Trial clock; zero-based source point frames; seconds'
      ? ('institute-v1' as const)
      : undefined;
  const events: MotionEvent[] = [];
  if (eventSchema) {
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
    const times = numeric(node(eventGroup!, 'Time', true), 'Events/Time');
    const frames = numeric(node(eventGroup!, 'Frame', true), 'Events/Frame');
    if (
      times.shape.length !== 1 ||
      frames.shape.length !== 1 ||
      [descriptions.length, times.values.length, frames.values.length].some(
        (n) => n !== names.length,
      )
    )
      throw new Error(
        'Events: Name, Description, Time and Frame must have matching one-dimensional rows.',
      );
    names.forEach((label, i) => {
      const time = Number(times.values[i]) - timeOrigin;
      if (!Number.isFinite(time) || !Number.isSafeInteger(Number(frames.values[i])))
        throw new Error(`Events: invalid time/frame at row ${i}.`);
      events.push({ label, description: descriptions[i], context: '', time, sourceIndex: i });
    });
  } else if (eventGroup?.keys?.().length || Object.keys(eventGroup?.attrs ?? {}).length)
    warnings.push(
      'H5 Events is nonempty, but its schema is undocumented; events were not interpreted.',
    );
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
  if (node(root, 'MetaData')) metadata.sourceTree = metadataTree(node(root, 'MetaData')!);
  metadata.hierarchy = metadataTree(root);
  const signals: NonNullable<MotionData['signals']> = [];
  // IKResults/IDResults are intentionally ignored by the viewer for now.
  // Their original datasets remain available to the raw-tree exporter.
  for (const groupName of ['EMG']) {
    const group = node(root, groupName);
    if (!group) continue;
    const data = numeric(node(group, 'Data', true), `${groupName}/Data`),
      labels = stringArray(attr(group, 'Labels'));
    if (data.shape.length !== 2 || data.shape[0] !== labels.length)
      throw new Error(`${groupName}/Data: labels and shape disagree.`);
    const n = data.shape[1],
      times = clock(group, groupName, n, timeOrigin);
    const storedRate = Number(scalar(attr(group, 'SamplingFrequency')));
    if (!times && !Number.isFinite(storedRate))
      throw new Error(`${groupName}: Time or SamplingFrequency required.`);
    const signalRate = Number.isFinite(storedRate)
      ? positiveRate(storedRate, groupName)
      : n > 1
        ? (n - 1) / (times![n - 1] - times![0])
        : rate;
    const units = stringArray(attr(group, 'Units'));
    if (times?.length && (times[0] >= frameCount / rate || times.at(-1)! < 0))
      warnings.push(
        `${groupName}: timestamps do not overlap the marker recording; no alignment offset has been invented.`,
      );
    labels.forEach((name, c) =>
      signals.push({
        name,
        group: groupName,
        unit: units[c] || 'unknown',
        signal: timed(
          {
            values: Float64Array.from({ length: n }, (_, i) => Number(data.values[c * n + i])),
            rate: signalRate,
            components: 1,
            startTime: 0,
          },
          times,
        ),
      }),
    );
  }
  const rigidBodies: NonNullable<MotionData['rigidBodies']> = [],
    bodies = node(root, 'RigidBodies');
  for (const key of bodies?.keys?.() ?? []) {
    const body = node(bodies!, key)!,
      path = `RigidBodies/${key}`,
      ps = metres(str(attr(body, 'Unit'), unit));
    const position = vector(node(body, 'Position'), `${path}/Position`, rate, ps);
    if (position.values.length !== frameCount * 3)
      throw new Error(`${path}/Position: cannot establish body sampling from marker grid.`);
    const times = pointClock?.map((t) => t - timeOrigin),
      rotationNode = node(body, 'Rotation');
    const rotation = rotationNode
      ? timed(tensor(rotationNode, `${path}/Rotation`, 9, rate), times)
      : undefined;
    if (rotation && rotation.values.length !== frameCount * 9)
      throw new Error(`${path}/Rotation: inconsistent body frame count.`);
    rigidBodies.push({
      name: str(attr(body, 'Name'), key),
      markers: stringArray(node(body, 'Markers')?.value),
      position: timed(position, times),
      rotation,
    });
    signals.push({
      name: str(attr(body, 'Name'), key),
      group: 'RigidBodies',
      unit: 'm',
      signal: timed(position, times),
    });
  }
  const typeNode = node(labeled, 'Type'),
    masks = node(labeled, 'CameraMasks');
  const type = typeNode ? tensor(typeNode, 'Trajectories/Labeled/Type', count, rate) : undefined;
  if (type && type.values.length !== count * frameCount)
    throw new Error('Trajectories/Labeled/Type: frame count mismatch.');
  const cameraCount = masks?.shape?.[1] ?? 0;
  const maskData = masks
    ? tensor(masks, 'Trajectories/Labeled/CameraMasks', count * cameraCount, rate)
    : undefined;
  if (maskData && maskData.values.length !== count * cameraCount * frameCount)
    throw new Error('Trajectories/Labeled/CameraMasks: frame count mismatch.');
  const flag = (key: string) => {
    const n = node(labeled, key);
    if (!n) return;
    const d = numeric(n, `Trajectories/Labeled/${key}`);
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
    name,
    source: {
      format: 'H5',
      originalPositionUnit: unit,
      metadata,
      ...(hasTrialClock ? { timeOrigin } : {}),
      ...(eventSchema ? { eventSchema } : {}),
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

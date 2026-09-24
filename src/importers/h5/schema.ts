import type { MotionData, Series, ForcePlatform } from '../../motion/types';
import { forceScale, metres, momentScale, positiveRate, uniqueLabels } from '../../motion/math';
import { validateMotion } from '../../motion/validation';

/** Structural subset of h5wasm, also usable with an in-memory test tree. */
export interface H5Node {
  attrs?: Record<string, { value: unknown }>;
  shape?: number[] | null;
  value?: unknown;
  get?: (path: string) => unknown;
  keys?: () => string[];
}
function node(parent: H5Node, path: string, required = false): H5Node | undefined {
  const item = parent.get?.(path) as H5Node | null;
  if (required && !item) throw new Error(`Unsupported institute H5 schema: missing ${path}.`);
  return item || undefined;
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
    throw new Error(`${path}: expected [3,samples] or [samples,3].`);
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
    throw new Error(`${path}: expected [3,4,samples].`);
  const count = shape[2] ?? 1;
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
    positions = new Float32Array(frameCount * count * 3),
    valid = new Uint8Array(frameCount * count);
  const resNode = node(labeled, 'Residuals');
  const res = resNode ? numeric(resNode, 'Residuals') : undefined;
  if (res && ![`${count},${frameCount}`, `1,${count},${frameCount}`].includes(res.shape.join(',')))
    throw new Error('H5 residual dimensions do not match markers.');
  const residuals = res ? new Float32Array(frameCount * count) : undefined;
  for (let f = 0; f < frameCount; f++)
    for (let m = 0; m < count; m++) {
      const i = f * count + m;
      for (let a = 0; a < 3; a++)
        positions[i * 3 + a] = Number(values[(m * 4 + a) * frameCount + f]) * scale;
      const residual = res ? Number(res.values[m * frameCount + f]) : 0;
      if (residuals) residuals[i] = residual < 0 ? -1 : residual * scale;
      valid[i] =
        residual >= 0 && [0, 1, 2].every((a) => Number.isFinite(positions[i * 3 + a])) ? 1 : 0;
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
      for (let c = 0; c < names.length; c++)
        analogs.push({
          name: names[c],
          unit: units[c] || 'unknown',
          signal: {
            values: Float64Array.from({ length: n }, (_, i) => Number(data.values[c * n + i])),
            rate: analogRate,
            components: 1,
            startTime: 0,
          },
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
      const force = vector(node(plate, 'Force'), `${path}/Force`, forceRate, fs),
        moment = vector(node(plate, 'Moment'), `${path}/Moment`, forceRate, ms),
        cop = vector(node(plate, 'COP'), `${path}/COP`, forceRate, ps);
      if (force.values.length !== moment.values.length || force.values.length !== cop.values.length)
        throw new Error('inconsistent vector lengths.');
      const countForce = force.values.length / 3;
      let geometry: Series | undefined;
      try {
        geometry = corners(
          node(plate, 'Location'),
          `${path}/Location`,
          frameCount,
          countForce,
          rate,
          forceRate,
          ps,
          warnings,
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
        if (d.values.length === countForce)
          freeMoment = {
            values: Float64Array.from(d.values, (v) => Number(v) * ms),
            rate: forceRate,
            components: 1,
            startTime: 0,
          };
      }
      forcePlatforms.push({
        name: plateName,
        force,
        moment,
        cop,
        corners: geometry,
        freeMoment,
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
  if (node(root, 'Events')?.keys?.().length)
    warnings.push(
      'H5 Events is nonempty, but its schema is undocumented; events were not interpreted.',
    );
  const metadata: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(node(root, 'MetaData')?.attrs || {})) metadata[k] = a.value;
  metadata.globalCoordinateSystem = attr(traj, 'GlobalCoordinateSystem') ?? '';
  const firstFrame = Number(scalar(attr(traj, 'StartFrame')) ?? 0);
  if (!Number.isSafeInteger(firstFrame)) throw new Error('Invalid H5 StartFrame.');
  return validateMotion({
    name,
    source: { format: 'H5', originalPositionUnit: unit, metadata },
    timeline: { frameCount, rate, firstFrame, duration: (frameCount - 1) / rate },
    markers: { labels, positions, valid, residuals },
    analogs,
    forcePlatforms,
    events: [],
    warnings,
  });
}

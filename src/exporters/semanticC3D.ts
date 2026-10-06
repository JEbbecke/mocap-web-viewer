import type { MotionData, Vec3 } from '../motion/types';
import { inPlateFrame, requireConversion } from './conversion';
import { mul, uniqueLabels } from '../motion/math';
import { writeC3DEvents } from './c3dEvents';

/** Fresh Intel/IEEE C3D with physical float32 samples, identity analog scaling,
 * and explicitly derived TYPE-2 plate channels. Never invents hardware calibration. */
export function exportSemanticC3D(data: MotionData): ArrayBuffer {
  const plan = requireConversion(data, 'C3D');
  const { frameCount: frames, rate, firstFrame } = data.timeline;
  const markerCount = data.markers.labels.length;
  const channels = [...plan.analogs];
  const mappings: number[] = [];
  for (const plate of plan.plates) {
    const p = data.forcePlatforms[plate.index];
    const samples = p.force.values.length / 3;
    const values = Array.from({ length: 6 }, () => new Float64Array(samples));
    for (let i = 0; i < samples; i++) {
      const f = inPlateFrame(
        plate.basis,
        Array.from(p.force.values.subarray(i * 3, i * 3 + 3)) as Vec3,
      );
      const m = inPlateFrame(
        plate.basis,
        mul(Array.from(p.moment.values.subarray(i * 3, i * 3 + 3)) as Vec3, 1000),
      );
      [...f, ...m].forEach((v, c) => {
        values[c][i] = v;
      });
    }
    for (let c = 0; c < 6; c++) {
      mappings.push(channels.length + 1);
      channels.push({
        name: `DerivedPlate${plate.index + 1}_${['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'][c]}`,
        unit: c < 3 ? 'N' : 'Nmm',
        signal: { values: values[c], rate: plan.analogRate, components: 1, startTime: 0 },
      });
    }
  }
  const names = uniqueLabels(channels.map((a) => a.name));
  const subframes = channels.length ? plan.analogRate / rate : 0;
  const records: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const record = (id: number, name: string, payload: Uint8Array) => {
    if (payload.length + 2 > 32767) throw new Error('C3D parameter exceeds record capacity.');
    const bytes = new Uint8Array(name.length + 4 + payload.length);
    bytes[0] = name.length;
    new DataView(bytes.buffer).setInt8(1, id);
    bytes.set(encoder.encode(name), 2);
    new DataView(bytes.buffer).setInt16(name.length + 2, payload.length + 2, true);
    bytes.set(payload, name.length + 4);
    records.push(bytes);
    return bytes;
  };
  const group = (id: number, name: string) => record(-id, name, Uint8Array.of(0));
  const parameter = (id: number, name: string, kind: number, dims: number[], raw: Uint8Array) => {
    if (dims.some((d) => !Number.isInteger(d) || d < 0 || d > 255))
      throw new Error('C3D parameter dimensions exceed 255.');
    const payload = new Uint8Array(3 + dims.length + raw.length);
    payload[0] = kind & 255;
    payload[1] = dims.length;
    payload.set(dims, 2);
    payload.set(raw, 2 + dims.length);
    return record(id, name, payload);
  };
  const numeric = (id: number, name: string, kind: 2 | 4, dims: number[], values: number[]) => {
    const raw = new Uint8Array(values.length * kind),
      view = new DataView(raw.buffer);
    values.forEach((v, i) =>
      kind === 4 ? view.setFloat32(i * 4, v, true) : view.setUint16(i * 2, v & 65535, true),
    );
    return parameter(id, name, kind, dims, raw);
  };
  const text = (id: number, name: string, values: string[]) => {
    let at = 0,
      segment = 1;
    while (at < values.length) {
      let n = 0,
        width = 1;
      while (at + n < values.length && n < 255) {
        const next = Math.max(width, encoder.encode(values[at + n]).length);
        if (next > 255) throw new Error(`C3D ${name} text exceeds 255 UTF-8 bytes.`);
        if (next * (n + 1) > 32000) break;
        width = next;
        n++;
      }
      const raw = new Uint8Array(width * n).fill(32);
      for (let i = 0; i < n; i++) raw.set(encoder.encode(values[at + i]), i * width);
      parameter(id, segment === 1 ? name : `${name}${segment}`, -1, [width, n], raw);
      at += n;
      segment++;
    }
  };
  group(1, 'POINT');
  numeric(1, 'USED', 2, [], [markerCount]);
  numeric(1, 'FRAMES', 2, [], [Math.min(frames, 65535)]);
  if (frames >= 65535) numeric(1, 'LONG_FRAMES', 4, [], [frames]);
  numeric(1, 'RATE', 4, [], [rate]);
  numeric(1, 'SCALE', 4, [], [-plan.residualStep]);
  const dataStartRecord = numeric(1, 'DATA_START', 2, [], [0]);
  parameter(1, 'UNITS', -1, [2], encoder.encode('mm'));
  text(1, 'LABELS', data.markers.labels);
  group(2, 'ANALOG');
  numeric(2, 'USED', 2, [], [channels.length]);
  numeric(2, 'RATE', 4, [], [plan.analogRate]);
  numeric(2, 'GEN_SCALE', 4, [], [1]);
  // One-dimensional numeric parameters can be segmented only where readers
  // understand continuation. Limit analog channels to 255 for interoperable scaling.
  if (channels.length > 255)
    throw new Error(
      'Cross-format C3D currently supports at most 255 analog channels, including derived force channels.',
    );
  if (channels.length) {
    numeric(
      2,
      'SCALE',
      4,
      [channels.length],
      channels.map(() => 1),
    );
    numeric(
      2,
      'OFFSET',
      2,
      [channels.length],
      channels.map(() => 0),
    );
    text(2, 'LABELS', names);
    text(
      2,
      'UNITS',
      channels.map((a) => a.unit),
    );
  }
  group(3, 'TRIAL');
  const first = firstFrame + 1,
    last = firstFrame + frames;
  numeric(3, 'ACTUAL_START_FIELD', 2, [2], [first & 65535, Math.floor(first / 65536)]);
  numeric(3, 'ACTUAL_END_FIELD', 2, [2], [last & 65535, Math.floor(last / 65536)]);
  group(4, 'FORCE_PLATFORM');
  numeric(4, 'USED', 2, [], [plan.plates.length]);
  if (plan.plates.length) {
    numeric(
      4,
      'TYPE',
      2,
      [plan.plates.length],
      plan.plates.map(() => 2),
    );
    numeric(4, 'CHANNEL', 2, [6, plan.plates.length], mappings);
    numeric(
      4,
      'ORIGIN',
      4,
      [3, plan.plates.length],
      plan.plates.flatMap(() => [0, 0, 0]),
    );
    numeric(
      4,
      'CORNERS',
      4,
      [3, 4, plan.plates.length],
      plan.plates.flatMap((p) => Array.from(data.forcePlatforms[p.index].corners!.values)),
    );
    numeric(4, 'ZERO', 2, [2], [0, 0]);
    text(
      4,
      'LABELS',
      plan.plates.map((p) => data.forcePlatforms[p.index].name),
    );
    text(
      4,
      'DESCRIPTIONS',
      plan.plates.map(() => 'Derived six-axis wrench; not original hardware acquisition channels'),
    );
  }
  group(5, 'SUBJECT');
  const fields = {
    id: 'SUBJECTID',
    age: 'AGE',
    sex: 'SEX',
    height: 'BODYHEIGHT',
    mass: 'BODYMASS',
    condition: 'CONDITION',
    name: 'NAME',
  } as const;
  for (const [field, name] of Object.entries(fields)) {
    const value = data.source.info?.subject?.[field as keyof typeof fields];
    if (
      value?.values.length === 1 &&
      encoder.encode(value.values[0]).length <= 255 &&
      !value.values[0].includes('\0') &&
      (!value.unit || (encoder.encode(value.unit).length <= 255 && !value.unit.includes('\0')))
    ) {
      text(5, name, value.values);
      if (value.unit) text(5, `${name}_UNITS`, [value.unit]);
    }
  }
  const size = 4 + records.reduce((sum, r) => sum + r.length, 0) + 2;
  const blocks = Math.ceil(size / 512);
  if (blocks > 255) throw new Error('C3D parameter section exceeds 255 blocks.');
  const dataStart = 512 + blocks * 512;
  new DataView(dataStartRecord.buffer).setUint16(
    'DATA_START'.length + 6,
    dataStart / 512 + 1,
    true,
  );
  const frameBytes = (markerCount * 4 + channels.length * subframes) * 4;
  const bytesNeeded = Math.ceil((dataStart + frames * frameBytes) / 512) * 512;
  if (!Number.isSafeInteger(bytesNeeded) || bytesNeeded > 0x7fffffff)
    throw new Error('C3D output exceeds the supported 2 GiB browser buffer.');
  const bytes = new Uint8Array(bytesNeeded),
    view = new DataView(bytes.buffer);
  bytes[0] = 2;
  bytes[1] = 80;
  for (const [at, value] of [
    [2, markerCount],
    [4, channels.length * subframes],
    [6, Math.min(first, 65535)],
    [8, Math.min(last, 65535)],
    [16, dataStart / 512 + 1],
    [18, subframes],
  ])
    view.setUint16(at, value, true);
  view.setFloat32(12, -plan.residualStep, true);
  view.setFloat32(20, rate, true);
  bytes.set([0, 80, blocks, 84], 512);
  let at = 516;
  for (const r of records) {
    bytes.set(r, at);
    at += r.length;
  }
  at = dataStart;
  for (let f = 0; f < frames; f++) {
    for (let m = 0; m < markerCount; m++) {
      const index = f * markerCount + m;
      for (let axis = 0; axis < 3; axis++) {
        view.setFloat32(at, data.markers.positions[index * 3 + axis], true);
        at += 4;
      }
      const residual = data.markers.residuals?.[index];
      const packed = data.markers.valid[index]
        ? Number.isFinite(residual)
          ? Math.min(255, Math.max(0, Math.round(residual! / plan.residualStep)))
          : 0
        : -1;
      view.setFloat32(at, packed, true);
      at += 4;
    }
    for (let sub = 0; sub < subframes; sub++)
      for (const channel of channels) {
        view.setFloat32(at, channel.signal.values[f * subframes + sub], true);
        at += 4;
      }
  }
  return writeC3DEvents(bytes.buffer, data.events, firstFrame / rate);
}

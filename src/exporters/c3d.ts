import { parseC3D } from '../importers/c3d/importer';
import { readParameters, number, nums, type Parameter } from '../importers/c3d/parameters';
import { cropInterval, eventInInterval } from '../motion/crop';

/** Source-preserving crop serializer. Never requantizes scientific samples. */
export function exportC3D(source: ArrayBuffer, start: number, end: number): ArrayBuffer {
  const original = parseC3D(source, 'source.c3d');
  const interval = cropInterval(original, start, end);
  if (start === 0 && end === original.timeline.frameCount) return source.slice(0);
  const { params: p, little } = readParameters(new DataView(source));
  const input = new DataView(source);
  const dataStart = (number(p, 'POINT:DATA_START', input.getUint16(16, little)) - 1) * 512;
  const width = number(p, 'POINT:SCALE', input.getFloat32(12, little)) < 0 ? 4 : 2;
  const frameBytes =
    width *
    (original.markers.labels.length * 4 +
      (original.analogs.length * (original.analogs[0]?.signal.rate ?? 0)) / original.timeline.rate);
  const standardEnd =
    Math.ceil((dataStart + original.timeline.frameCount * frameBytes) / 512) * 512;
  if (
    source.byteLength > standardEnd &&
    new Uint8Array(source, standardEnd).some((value) => value !== 0)
  )
    throw new Error(
      'C3D contains undocumented trailing records; export stopped to avoid losing time-dependent data.',
    );
  const result = new ArrayBuffer(Math.ceil((dataStart + (end - start) * frameBytes) / 512) * 512);
  const bytes = new Uint8Array(result);
  bytes.set(new Uint8Array(source, 0, dataStart));
  bytes.set(
    new Uint8Array(source, dataStart + start * frameBytes, (end - start) * frameBytes),
    dataStart,
  );
  const out = new DataView(result);
  const write = (parameter: Parameter | undefined, values: number[]) => {
    if (!parameter) return;
    const s = parameter.storage!;
    if (s.kind < 0 || values.length * s.kind > s.bytes)
      throw new Error('Invalid temporal C3D parameter.');
    values.forEach((v, i) => {
      if (s.kind === 4) out.setFloat32(s.offset + i * 4, v, little);
      else if (s.kind === 2) out.setUint16(s.offset + i * 2, v, little);
      else out.setUint8(s.offset + i, v);
    });
  };
  const first = original.timeline.firstFrame + start + 1;
  const last = original.timeline.firstFrame + end;
  if (last > 65535 && (!p.has('TRIAL:ACTUAL_START_FIELD') || !p.has('TRIAL:ACTUAL_END_FIELD')))
    throw new Error('C3D crop beyond frame 65535 requires existing TRIAL frame parameters.');
  out.setUint16(6, Math.min(first, 65535), little);
  out.setUint16(8, Math.min(last, 65535), little);
  const frames = p.get('POINT:FRAMES');
  write(frames, [frames?.storage?.kind === 2 ? Math.min(end - start, 65535) : end - start]);
  write(p.get('POINT:LONG_FRAMES'), [end - start]);
  write(p.get('TRIAL:ACTUAL_START_FIELD'), [first & 65535, Math.floor(first / 65536)]);
  write(p.get('TRIAL:ACTUAL_END_FIELD'), [last & 65535, Math.floor(last / 65536)]);

  // Baseline recalculation using an incomplete interval would change forces in other readers.
  const zero = nums(p, 'FORCE_PLATFORM:ZERO');
  if (
    zero.length === 2 &&
    zero[1] > 0 &&
    zero[1] >= zero[0] &&
    (Math.max(1, zero[0]) < first || zero[1] > last)
  )
    throw new Error(
      'Crop excludes the FORCE_PLATFORM:ZERO baseline frames. Keep the baseline interval to preserve force calibration.',
    );

  const origin = original.timeline.firstFrame / original.timeline.rate;
  const inside = (absolute: number) =>
    eventInInterval(absolute - origin, interval.start, interval.end, origin);
  const used = number(p, 'EVENT:USED', 0);
  if (used) {
    const times = nums(p, 'EVENT:TIMES');
    if (used > 255 || times.length < used * 2 || [...p.keys()].some((k) => /^EVENT:.*\d+$/.test(k)))
      throw new Error('Segmented or malformed C3D event arrays cannot be cropped safely.');
    const keep = Array.from({ length: used }, (_, i) => i).filter((i) =>
      inside(times[2 * i] * 60 + times[2 * i + 1]),
    );
    for (const [key, parameter] of p) {
      if (!key.startsWith('EVENT:') || key === 'EVENT:USED') continue;
      const dimensions = parameter.dimensions;
      if (dimensions.at(-1) !== used) {
        if (
          [
            'EVENT:TIMES',
            'EVENT:LABELS',
            'EVENT:CONTEXTS',
            'EVENT:DESCRIPTIONS',
            'EVENT:ICON_IDS',
            'EVENT:GENERIC_FLAGS',
          ].includes(key)
        )
          throw new Error(`Unsupported event dimensions: ${key}.`);
        continue;
      }
      const s = parameter.storage!;
      const stride = s.bytes / used;
      const old = new Uint8Array(source, s.offset, s.bytes);
      bytes.fill(s.kind === -1 ? 32 : 0, s.offset, s.offset + s.bytes);
      keep.forEach((index, i) =>
        bytes.set(old.subarray(index * stride, (index + 1) * stride), s.offset + i * stride),
      );
    }
    write(p.get('EVENT:USED'), [keep.length]);
  }
  // Header events have their own flags and four-character labels. Preserve absolute times.
  if (input.getUint16(298, little) === 12345) {
    const n = Math.min(input.getUint16(300, little), 18);
    const keep = Array.from({ length: n }, (_, i) => i).filter((i) =>
      inside(input.getFloat32(304 + i * 4, little)),
    );
    bytes.fill(0, 304, 394);
    bytes.fill(32, 396, 468);
    keep.forEach((index, i) => {
      bytes.set(new Uint8Array(source, 304 + index * 4, 4), 304 + i * 4);
      bytes[376 + i] = input.getUint8(376 + index);
      bytes.set(new Uint8Array(source, 396 + index * 4, 4), 396 + i * 4);
    });
    out.setUint16(300, keep.length, little);
  }
  return result;
}

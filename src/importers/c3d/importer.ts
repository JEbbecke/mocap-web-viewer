import type { MotionData } from '../../motion/types';
import { metres, positiveRate, uniqueLabels } from '../../motion/math';
import { validateMotion } from '../../motion/validation';
import { readParameters, number, nums, strings, labels } from './parameters';
import { extractPlatforms } from './forces';

export function parseC3D(buffer: ArrayBuffer, name: string): MotionData {
  const view = new DataView(buffer),
    { params: p, little } = readParameters(view);
  if (number(p, 'ROTATION:USED', 0) > 0)
    throw new Error(
      'Nonstandard C3D rotation records are not supported. Re-export a standard point/analog C3D.',
    );
  const u16 = (offset: number) => view.getUint16(offset, little),
    f32 = (offset: number) => view.getFloat32(offset, little);
  const rate = positiveRate(number(p, 'POINT:RATE', f32(20)), 'Point');
  let count = number(p, 'POINT:USED', u16(2));
  if (p.get('POINT:USED')?.storage?.kind === 2) count &= 65535;
  const startFields = nums(p, 'TRIAL:ACTUAL_START_FIELD'),
    endFields = nums(p, 'TRIAL:ACTUAL_END_FIELD');
  const field = (values: number[]) => (values[0] & 65535) + (values[1] & 65535) * 65536;
  const firstFrame = (startFields.length === 2 ? field(startFields) : u16(6)) - 1;
  let frames = number(
    p,
    'POINT:FRAMES',
    endFields.length === 2 ? field(endFields) - firstFrame : u16(8) - u16(6) + 1,
  );
  if (p.get('POINT:FRAMES')?.storage?.kind === 2) frames &= 65535;
  if (frames === 65535)
    frames = number(
      p,
      'POINT:LONG_FRAMES',
      endFields.length === 2 ? field(endFields) - firstFrame : frames,
    );
  const scale = number(p, 'POINT:SCALE', f32(12)),
    floating = scale < 0;
  const channels = number(p, 'ANALOG:USED', 0),
    analogRate = channels ? positiveRate(number(p, 'ANALOG:RATE', rate * u16(18)), 'Analog') : 0;
  const subframes = channels ? analogRate / rate : 0;
  if (
    ![count, frames, channels, subframes].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    count < 1 ||
    frames < 1 ||
    !Number.isFinite(scale) ||
    scale === 0
  )
    throw new Error('Invalid C3D point/analog counts, rate ratio or scale.');
  const start = (number(p, 'POINT:DATA_START', u16(16)) - 1) * 512;
  const bytes = floating ? 4 : 2,
    frameBytes = (count * 4 + channels * subframes) * bytes;
  if (
    start < 512 ||
    !Number.isSafeInteger(start) ||
    start + frames * frameBytes > buffer.byteLength
  )
    throw new Error('Truncated C3D sample data.');
  const unit = strings(p, 'POINT:UNITS')[0] || '',
    lengthScale = metres(unit),
    warnings: string[] = [];
  const rawLabels = labels(p, 'POINT:LABELS');
  const markerLabels = uniqueLabels(
    Array.from({ length: count }, (_, i) => rawLabels[i] || `Marker ${i + 1}`),
  );
  if (rawLabels.length < count)
    warnings.push('Some point labels are missing; numbered labels were assigned.');
  const analogLabels = labels(p, 'ANALOG:LABELS'),
    analogUnits = labels(p, 'ANALOG:UNITS');
  const analogs = uniqueLabels(
    Array.from({ length: channels }, (_, i) => analogLabels[i] || `Analog ${i + 1}`),
  ).map((name, i) => ({
    name,
    unit: analogUnits[i] || 'unknown',
    signal: {
      values: new Float64Array(frames * subframes),
      rate: analogRate,
      components: 1,
      startTime: 0,
    },
  }));
  const positions = new Float32Array(frames * count * 3),
    valid = new Uint8Array(frames * count),
    residuals = new Float32Array(frames * count);
  const scales = nums(p, 'ANALOG:SCALE'),
    offsets = nums(p, 'ANALOG:OFFSET'),
    general = number(p, 'ANALOG:GEN_SCALE', 1);
  const unsigned = strings(p, 'ANALOG:FORMAT')[0]?.toUpperCase() === 'UNSIGNED';
  let at = start;
  for (let frame = 0; frame < frames; frame++) {
    for (let marker = 0; marker < count; marker++) {
      const index = frame * count + marker;
      for (let axis = 0; axis < 3; axis++) {
        positions[index * 3 + axis] =
          (floating ? f32(at) : view.getInt16(at, little) * scale) * lengthScale;
        at += bytes;
      }
      const packed = floating ? f32(at) : view.getInt16(at, little);
      at += bytes;
      residuals[index] =
        packed < 0 ? -1 : (Math.trunc(packed) & 255) * Math.abs(scale) * lengthScale;
      valid[index] =
        packed >= 0 && [0, 1, 2].every((a) => Number.isFinite(positions[index * 3 + a])) ? 1 : 0;
    }
    for (let subframe = 0; subframe < subframes; subframe++)
      for (let channel = 0; channel < channels; channel++) {
        const raw = floating
          ? f32(at)
          : unsigned
            ? view.getUint16(at, little)
            : view.getInt16(at, little);
        at += bytes;
        const offset = unsigned ? (offsets[channel] || 0) & 65535 : offsets[channel] || 0;
        analogs[channel].signal.values[frame * subframes + subframe] =
          (raw - offset) * (scales[channel] ?? 1) * general;
      }
  }
  const eventTimes = nums(p, 'EVENT:TIMES'),
    eventLabels = labels(p, 'EVENT:LABELS'),
    contexts = labels(p, 'EVENT:CONTEXTS');
  const events = Array.from({ length: number(p, 'EVENT:USED', 0) }, (_, i) => ({
    label: eventLabels[i] || `Event ${i + 1}`,
    context: contexts[i] || '',
    time: eventTimes[2 * i] * 60 + eventTimes[2 * i + 1] - firstFrame / rate,
  })).filter((e) => Number.isFinite(e.time));
  if (!events.length && u16(298) === 12345) {
    const n = Math.min(u16(300), 18);
    for (let i = 0; i < n; i++) {
      const label = new TextDecoder().decode(new Uint8Array(buffer, 396 + i * 4, 4)).trim();
      events.push({
        label: label || `Event ${i + 1}`,
        context: '',
        time: f32(304 + i * 4) - firstFrame / rate,
      });
    }
  }
  return validateMotion({
    name,
    source: {
      format: 'C3D',
      originalPositionUnit: unit,
      metadata: {
        processor: little ? 'Intel' : 'MIPS',
        screenX: strings(p, 'POINT:X_SCREEN')[0],
        screenY: strings(p, 'POINT:Y_SCREEN')[0],
      },
    },
    timeline: { rate, frameCount: frames, firstFrame, duration: (frames - 1) / rate },
    markers: { labels: markerLabels, positions, valid, residuals },
    analogs,
    forcePlatforms: extractPlatforms(p, analogs, lengthScale, warnings),
    events,
    warnings,
  });
}

import type { MotionData } from '../../motion/types';
import { labels, type Parameters } from './parameters';

/** Recognize only the documented, separate 17-float ROTATION extension.
 * No seeking by guessed stride, vendor name, file name or missing DATA_START.
 * See docs/PARSERS.md for the intentionally narrow compatibility boundary. */
export function omittedRotations(
  p: Parameters,
  view: DataView,
  pointEnd: number,
  pointRate: number,
  pointFrames: number,
  floating: boolean,
): MotionData['source']['partialImport'] {
  const keys = [...p.keys()].filter((key) => key.startsWith('ROTATION:'));
  if (!keys.length) return;
  const fail = (reason: string): never => {
    throw new Error(`Cannot safely skip C3D ROTATION data: ${reason}`);
  };
  const scalar = (name: string, kinds: number[]) => {
    const param = p.get(`ROTATION:${name}`);
    if (
      !param ||
      !kinds.includes(param.storage?.kind ?? 0) ||
      param.dimensions.length > 0 ||
      param.values.length !== 1 ||
      typeof param.values[0] !== 'number' ||
      !Number.isFinite(param.values[0])
    )
      return fail(`ROTATION:${name} must be a finite numeric scalar.`);
    return param.values[0];
  };
  // USED and DATA_START are unsigned 16-bit words, although parameter storage is signed.
  const signals = scalar('USED', [2]) & 65535;
  if (!signals) return;
  if (!floating) fail('the supported 17-float extension requires floating-point storage.');
  if (
    keys.some(
      (key) =>
        !/^ROTATION:(USED|DATA_START|RATE|RATIO|FRAMES|LABELS\d*|DESCRIPTIONS?\d*)$/.test(key),
    )
  )
    fail('unrecognized rotation parameters; record encoding cannot be established.');
  const dataStartBlock = scalar('DATA_START', [2]) & 65535;
  const rate = scalar('RATE', [4]);
  const ratio = scalar('RATIO', [2]);
  if (!Number.isSafeInteger(ratio) || ratio < 1 || rate <= 0 || rate !== pointRate * ratio)
    fail('ROTATION:RATE/RATIO disagree with the point sampling rate.');
  const frames = pointFrames * ratio;
  if (p.has('ROTATION:FRAMES')) {
    const declared = scalar('FRAMES', [2, 4]);
    const unsigned = p.get('ROTATION:FRAMES')!.storage!.kind === 2 ? declared & 65535 : declared;
    if (unsigned !== frames) fail('ROTATION:FRAMES disagrees with the point frames and ratio.');
  }
  const names = labels(p, 'ROTATION:LABELS');
  if (
    keys.some((key) => /^ROTATION:LABELS\d*$/.test(key) && p.get(key)!.storage?.kind !== -1) ||
    names.length !== signals ||
    names.some((name) => !name) ||
    new Set(names).size !== signals
  )
    fail('ROTATION:LABELS do not identify every rotation signal.');
  const byteOffset = (dataStartBlock - 1) * 512;
  const byteLength = frames * signals * 17 * 4;
  const end = byteOffset + byteLength;
  // This compatibility path accepts only a separate block immediately after
  // standard point/analog frames. Interleaved, overlapping and unknown gaps fail.
  if (byteOffset !== Math.ceil(pointEnd / 512) * 512)
    fail('ROTATION:DATA_START is inconsistent with the end of point/analog records.');
  if (!Number.isSafeInteger(frames) || !Number.isSafeInteger(end) || end > view.byteLength)
    fail('truncated rotation records or invalid sample counts.');
  if (view.byteLength > Math.ceil(end / 512) * 512)
    fail('unexpected records follow the declared 17-float rotation section.');
  const nonzero = (start: number, stop: number) => {
    for (let i = start; i < stop; i++) if (view.getUint8(i)) return true;
    return false;
  };
  if (nonzero(pointEnd, byteOffset) || nonzero(end, view.byteLength))
    fail('nonzero bytes outside the declared point/analog and rotation records.');
  return {
    omitted: 'C3D_ROTATION',
    rotation: {
      signals,
      labels: names,
      rate,
      ratio,
      frames,
      dataStartBlock,
      byteOffset,
      byteLength,
      encoding: 'column-major-4x4+reliability-float32',
    },
  };
}

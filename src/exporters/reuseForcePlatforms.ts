import type { C3DPlateDefinition, ForcePlatform, MotionData, Vec3 } from '../motion/types';
import { add, mul, plateBasis, rotate } from '../motion/math';
import { localWrench } from '../importers/c3d/forces';

export interface AnalogEncoding {
  scale: number;
  offset: number;
}
export const encodedAnalog = (value: number, encoding: AnalogEncoding) =>
  Math.fround(value / encoding.scale + encoding.offset);
export const decodedAnalog = (value: number, encoding: AnalogEncoding) =>
  (encodedAnalog(value, encoding) - encoding.offset) * encoding.scale;
const equal = (a: number, b: number, absolute: number, relative = 1e-7) =>
  (Number.isNaN(a) && Number.isNaN(b)) ||
  (Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= absolute + relative * Math.max(Math.abs(a), Math.abs(b)));

export function analogEncodings(
  data: MotionData,
  analogs: MotionData['analogs'],
): AnalogEncoding[] {
  const original = data.source.c3dAnalogEncoding;
  return analogs.map((channel, i) => {
    const identity = channel.sourceChannel ?? (i < data.analogs.length ? i : -1);
    const scale = original?.scale[identity],
      originalOffset = original?.offset[identity];
    if (scale === undefined || originalOffset === undefined) return { scale: 1, offset: 0 };
    // Some float readers take abs(OFFSET). Rebase negative offsets to zero and
    // verify the decoded values instead of depending on that reader behavior.
    const offset = Math.max(0, originalOffset);
    const encoding = { scale, offset };
    if (
      !scale ||
      !Number.isFinite(scale) ||
      Math.fround(scale) !== scale ||
      !Number.isInteger(offset) ||
      offset < -32768 ||
      offset > 32767 ||
      channel.signal.values.some(
        (v) =>
          Number.isFinite(v) &&
          (!Number.isFinite(encodedAnalog(v, encoding)) ||
            !equal(decodedAnalog(v, encoding), v, 1e-8)),
      )
    )
      return { scale: 1, offset: 0 };
    return encoding;
  });
}

/** Validate the original definition against current data and the exact float32
 * metadata/sample encoding. Stale mappings fall back per plate, never by label. */
export function reuseForcePlatform(
  p: ForcePlatform,
  analogs: MotionData['analogs'],
  encodings: AnalogEncoding[],
  rate: number,
): C3DPlateDefinition {
  const source = p.c3dSource?.definition;
  if (!source) throw new Error(p.c3dSource?.issue ?? 'original C3D definition is unavailable');
  if (![2, 3, 4].includes(source.type) || source.channels.length !== (source.type === 3 ? 8 : 6))
    throw new Error('invalid original plate definition');
  if (
    source.corners.length !== 12 ||
    source.origin.length !== 3 ||
    (source.type === 4 && source.calibration?.length !== 36) ||
    (source.copPolynomial && source.copPolynomial.length !== 12)
  )
    throw new Error('incomplete original geometry/calibration');
  if (source.corners.some((v, i) => !equal(v, p.corners!.values[i], 1e-6)))
    throw new Error('original corners differ from current geometry');
  if (
    p.origin &&
    (p.origin.length !== 3 ||
      source.origin.some(
        (v, axis) => !equal(v, p.origin![axis] * (p.origin![2] > 0 ? -1 : 1), 1e-6),
      ))
  )
    throw new Error('original origin differs from current geometry');
  const hasIdentities = analogs.some((a) => a.sourceChannel !== undefined);
  const channels = source.channels.map((identity) => {
    const matches = analogs.flatMap((a, i) =>
      (hasIdentities ? a.sourceChannel === identity : i === identity) ? [i] : [],
    );
    if (matches.length !== 1) throw new Error('original analog channels are missing or ambiguous');
    return matches[0];
  });
  if (new Set(channels).size !== channels.length)
    throw new Error('duplicate original channel mapping');
  for (const [j, index] of channels.entries()) {
    const channel = analogs[index];
    if (
      channel.signal.components !== 1 ||
      channel.signal.rate !== rate ||
      channel.signal.values.length !== p.force.values.length / 3
    )
      throw new Error('original channels differ from the force sample grid');
    const unit = channel.unit.toLowerCase().replace(/[\s*·⋅]/g, '');
    // Legacy calibrated TYPE-2/3 signals can retain V acquisition labels.
    const supported =
      source.type === 4
        ? ['', 'unknown', 'v']
        : source.type === 2 && j >= 3
          ? ['', 'unknown', 'v', 'nmm']
          : ['', 'unknown', 'v', 'n'];
    if (!supported.includes(unit))
      throw new Error('original channel units are incompatible with mm/N/Nmm');
  }
  if (
    p.cop.components !== 3 ||
    p.cop.rate !== rate ||
    p.cop.values.length !== p.force.values.length ||
    (p.freeMoment &&
      (![1, 3].includes(p.freeMoment.components) ||
        p.freeMoment.rate !== rate ||
        p.freeMoment.values.length / p.freeMoment.components !== p.force.values.length / 3))
  )
    throw new Error('stored COP/free moment cannot be compared on the original sample grid');
  const geometry = (round: boolean) => {
    const corners = Array.from(
      { length: 4 },
      (_, i) =>
        Array.from(p.corners!.values.subarray(i * 3, i * 3 + 3), (v) =>
          round ? Math.fround(v) : v,
        ) as Vec3,
    );
    return {
      basis: plateBasis(corners),
      center: mul(
        corners.reduce((sum, c) => add(sum, c), [0, 0, 0] as Vec3),
        0.25,
      ),
    };
  };
  for (const round of [false, true]) {
    const { basis, center } = geometry(round);
    const origin = source.origin.map((v) => (round ? Math.fround(v) : v)) as Vec3;
    const calibration =
      source.calibration && Array.from(source.calibration, (v) => (round ? Math.fround(v) : v));
    const polynomial =
      source.copPolynomial && Array.from(source.copPolynomial, (v) => (round ? Math.fround(v) : v));
    if ([...origin, ...(calibration ?? []), ...(polynomial ?? [])].some((v) => !Number.isFinite(v)))
      throw new Error('original metadata exceeds float32 capacity');
    for (let i = 0; i < p.force.values.length / 3; i++) {
      const values = channels.map((c) => {
        const value = analogs[c].signal.values[i];
        return round ? decodedAnalog(value, encodings[c]) : value;
      });
      if (values.some((v) => !Number.isFinite(v)))
        throw new Error('original channels contain nonfinite samples');
      const wrench = localWrench(source.type, values, origin, calibration, polynomial);
      const force = rotate(basis, wrench.force),
        moment = mul(rotate(basis, wrench.moment), 0.001);
      const cop = add(center, rotate(basis, wrench.cop)),
        free = mul(rotate(basis, wrench.freeMoment), 0.001);
      for (const [name, vector, stored, absolute] of [
        ['force', force, p.force, round ? 1e-5 : 1e-6],
        ['moment', moment, p.moment, round ? 1e-5 : 1e-6],
        ['COP', cop, p.cop, round ? 1e-3 : 1e-4],
        ['free moment', free, p.freeMoment, round ? 1e-5 : 1e-6],
      ] as const) {
        if (!stored) continue;
        if (
          stored.components === 1 &&
          basis[2].some((v, axis) => !equal(v, axis === 2 ? 1 : 0, 1e-6))
        )
          throw new Error('scalar free-moment coordinate convention is unverified');
        const actual = stored.components === 1 ? [vector[2]] : vector;
        if (
          actual.some(
            (v, axis) =>
              !equal(v, stored.values[i * stored.components + axis], absolute, round ? 1e-6 : 1e-7),
          )
        )
          throw new Error(
            `${round ? 'float32 encoding of' : 'reconstruction from'} original channels differs from stored ${name}`,
          );
      }
    }
  }
  return { ...source, channels };
}

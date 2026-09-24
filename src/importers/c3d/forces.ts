import type { ForcePlatform, MotionData, Vec3 } from '../../motion/types';
import { add, cross, forceScale, mul, plateBasis, rotate } from '../../motion/math';
import { nums, number, strings, type Parameters } from './parameters';

/** Matches the reference ezc3d surface moment/COP conventions; inputs already analog-scaled. */
export function localWrench(
  type: number,
  channels: number[],
  origin: Vec3,
  calibration?: number[],
  polynomial?: number[],
) {
  let f: Vec3, m: Vec3;
  if (type === 3) {
    const c = channels;
    f = [c[0] + c[1], c[2] + c[3], c[4] + c[5] + c[6] + c[7]];
    m = [
      origin[1] * (c[4] + c[5] - c[6] - c[7]),
      origin[0] * (c[5] + c[6] - c[4] - c[7]),
      origin[1] * (c[1] - c[0]) + origin[0] * (c[2] - c[3]),
    ];
    m = add(m, cross(f, [0, 0, origin[2]]));
  } else {
    const c =
      type === 4
        ? Array.from({ length: 6 }, (_, row) =>
            channels.reduce((s, x, col) => s + x * calibration![col * 6 + row], 0),
          )
        : channels;
    f = c.slice(0, 3) as Vec3;
    m = add(c.slice(3, 6) as Vec3, cross(f, origin));
  }
  const cop: Vec3 = Math.abs(f[2]) > 1e-12 ? [-m[1] / f[2], m[0] / f[2], 0] : [NaN, NaN, NaN];
  if (type === 3 && polynomial?.length === 12 && Number.isFinite(cop[0])) {
    const [x, y] = cop,
      p = polynomial;
    cop[0] -=
      (p[0] * y ** 4 + p[1] * y ** 2 + p[2]) * x ** 3 + (p[3] * y ** 4 + p[4] * y ** 2 + p[5]) * x;
    cop[1] -=
      (p[6] * x ** 4 + p[7] * x ** 2 + p[8]) * y ** 3 +
      (p[9] * x ** 4 + p[10] * x ** 2 + p[11]) * y;
  }
  return { force: f, moment: m, cop, freeMoment: add(m, cross(f, cop)) };
}

export function extractPlatforms(
  p: Parameters,
  analogs: MotionData['analogs'],
  lengthScale: number,
  warnings: string[],
): ForcePlatform[] {
  const result: ForcePlatform[] = [],
    used = number(p, 'FORCE_PLATFORM:USED', 0);
  if (!Number.isSafeInteger(used) || used < 0 || used > 1024)
    throw new Error('Invalid force-platform count.');
  const types = nums(p, 'FORCE_PLATFORM:TYPE'),
    corners = nums(p, 'FORCE_PLATFORM:CORNERS'),
    origins = nums(p, 'FORCE_PLATFORM:ORIGIN');
  const channels = nums(p, 'FORCE_PLATFORM:CHANNEL'),
    stride = p.get('FORCE_PLATFORM:CHANNEL')?.dimensions[0] || 0;
  const matrices = nums(p, 'FORCE_PLATFORM:CAL_MATRIX'),
    poly = nums(p, 'FORCE_PLATFORM:FPCOPPOLY');
  const matrixStride =
    (p.get('FORCE_PLATFORM:CAL_MATRIX')?.dimensions[0] || 0) *
    (p.get('FORCE_PLATFORM:CAL_MATRIX')?.dimensions[1] || 0);
  for (let plate = 0; plate < used; plate++) {
    try {
      const type = types[plate];
      if (![2, 3, 4].includes(type))
        throw new Error(`type ${type} is not supported (supported: 2, 3, 4).`);
      if (corners.length < (plate + 1) * 12 || origins.length < (plate + 1) * 3)
        throw new Error('missing CORNERS or ORIGIN.');
      const c = Array.from(
        { length: 4 },
        (_, j) => corners.slice(plate * 12 + j * 3, plate * 12 + j * 3 + 3) as Vec3,
      );
      const basis = plateBasis(c),
        center = mul(
          c.reduce((a, b) => add(a, b), [0, 0, 0] as Vec3),
          0.25,
        );
      let origin = origins.slice(plate * 3, plate * 3 + 3) as Vec3;
      if (origin[2] > 0) origin = mul(origin, -1);
      const nchan = type === 3 ? 8 : 6;
      if (stride < nchan) throw new Error('incomplete channel mapping.');
      const signals = Array.from(
        { length: nchan },
        (_, j) => analogs[channels[plate * stride + j] - 1]?.signal,
      );
      if (signals.some((s) => !s)) throw new Error('missing analog channel.');
      const cal = matrices.slice(plate * matrixStride, plate * matrixStride + 36);
      if (type === 4 && (matrixStride !== 36 || cal.length !== 36))
        throw new Error('missing 6 × 6 calibration matrix.');
      const samples = signals[0].values.length,
        rate = signals[0].rate;
      const force = new Float64Array(samples * 3),
        moment = new Float64Array(samples * 3),
        cop = new Float64Array(samples * 3),
        freeMoment = new Float64Array(samples * 3);
      const fs = forceScale(strings(p, 'FORCE_PLATFORM:UNITS')[0] || 'N');
      for (let i = 0; i < samples; i++) {
        const w = localWrench(
          type,
          signals.map((s) => s.values[i]),
          origin,
          cal,
          poly.slice(plate * 12, plate * 12 + 12),
        );
        force.set(mul(rotate(basis, w.force), fs), i * 3);
        moment.set(mul(rotate(basis, w.moment), fs * lengthScale), i * 3);
        cop.set(mul(add(rotate(basis, w.cop), center), lengthScale), i * 3);
        freeMoment.set(mul(rotate(basis, w.freeMoment), fs * lengthScale), i * 3);
      }
      const series = (values: Float64Array, components = 3) => ({
        values,
        rate,
        components,
        startTime: 0,
      });
      result.push({
        name: `Plate ${plate + 1}`,
        force: series(force),
        moment: series(moment),
        cop: series(cop),
        freeMoment: series(freeMoment),
        corners: series(
          Float64Array.from(c.flat(), (x) => x * lengthScale),
          12,
        ),
        coordinateFrame: 'global',
        provenance: `C3D type ${type}; surface-centre moments; ezc3d conventions`,
      });
    } catch (error) {
      warnings.push(
        `Force platform ${plate + 1}: ${error instanceof Error ? error.message : String(error)} Analog channels remain available.`,
      );
    }
  }
  return result;
}

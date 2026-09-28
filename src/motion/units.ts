/** Scientific units of normalized MotionData; analog/named signals retain their own units. */
export const MOTION_UNITS = {
  position: 'mm',
  residual: 'mm',
  force: 'N',
  moment: 'Nm',
  time: 's',
} as const;

/** Used for physical moment conversion, independently of the renderer. */
export const METRES_PER_MILLIMETRE = 0.001;

/** Multiply a source distance by this factor to obtain canonical millimetres. */
export function millimetres(unit: string): number {
  const scale = ({ mm: 1, cm: 10, m: 1000 } as Record<string, number>)[unit.trim().toLowerCase()];
  if (!scale) throw new Error(`Unsupported position unit “${unit}”. Expected mm, cm or m.`);
  return scale;
}

/** Multiply a source force by this factor to obtain Newtons. */
export function forceScale(unit: string): number {
  const scale = ({ n: 1, kn: 1000 } as Record<string, number>)[unit.trim().toLowerCase()];
  if (!scale) throw new Error(`Unsupported force unit “${unit}”.`);
  return scale;
}

/** Multiply a source moment by this factor to obtain Newton-metres (not Nmm). */
export function momentScale(unit: string): number {
  const normalized = unit.toLowerCase().replace(/[\s*·⋅]/g, '');
  const scale = (
    { nm: 1, nmm: 0.001, ncm: 0.01, knm: 1000, knmm: 1, kncm: 10 } as Record<string, number>
  )[normalized];
  if (!scale) throw new Error(`Unsupported moment unit “${unit}”.`);
  return scale;
}

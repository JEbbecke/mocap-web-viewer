import type { Series, Vec3 } from './types';
export function positiveRate(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label}: sampling rate must be positive.`);
  return value;
}
export function metres(unit: string): number {
  const scale = ({ mm: 0.001, cm: 0.01, m: 1 } as Record<string, number>)[
    unit.trim().toLowerCase()
  ];
  if (!scale) throw new Error(`Unsupported position unit “${unit}”. Expected mm, cm or m.`);
  return scale;
}
export function forceScale(unit: string): number {
  if (unit.toLowerCase() === 'n') return 1;
  if (unit.toLowerCase() === 'kn') return 1000;
  throw new Error(`Unsupported force unit “${unit}”.`);
}
export function momentScale(unit: string): number {
  const normalized = unit.toLowerCase().replace(/[ *·]/g, '');
  const s = ({ nm: 1, nmm: 0.001, ncm: 0.01, knm: 1000 } as Record<string, number>)[normalized];
  if (!s) throw new Error(`Unsupported moment unit “${unit}”.`);
  return s;
}
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(...a);
  if (!Number.isFinite(length) || length < 1e-12)
    throw new Error('Degenerate force-platform corners.');
  return mul(a, 1 / length);
}
export function plateBasis(corners: Vec3[]): Vec3[] {
  const x = normalize(sub(corners[0], corners[1]));
  const z = normalize(cross(x, sub(corners[0], corners[3])));
  return [x, normalize(cross(z, x)), z];
}
export function rotate(basis: Vec3[], v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => basis[0][i] * v[0] + basis[1][i] * v[1] + basis[2][i] * v[2]) as Vec3;
}
/** Display interpolation only; preserve gaps, never extrapolate or filter. */
export function sample(
  series: Series,
  time: number,
  component = 0,
  staticGeometry = false,
): number {
  const n = series.values.length / series.components;
  if (!n) return NaN;
  if (staticGeometry && n === 1) return series.values[component];
  let index = (time - series.startTime) * series.rate;
  if (series.times) {
    const times = series.times;
    if (!n || time < times[0] - 1e-8 || time > times[n - 1] + 1e-8) return NaN;
    let lo = 0,
      hi = n - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (times[mid] <= time) lo = mid;
      else hi = mid - 1;
    }
    index = lo === n - 1 ? lo : lo + (time - times[lo]) / (times[lo + 1] - times[lo]);
  }
  if (index < -1e-8 || index > n - 1 + 1e-8) return NaN;
  const clamped = Math.max(0, Math.min(n - 1, index));
  const lo = Math.floor(clamped),
    fraction = clamped - lo;
  const a = series.values[lo * series.components + component];
  if (fraction < 1e-8) return a;
  const b = series.values[(lo + 1) * series.components + component];
  return a + (b - a) * fraction;
}
export const sample3 = (s: Series, t: number): Vec3 => [
  sample(s, t, 0),
  sample(s, t, 1),
  sample(s, t, 2),
];
export const frameAt = (time: number, rate: number, count: number) =>
  Math.max(0, Math.min(count - 1, Math.round(time * rate)));
export function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels.map((label, i) => {
    const base = label.trim() || `Channel ${i + 1}`;
    let result = base,
      suffix = 2;
    while (seen.has(result)) result = `${base}_${suffix++}`;
    seen.add(result);
    return result;
  });
}

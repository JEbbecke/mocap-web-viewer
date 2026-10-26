/** Clean display noise only; sub-frame event precision is independent of the sample clock. */
export function formatEventTime(time: number, rate: number): string {
  if (!Number.isFinite(time)) return String(time);
  const precision = Math.min(
    100,
    Math.max(3, Number.isFinite(rate) && rate > 0 ? Math.ceil(Math.log10(rate)) : 3),
  );
  // A few floating-point ulps, capped well below a sample interval. Do not collapse
  // small nonzero events to zero or use the much wider import/crop tolerance.
  const tolerance = Math.min(
    8 * Number.EPSILON * Math.abs(time),
    rate > 0 ? 1e-7 / rate : Infinity,
  );
  for (let digits = precision; digits <= Math.max(precision, 17); digits++) {
    const text = time.toFixed(digits);
    if (Math.abs(Number(text) - time) <= tolerance) return text;
  }
  return String(time);
}

/** An untouched presentation must never round the timestamp used by save or frame mapping. */
export function eventTimeValue(input: string, original: { value: number; text: string }): number {
  return input === original.text ? original.value : Number(input);
}

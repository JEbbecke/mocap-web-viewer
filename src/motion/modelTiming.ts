/** Model source clock and normalization shared by import, source readers and crop. */
export interface ModelView {
  range?: { start: number; end: number };
  timeOrigin?: number;
}
interface Dataset {
  shape?: number[] | null;
  value?: unknown;
  slice?: (ranges: [number, number][]) => unknown;
}
export interface ModelGroup {
  attrs?: Record<string, { value: unknown }>;
  get?: (name: string) => unknown;
}
const scalar = (value: unknown) =>
  Number(
    Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<unknown>)[0] : value,
  );
export function modelTimeRow(group: ModelGroup, rows: number) {
  const raw = group.attrs?.Labels?.value;
  const labels = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return labels.length === rows
    ? labels.findIndex((v) => typeof v === 'string' && v.trim().toLowerCase() === 'time')
    : -1;
}
export function modelClock(group: ModelGroup) {
  const data = group.get?.('Data') as Dataset | undefined;
  const n = data?.shape?.[1] ?? 0;
  const explicit = group.get?.('Time') as Dataset | undefined;
  const row = modelTimeRow(group, data?.shape?.[0] ?? 0);
  const rate = scalar(group.attrs?.SamplingFrequency?.value);
  const first = scalar(group.attrs?.StartFrame?.value);
  const read = (dataset: Dataset, a: number, b: number, column?: number) => {
    const raw = dataset.slice
      ? dataset.slice(
          column === undefined
            ? [[a, b]]
            : [
                [column, column + 1],
                [a, b],
              ],
        )
      : (dataset.value as ArrayLike<number>);
    if (!(Array.isArray(raw) || ArrayBuffer.isView(raw)))
      throw Error('Model dataset is not numeric.');
    const values = raw as ArrayLike<unknown>;
    if (dataset.slice && values.length !== b - a)
      throw Error('Model slice size does not match its dimensions.');
    return Float64Array.from({ length: b - a }, (_, i) => {
      const value = values[dataset.slice ? i : (column ?? 0) * n + a + i];
      if (typeof value !== 'number' && typeof value !== 'bigint')
        throw Error('Model dataset is not numeric.');
      return Number(value);
    });
  };
  if (explicit && (explicit.shape?.length !== 1 || explicit.shape[0] !== n))
    throw Error('Model Time sample count mismatch.');
  const known = !!explicit || row >= 0 || (Number.isFinite(rate) && rate > 0);
  return {
    count: n,
    rate,
    known,
    read: (a: number, b: number) =>
      explicit
        ? read(explicit, a, b)
        : row >= 0
          ? read(data!, a, b, row)
          : Float64Array.from({ length: b - a }, (_, i) =>
              known ? ((Number.isFinite(first) ? first : 0) + a + i) / rate : NaN,
            ),
  };
}

/** Matches the importer's 100 ns marker precision, capped at 1/100,000 of an interval. */
export const modelTimeTolerance = (rate: number) => Math.min(1e-7, (1 / rate) * 1e-5);
export function modelTrialAligned(
  group: ModelGroup,
  trial: {
    count: number;
    rate: number;
    startTime: number;
    firstFrame: number;
    times?: ArrayLike<number>;
  },
) {
  const clock = modelClock(group),
    tolerance = modelTimeTolerance(trial.rate);
  if (!clock.known || clock.count !== trial.count || !trial.count) return false;
  if (
    group.attrs?.SamplingFrequency &&
    (!Number.isFinite(clock.rate) ||
      clock.rate <= 0 ||
      Math.abs(1 / clock.rate - 1 / trial.rate) > tolerance)
  )
    return false;
  for (const [name, expected] of [
    ['StartFrame', trial.firstFrame],
    ['EndFrame', trial.firstFrame + trial.count - 1],
    ['FrameStep', 1],
  ] as const) {
    if (group.attrs?.[name] && scalar(group.attrs[name].value) !== expected) return false;
  }
  let previous = -Infinity;
  for (let a = 0; a < clock.count; a += 200) {
    const times = clock.read(a, Math.min(clock.count, a + 200));
    for (let i = 0; i < times.length; i++) {
      const expected = trial.times?.[a + i] ?? trial.startTime + (a + i) / trial.rate;
      if (
        !Number.isFinite(times[i]) ||
        times[i] <= previous ||
        Math.abs(times[i] - expected) > tolerance
      )
        return false;
      previous = times[i];
    }
  }
  return true;
}
export const independentModelMessage =
  'Independent model timeline · retained when the trial is cropped';

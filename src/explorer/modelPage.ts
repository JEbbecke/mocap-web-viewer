/** Source-backed model inspection is bounded to a single page, never a whole result matrix. */
export const MODEL_PAGE_SIZE = 200;
export interface ModelRequest {
  kind: 'ik' | 'id';
  sourceIndex: number;
  offset: number;
  timeBasis: 'trial' | 'independent';
  timeOrigin: number;
  /** Rate-only legacy clocks start at original recording zero, unlike absolute Time. */
  regularTimeOrigin?: number;
  interval?: { start: number; end: number };
}
export interface ModelPage {
  values: Float64Array;
  times: Float64Array;
  offset: number;
  sourceOffset: number;
  total: number;
  clockKnown: boolean;
}
interface SliceDataset {
  shape?: number[] | null;
  slice: (ranges: [number, number][]) => unknown;
}
interface ModelGroup {
  attrs?: Record<string, { value: unknown }>;
  get: (name: string) => unknown;
}
function numbers(value: unknown, count: number) {
  if (!(ArrayBuffer.isView(value) || Array.isArray(value)))
    throw Error('Model dataset is not numeric.');
  const source = value as unknown as ArrayLike<unknown>;
  if (source.length !== count) throw Error('Model slice size does not match its dimensions.');
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (typeof source[i] !== 'number' && typeof source[i] !== 'bigint')
      throw Error('Model dataset is not numeric.');
    out[i] = Number(source[i]);
  }
  return out;
}
/** Generic hyperslab interface is shared by h5wasm and synthetic tests. */
export function readModelPage(group: ModelGroup, request: ModelRequest): ModelPage {
  const data = group.get('Data') as SliceDataset | undefined,
    shape = data?.shape;
  if (
    !data ||
    shape?.length !== 2 ||
    !shape.every((v) => Number.isSafeInteger(v) && v >= 0) ||
    !Number.isSafeInteger(request.sourceIndex) ||
    request.sourceIndex < 0 ||
    request.sourceIndex >= shape[0] ||
    !Number.isSafeInteger(request.offset) ||
    request.offset < 0
  )
    throw Error('Unsupported model dimensions or variable.');
  const n = shape[1],
    time = group.get('Time') as SliceDataset | undefined;
  const rawLabels = group.attrs?.Labels?.value;
  const labels = Array.isArray(rawLabels)
    ? rawLabels
    : typeof rawLabels === 'string'
      ? [rawLabels]
      : [];
  const timeRow =
    labels.length === shape[0]
      ? labels.findIndex((v) => typeof v === 'string' && v.trim().toLowerCase() === 'time')
      : -1;
  if (time && (time.shape?.length !== 1 || time.shape[0] !== n))
    throw Error('Model Time sample count mismatch.');
  const rate = Number(group.attrs?.SamplingFrequency?.value);
  const clockKnown = !!time || timeRow >= 0 || (Number.isFinite(rate) && rate > 0);
  const origin =
    time || timeRow >= 0 ? request.timeOrigin : (request.regularTimeOrigin ?? request.timeOrigin);
  const readTimes = (a: number, b: number) =>
    time
      ? numbers(time.slice([[a, b]]), b - a)
      : timeRow >= 0
        ? numbers(
            data.slice([
              [timeRow, timeRow + 1],
              [a, b],
            ]),
            b - a,
          )
        : Float64Array.from({ length: b - a }, (_, i) => (clockKnown ? (a + i) / rate : NaN));
  const boundary = (t: number) => {
    let a = 0,
      b = n;
    while (a < b) {
      const mid = Math.floor((a + b) / 2);
      const v = readTimes(mid, mid + 1)[0];
      if (!Number.isFinite(v)) throw Error('Model clock contains missing timestamps.');
      if (v < t - 1e-9) a = mid + 1;
      else b = mid;
    }
    return a;
  };
  let start = 0,
    end = n;
  if (request.timeBasis === 'trial' && request.interval) {
    if (!clockKnown) throw Error('Cannot align a cropped model result without a declared clock.');
    const delta = request.timeOrigin - origin;
    start = boundary(request.interval.start - delta);
    end = boundary(request.interval.end - delta);
  }
  const total = Math.max(0, end - start),
    offset = Math.min(request.offset, Math.max(0, total - 1));
  const a = start + offset,
    b = Math.min(end, a + MODEL_PAGE_SIZE);
  const values =
    b > a
      ? numbers(
          data.slice([
            [request.sourceIndex, request.sourceIndex + 1],
            [a, b],
          ]),
          b - a,
        )
      : new Float64Array(0);
  const times = b > a ? readTimes(a, b) : new Float64Array(0);
  for (let i = 0; i < times.length; i++) {
    if (clockKnown && (!Number.isFinite(times[i]) || (i > 0 && times[i] <= times[i - 1])))
      throw Error('Model clock must be finite and strictly increasing.');
    if (request.timeBasis === 'trial') times[i] -= origin;
  }
  return { values, times, total, offset, sourceOffset: a, clockKnown };
}

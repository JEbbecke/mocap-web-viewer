import { modelClock, type ModelView } from '../motion/modelTiming';
/** Source-backed model inspection is bounded to a single page, never a whole result matrix. */
export const MODEL_PAGE_SIZE = 200;
export interface ModelRequest extends ModelView {
  kind: 'ik' | 'id';
  sourceIndex: number;
  offset: number;
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
  const clock = modelClock(group);
  const from = request.range?.start ?? 0,
    to = request.range?.end ?? shape[1];
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    from > to ||
    to > shape[1]
  )
    throw Error('Unsupported model source range.');
  const total = to - from,
    offset = Math.min(request.offset, Math.max(0, total - 1));
  const a = from + offset,
    b = Math.min(to, a + MODEL_PAGE_SIZE);
  const clockKnown = clock.known;
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
  const times =
    b > a ? clock.read(a, b).map((t) => t - (request.timeOrigin ?? 0)) : new Float64Array(0);
  for (let i = 0; i < times.length; i++) {
    if (clockKnown && (!Number.isFinite(times[i]) || (i > 0 && times[i] <= times[i - 1])))
      throw Error('Model clock must be finite and strictly increasing.');
  }
  return { values, times, total, offset, sourceOffset: a, clockKnown };
}

import type { MotionData, Series } from '../motion/types';
import { modelUnit } from '../explorer/datasets';
import { MODEL_PAGE_SIZE, readModelPage, type ModelRequest } from '../explorer/modelPage';
import type { PlotColumn, PlotData } from './series';

/** Both selection adapters reuse transferred buffers; nonfinite values render as gaps. */
export function modelPlotData(series: Series | null, column: PlotColumn): PlotData | null {
  if (!series) return null;
  const values = series.values.every(Number.isFinite)
    ? series.values
    : Array.from(series.values, (value) => (Number.isFinite(value) ? value : null));
  return {
    values: [series.times!, values] as PlotData['values'],
    labels: [column.label],
    unit: column.unit,
  };
}

/** Scalar source columns; selections contain identity, never numerical buffers. */
export function modelPlotDescriptors(data: MotionData) {
  return (['ik', 'id'] as const).flatMap((kind) =>
    (data.source.info?.modelResults?.[kind]?.entries ?? []).map((entry, index) => ({
      id: `${kind}:${index}`,
      kind,
      sourceIndex: entry.sourceIndex ?? index,
      name: entry.name,
      label: `${kind.toUpperCase()} · ${entry.name}`,
      unit: modelUnit(data, kind, index),
      aligned: data.source.info?.modelResults?.[kind]?.timeBasis === 'trial-aligned',
      range: data.source.info?.modelResults?.[kind]?.sourceRange,
      timeOrigin: data.source.info?.modelResults?.[kind]?.timeOrigin,
    })),
  );
}

/** Read only the selected scalar column, using Explorer's validated hyperslabs/clock. */
export function readModelSeries(
  group: Parameters<typeof readModelPage>[0],
  request: Omit<ModelRequest, 'offset'>,
): Series {
  const first = readModelPage(group, { ...request, offset: 0 });
  if (!first.clockKnown) throw Error('Model result has no physical time clock.');
  const values = new Float64Array(first.total),
    times = new Float64Array(first.total);
  for (let offset = 0; offset < first.total; offset += MODEL_PAGE_SIZE) {
    const page = offset === 0 ? first : readModelPage(group, { ...request, offset });
    if (offset > 0 && page.times[0] <= times[offset - 1])
      throw Error('Model clock must be finite and strictly increasing.');
    values.set(page.values, offset);
    times.set(page.times, offset);
  }
  return {
    values,
    times,
    components: 1,
    startTime: times[0] ?? 0,
    rate: Number(group.attrs?.SamplingFrequency?.value) || 0,
  };
}

import type uPlot from 'uplot';
import type { MotionData, Series } from '../motion/types';
import { sampleTime } from '../explorer/datasets';

export interface PlotData {
  values: uPlot.AlignedData;
  unit: string;
  labels: string[];
}

/** A scalar over an existing scientific buffer, materialized only when selected. */
export interface PlotColumn {
  label: string;
  unit: string;
  value?: (row: number) => number | null;
}

export function columnPlotData(
  count: number,
  time: ((row: number) => number) | undefined,
  columns: PlotColumn[],
): PlotData | null {
  const selected = columns.filter((c) => c.value);
  if (!time || !count || !selected.length) return null;
  return {
    values: [
      Array.from({ length: count }, (_, row) => time(row)),
      ...selected.map((c) =>
        Array.from({ length: count }, (_, row) => {
          const value = c.value!(row);
          return value !== null && Number.isFinite(value) ? value : null;
        }),
      ),
    ] as uPlot.AlignedData,
    unit: selected[0].unit,
    labels: selected.map((c) => c.label),
  };
}

export function plotSeries(data: MotionData, selection: string, marker: number): PlotData {
  if (selection.startsWith('marker:')) {
    const index = Number(selection.split(':')[1]);
    if (Number.isInteger(index) && index >= 0 && index < data.markers.labels.length) marker = index;
    selection = 'marker';
  }
  if (selection === 'marker') {
    const n = data.timeline.frameCount,
      m = data.markers.labels.length;
    const times = Array.from({ length: n }, (_, i) => i / data.timeline.rate);
    const components = [0, 1, 2].map((a) =>
      Array.from({ length: n }, (_, i) =>
        data.markers.valid[i * m + marker]
          ? data.markers.positions[(i * m + marker) * 3 + a]
          : null,
      ),
    );
    return {
      values: [times, ...components] as uPlot.AlignedData,
      unit: data.units.position,
      labels: ['X', 'Y', 'Z'],
    };
  }
  const [kind, index, field] = selection.split(':');
  let signal: Series, unit: string;
  if (kind === 'analog' || kind === 'signal') {
    const a = kind === 'analog' ? data.analogs[Number(index)] : data.signals?.[Number(index)];
    if (!a) return plotSeries(data, 'marker', marker);
    signal = a.signal;
    unit = a.unit;
  } else {
    const p = data.forcePlatforms[Number(index)];
    if (!p) return plotSeries(data, 'marker', marker);
    signal =
      field === 'moment'
        ? p.moment
        : field === 'freeMoment'
          ? p.freeMoment!
          : field === 'cop'
            ? p.cop
            : p.force;
    unit =
      field === 'moment' || field === 'freeMoment'
        ? data.units.moment
        : field === 'cop'
          ? data.units.position
          : data.units.force;
  }
  const n = signal.values.length / signal.components;
  return {
    values: [
      Array.from({ length: n }, (_, i) => sampleTime(signal, i)),
      ...Array.from({ length: signal.components }, (_, a) =>
        Array.from({ length: n }, (_, i) =>
          Number.isFinite(signal.values[i * signal.components + a])
            ? signal.values[i * signal.components + a]
            : null,
        ),
      ),
    ] as uPlot.AlignedData,
    unit,
    labels: signal.components === 1 ? ['Signal'] : ['X', 'Y', 'Z'],
  };
}

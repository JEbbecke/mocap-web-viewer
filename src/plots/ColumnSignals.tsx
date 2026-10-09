import { useMemo } from 'react';
import type { MotionData } from '../motion/types';
import { independentModelMessage } from '../motion/modelTiming';
import { explorerDatasets } from '../explorer/datasets';
import { useSession } from '../state/session';
import { columnPlotData } from './series';
import { useModelSeries } from './useModelSeries';
import { modelPlotData } from './modelSeries';
import { SignalChart } from './SignalChart';

/** Selection adapter only; both views render through SignalChart in SignalPlot. */
export function ColumnSignals({ data }: { data: MotionData }) {
  const selection = useSession((s) => s.explorerColumns);
  const datasets = useMemo(() => explorerDatasets(data), [data]);
  const dataset = datasets.find((d) => d.id === selection?.datasetId);
  const columns = useMemo(
    () =>
      dataset?.columns
        .filter((c) => selection?.columns.includes(c.id) && c.plot)
        .map((c) => c.plot!) ?? [],
    [dataset, selection],
  );
  const model = columns.length ? dataset?.model : undefined;
  const { series, error } = useModelSeries(
    model && {
      kind: model.kind,
      sourceIndex: model.sourceIndex,
      range: model.range,
      timeOrigin: model.timeOrigin,
    },
  );
  const graph = useMemo(() => {
    if (model) return modelPlotData(series, columns[0]);
    return columnPlotData(dataset?.count ?? 0, dataset?.time, columns);
  }, [dataset, columns, model, series]);
  return (
    <SignalChart
      data={data}
      graph={graph}
      emptyMessage="Select a numeric signal column to plot."
      croppedWithTrial={model ? model.aligned : true}
      toolbar={
        <span className="muted small plot-column-label" title={dataset?.name}>
          {dataset
            ? `${dataset.name} · ${columns.length} plotted column${columns.length === 1 ? '' : 's'}`
            : 'Selected columns'}
        </span>
      }
      statusRole={error ? 'alert' : 'status'}
      status={
        error ||
        (model && !graph
          ? 'Loading model signal…'
          : model && !model.aligned
            ? independentModelMessage
            : '')
      }
    />
  );
}

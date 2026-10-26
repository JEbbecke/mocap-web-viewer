import { useMemo } from 'react';
import type { MotionData } from '../motion/types';
import { independentModelMessage } from '../motion/modelTiming';
import { useExplorerPlotSelection } from './explorerPlotSelection';
import { columnPlotData } from './series';
import { useModelSeries } from './useModelSeries';
import { modelPlotData } from './modelSeries';
import { SignalChart } from './SignalChart';

/** Selection adapter only; both views render through SignalChart in SignalPlot. */
export function ColumnSignals({ data }: { data: MotionData }) {
  const { dataset, columns } = useExplorerPlotSelection(data);
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
  if (!columns.length)
    return (
      <div className="plot-target" data-sample-count="0">
        <p className="plot-empty" role="status">
          Select a numeric column to plot.
        </p>
      </div>
    );
  return (
    <SignalChart
      data={data}
      graph={graph}
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

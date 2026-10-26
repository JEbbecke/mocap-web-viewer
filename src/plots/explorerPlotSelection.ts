import { useMemo } from 'react';
import { explorerDatasets, type Dataset } from '../explorer/datasets';
import type { ColumnSelection } from '../explorer/selection';
import type { MotionData } from '../motion/types';
import { useSession } from '../state/session';

/** Plot eligibility is independent of selected cells and numeric clock/index columns. */
export function explorerPlotSelection(datasets: Dataset[], selection: ColumnSelection | null) {
  const dataset = datasets.find((d) => d.id === selection?.datasetId);
  const columns =
    dataset?.columns
      .filter((c) => selection?.columns.includes(c.id) && c.plot)
      .map((c) => c.plot!) ?? [];
  return { dataset, columns };
}

export function useExplorerPlotSelection(data: MotionData | null) {
  const selection = useSession((s) => s.explorerColumns);
  const datasets = useMemo(() => (data ? explorerDatasets(data) : []), [data]);
  return useMemo(() => explorerPlotSelection(datasets, selection), [datasets, selection]);
}

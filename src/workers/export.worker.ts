import { exportC3D } from '../exporters/c3d';
import { exportH5 } from '../exporters/h5';
import type { MotionEvent } from '../motion/types';
import type { MotionData } from '../motion/types';
import type { ExportFormat } from '../exporters/conversion';
import { exportSemanticC3D } from '../exporters/semanticC3D';
import { exportSemanticH5 } from '../exporters/semanticH5';

self.onmessage = async (
  event: MessageEvent<{
    file: File;
    start: number;
    end: number;
    events?: MotionEvent[];
    labels?: string[];
    analogLabels?: string[];
    dataLabels?: Record<string, string>;
    target?: ExportFormat;
    data?: MotionData;
  }>,
) => {
  try {
    const { file, start, end, events, labels, analogLabels, dataLabels, target, data } = event.data;
    const sourceFormat = /\.c3d$/i.test(file.name) ? 'C3D' : 'H5';
    if (target && target !== sourceFormat) {
      if (!data || data.source.format !== sourceFormat)
        throw new Error('Missing or mismatched conversion input.');
      const buffer = target === 'C3D' ? exportSemanticC3D(data) : await exportSemanticH5(data);
      self.postMessage({ buffer }, { transfer: [buffer] });
      return;
    }
    const buffer =
      sourceFormat === 'C3D'
        ? exportC3D(await file.arrayBuffer(), start, end, events, labels, analogLabels, dataLabels)
        : await exportH5(file, start, end, events, labels, analogLabels, dataLabels);
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Export failed.' });
  }
};

import { exportC3D } from '../exporters/c3d';
import { exportH5 } from '../exporters/h5';
import type { MotionEvent } from '../motion/types';

self.onmessage = async (
  event: MessageEvent<{
    file: File;
    start: number;
    end: number;
    events?: MotionEvent[];
    labels?: string[];
    analogLabels?: string[];
    dataLabels?: Record<string, string>;
  }>,
) => {
  try {
    const { file, start, end, events, labels, analogLabels, dataLabels } = event.data;
    const buffer = /\.c3d$/i.test(file.name)
      ? exportC3D(await file.arrayBuffer(), start, end, events, labels, analogLabels, dataLabels)
      : await exportH5(file, start, end, events, labels, analogLabels, dataLabels);
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Export failed.' });
  }
};

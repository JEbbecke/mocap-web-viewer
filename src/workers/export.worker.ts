import { exportC3D } from '../exporters/c3d';
import { exportH5 } from '../exporters/h5';
import type { MotionEvent } from '../motion/types';

self.onmessage = async (
  event: MessageEvent<{ file: File; start: number; end: number; events?: MotionEvent[] }>,
) => {
  try {
    const { file, start, end, events } = event.data;
    if (!/\.c3d$/i.test(file.name) && events !== undefined)
      throw new Error('H5 event serialization has no established schema.');
    const buffer = /\.c3d$/i.test(file.name)
      ? exportC3D(await file.arrayBuffer(), start, end, events)
      : await exportH5(file, start, end);
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Export failed.' });
  }
};

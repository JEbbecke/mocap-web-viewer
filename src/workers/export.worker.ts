import { exportC3D } from '../exporters/c3d';
import { exportH5 } from '../exporters/h5';

self.onmessage = async (event: MessageEvent<{ file: File; start: number; end: number }>) => {
  try {
    const { file, start, end } = event.data;
    const buffer = /\.c3d$/i.test(file.name)
      ? exportC3D(await file.arrayBuffer(), start, end)
      : await exportH5(file, start, end);
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Export failed.' });
  }
};

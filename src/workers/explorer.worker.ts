import { readModelPage, type ModelRequest } from '../explorer/modelPage';
import { readModelText } from '../explorer/modelCopy';
import { readModelSeries } from '../plots/modelSeries';
self.onmessage = async (
  event: MessageEvent<{
    file: File;
    request: ModelRequest;
    copy?: { headers: string[]; columns?: number[] };
    plot?: boolean;
  }>,
) => {
  const h5 = await import('h5wasm');
  const { FS } = await h5.ready;
  let handle: InstanceType<typeof h5.File> | undefined;
  try {
    FS.mkdir('/explorer');
    FS.mount(
      FS.filesystems.WORKERFS,
      { blobs: [{ name: 'model.h5', data: event.data.file }] },
      '/explorer',
    );
    handle = new h5.File('/explorer/model.h5', 'r');
    const group = handle.get(event.data.request.kind === 'ik' ? 'IKResults' : 'IDResults');
    if (!(group instanceof h5.Group)) throw Error('Model result group is unavailable.');
    if (event.data.plot) {
      const series = readModelSeries(group, event.data.request);
      self.postMessage({ series }, { transfer: [series.values.buffer, series.times!.buffer] });
    } else if (event.data.copy) {
      const text = readModelText(
        group,
        event.data.request,
        event.data.copy.headers,
        event.data.copy.columns,
      );
      self.postMessage({ text });
    } else {
      const page = readModelPage(group, event.data.request);
      self.postMessage({ page }, { transfer: [page.values.buffer, page.times.buffer] });
    }
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Model inspection failed.',
    });
  } finally {
    handle?.close();
    if (FS.analyzePath('/explorer/model.h5').exists) FS.unmount('/explorer');
    if (FS.analyzePath('/explorer').exists) FS.rmdir('/explorer');
  }
};

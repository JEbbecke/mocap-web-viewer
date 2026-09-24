import { importers } from '../importers';
function transfers(value: unknown, buffers = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) transfers(item, buffers);
  return [...buffers];
}
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const importer = importers.find((i) => i.canImport(event.data));
    if (!importer) throw new Error('Choose a .c3d, .h5 or .hdf5 motion file.');
    const data = await importer.import(event.data);
    self.postMessage({ data }, { transfer: transfers(data) });
  } catch (error) {
    if (import.meta.env.DEV) console.error(error);
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : 'The file could not be read. It may be corrupt or use an unsupported schema.',
    });
  }
};

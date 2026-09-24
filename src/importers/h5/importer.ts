import type { MotionImporter } from '../types';
import { parseH5Tree } from './schema';
export const H5Importer: MotionImporter = {
  canImport: (file) => /\.(h5|hdf5)$/i.test(file.name),
  async import(file) {
    const h5 = await import('h5wasm');
    const { FS } = await h5.ready;
    FS.mkdir('/local');
    // Blob-based WORKERFS random access; original name never enters any URL.
    FS.mount(FS.filesystems.WORKERFS, { blobs: [{ name: 'motion.h5', data: file }] }, '/local');
    let handle: InstanceType<typeof h5.File> | undefined;
    try {
      handle = new h5.File('/local/motion.h5', 'r');
      return parseH5Tree(handle, file.name);
    } finally {
      handle?.close();
      FS.unmount('/local');
      FS.rmdir('/local');
    }
  },
};

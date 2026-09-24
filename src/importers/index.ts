import type { MotionImporter } from './types';
import { parseC3D } from './c3d/importer';
import { H5Importer } from './h5/importer';
export const C3DImporter: MotionImporter = {
  canImport: (f) => /\.c3d$/i.test(f.name),
  import: async (f) => parseC3D(await f.arrayBuffer(), f.name),
};
export const importers: MotionImporter[] = [C3DImporter, H5Importer];

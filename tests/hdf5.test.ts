import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseH5Tree } from '../src/importers/h5/schema';
import fixture from './fixtures/h5.json';
it('reads a real compressed HDF5 fixture with bundled HDF5 WASM', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ibo-hdf5-test-'));
  try {
    const path = join(folder, 'synthetic.h5');
    await writeFile(path, Buffer.from(fixture.base64, 'base64'));
    const h5 = await import('h5wasm/node');
    await h5.ready;
    const file = new h5.File(path, 'r');
    try {
      const data = parseH5Tree(file, 'synthetic.h5');
      expect(data.timeline).toEqual({ rate: 100, frameCount: 3, firstFrame: 10, duration: 0.02 });
      expect(data.markers.positions[0]).toBeCloseTo(0.01);
      expect(data.markers.positions[8]).toBeCloseTo(0.09);
      expect(Array.from(data.markers.valid)).toEqual([1, 0, 1]);
      expect(data.analogs[0].signal.values).toEqual(new Float64Array([0, 1, 2, 3, 4, 5]));
      expect(data.forcePlatforms[0].force.values[2]).toBe(100);
    } finally {
      file.close();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

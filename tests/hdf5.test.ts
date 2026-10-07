import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
      const dataset = file.get('Trajectories/Labeled/Data') as InstanceType<typeof h5.Dataset>;
      expect(dataset.shape).toEqual([1, 4, 3]);
      expect(dataset.filters.some((filter) => filter.id === 1)).toBe(true);
      expect(dataset.value).toBeInstanceOf(Float64Array);
      expect((file.get('Analog/Data') as InstanceType<typeof h5.Dataset>).value).toEqual(
        new Float64Array([0, 1, 2, 3, 4, 5]),
      );
      expect(
        (file.get('Trajectories/Labeled') as InstanceType<typeof h5.Group>).attrs.Unit.value,
      ).toBe('cm');
    } finally {
      file.close();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

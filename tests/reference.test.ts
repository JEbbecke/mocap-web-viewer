import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseC3D } from '../src/importers/c3d/importer';
import { parseH5Tree } from '../src/importers/h5/schema';
import type { MotionData } from '../src/motion/types';

const available = existsSync('.local/reference.json');
function difference(
  actual: ArrayLike<number>,
  expected: ArrayLike<number | null>,
  skip?: Uint8Array,
) {
  expect(actual.length).toBe(expected.length);
  let max = 0;
  for (let i = 0; i < actual.length; i++) {
    if (skip && !skip[Math.floor(i / 3)]) continue;
    if (expected[i] == null || !Number.isFinite(expected[i])) continue;
    if (!Number.isFinite(actual[i])) throw new Error(`Unexpected invalid value at ${i}`);
    max = Math.max(max, Math.abs(actual[i] - expected[i]!));
  }
  return max;
}
describe.skipIf(!available)('private local reference comparisons (never deployed)', () => {
  const loaded: MotionData[] = [];
  it('agrees with ezc3d for all marker/analog and type 2/3/4 force samples', () => {
    const refs = JSON.parse(readFileSync('.local/reference.json', 'utf8'));
    for (const ref of refs) {
      const bytes = readFileSync(ref.path),
        data = parseC3D(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          ref.name,
        );
      loaded.push(data);
      expect(data.timeline.rate).toBe(ref.rate);
      expect(data.timeline.firstFrame).toBe(ref.firstFrame);
      expect(data.markers.labels).toEqual(ref.labels);
      for (let i = 0; i < data.markers.valid.length; i++)
        expect(Boolean(data.markers.valid[i])).toBe(
          ref.residuals[i] != null &&
            ref.residuals[i] >= 0 &&
            ref.positions
              .slice(i * 3, i * 3 + 3)
              .every((v: number | null) => v != null && Number.isFinite(v)),
        );
      expect(
        difference(
          data.markers.residuals!,
          ref.residuals.map((r: number | null) => (r != null && r < 0 ? -1 : r)),
        ),
      ).toBeLessThan(1e-7);
      expect(difference(data.markers.positions, ref.positions, data.markers.valid)).toBeLessThan(
        1e-6,
      );
      data.analogs.forEach((a, i) =>
        expect(difference(a.signal.values, ref.analogs[i])).toBeLessThan(1e-8),
      );
      expect(data.forcePlatforms.length).toBe(ref.plates.length);
      data.forcePlatforms.forEach((p, i) => {
        expect(difference(p.force.values, ref.plates[i].force)).toBeLessThan(1e-7);
        expect(difference(p.moment.values, ref.plates[i].moment)).toBeLessThan(1e-7);
        expect(difference(p.cop.values, ref.plates[i].cop)).toBeLessThan(1e-5);
        expect(difference(p.freeMoment!.values, ref.plates[i].freeMoment)).toBeLessThan(1e-7);
      });
    }
  });
  it('matching C3D and H5 represent the same physical trial', async () => {
    const h5 = await import('h5wasm/node');
    await h5.ready;
    const file = new h5.File(resolve('../ibo-biomech/03_PRE_GANG12_01.h5'), 'r');
    try {
      const data = parseH5Tree(file, 'paired.h5'),
        c3d = loaded[0];
      expect(c3d).toBeDefined();
      expect(data.timeline).toEqual(c3d.timeline);
      expect(data.markers.labels).toEqual(c3d.markers.labels);
      expect(difference(data.markers.positions, c3d.markers.positions, c3d.markers.valid)).toBe(0);
      expect(data.markers.valid).toEqual(c3d.markers.valid);
      data.analogs.forEach((a, i) =>
        expect(difference(a.signal.values, c3d.analogs[i].signal.values)).toBeLessThan(1e-10),
      );
      data.forcePlatforms.forEach((p, i) => {
        expect(p.coordinateFrame).toBe('global');
        expect(difference(p.force.values, c3d.forcePlatforms[i].force.values)).toBeLessThan(1e-7);
        expect(difference(p.moment.values, c3d.forcePlatforms[i].moment.values)).toBeLessThan(1e-7);
        expect(difference(p.cop.values, c3d.forcePlatforms[i].cop.values)).toBeLessThan(1e-5);
        expect(p.corners!.values.length).toBe(12);
      });
    } finally {
      file.close();
    }
  });
  it('older virtual-marker H5 loads without missing optional Tz', async () => {
    const h5 = await import('h5wasm/node');
    await h5.ready;
    const file = new h5.File(resolve('../ibo-biomech/virtual_marker.h5'), 'r');
    try {
      const d = parseH5Tree(file, 'legacy.h5');
      expect(d.markers.labels.length).toBe(69);
      expect(d.forcePlatforms.length).toBe(5);
      expect(d.warnings.some((w) => w.includes('unit is absent'))).toBe(true);
    } finally {
      file.close();
    }
  });
});

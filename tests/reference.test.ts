import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseC3D } from '../src/importers/c3d/importer';

const refs = existsSync('.local/reference.json')
  ? JSON.parse(readFileSync('.local/reference.json', 'utf8'))
  : [];
const available = refs.length > 0 && refs.every((ref: { path: string }) => existsSync(ref.path));
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
  it('agrees with ezc3d for all marker/analog and type 2/3/4 force samples', () => {
    for (const ref of refs) {
      const bytes = readFileSync(ref.path),
        data = parseC3D(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          ref.name,
        );
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
          data.markers.residuals!.map((r) => (r < 0 ? r : r / 1000)),
          ref.residuals.map((r: number | null) => (r != null && r < 0 ? -1 : r)),
        ),
      ).toBeLessThan(1e-7);
      expect(
        difference(
          data.markers.positions.map((v) => v / 1000),
          ref.positions,
          data.markers.valid,
        ),
      ).toBeLessThan(1e-6);
      data.analogs.forEach((a, i) =>
        expect(difference(a.signal.values, ref.analogs[i])).toBeLessThan(1e-8),
      );
      expect(data.forcePlatforms.length).toBe(ref.plates.length);
      data.forcePlatforms.forEach((p, i) => {
        expect(difference(p.force.values, ref.plates[i].force)).toBeLessThan(1e-7);
        expect(difference(p.moment.values, ref.plates[i].moment)).toBeLessThan(1e-7);
        expect(
          difference(
            p.cop.values.map((v) => v / 1000),
            ref.plates[i].cop,
          ),
        ).toBeLessThan(1e-5);
        expect(difference(p.freeMoment!.values, ref.plates[i].freeMoment)).toBeLessThan(1e-7);
      });
    }
  });
});

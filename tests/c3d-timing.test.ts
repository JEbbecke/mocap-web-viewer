import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import { rotationFixture } from './helpers/rotationC3d';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters } from '../src/importers/c3d/parameters';
import { editC3DParameters } from '../src/exporters/c3dParameters';
import { exportC3D } from '../src/exporters/c3d';
import { writeSemanticH5 } from '../src/exporters/semanticH5';
import { parseH5Tree } from '../src/importers/h5/schema';
import { cropMotionData } from '../src/motion/crop';
import { eventSourceFrame } from '../src/motion/events';
import { plotSeries } from '../src/plots/series';
import { conversionPlan } from '../src/exporters/conversion';

const folder = resolve('.local/c3d-timing-validation');
beforeAll(async () => {
  await h5.ready;
  mkdirSync(folder, { recursive: true });
});

function fixture(rate: number, rotation: boolean) {
  const source = rotationFixture({ rotation });
  const v = new DataView(source);
  const { params } = readParameters(v);
  v.setFloat32(20, rate, true);
  for (const [key, value] of [
    ['POINT:RATE', rate],
    ['ANALOG:RATE', rate * 2],
    ['ROTATION:RATE', rate * 2],
  ] as const) {
    const storage = params.get(key)?.storage;
    if (storage) v.setFloat32(storage.offset, value, true);
  }
  v.setFloat32(params.get('EVENT:TIMES')!.storage!.offset + 4, 37 / rate, true);
  return source;
}

describe('C3D declared timebase across views and serializers', () => {
  for (const rotation of [false, true])
    it.each([60, 100, 120, 200, 240])(
      '%s Hz uses Point timing independently of rotation presence',
      (rate) => {
        const source = fixture(rate, rotation);
        const data = parseC3D(source, 'timing.c3d');
        expect(data.timeline).toEqual({ rate, firstFrame: 36, frameCount: 3, duration: 2 / rate });
        expect(data.analogs[0].signal.rate).toBe(rate * 2);
        expect(data.events[0].time).toBeCloseTo(1 / rate, 6);
        expect(eventSourceFrame(data, data.events[0].time)).toBeCloseTo(38, 4);
        expect(plotSeries(data, 'marker', 0).values[0]).toEqual([0, 1 / rate, 2 / rate]);
        expect(plotSeries(data, 'analog:0', 0).values[0]).toEqual(
          Array.from({ length: 6 }, (_, i) => i / (rate * 2)),
        );
        if (rotation) {
          expect(data.source.partialImport!.rotation.rate).toBe(rate * 2);
          expect(data.warnings[0]).toContain('2 rotation signals');
          for (const target of ['C3D', 'H5'] as const)
            expect(conversionPlan(data, target).report.warnings.join(' ')).toContain(
              '2 rotation signals not imported',
            );
        } else expect(data.warnings).toEqual([]);
        const expected = cropMotionData(data, 1, 3);
        expect(expected.timeline).toEqual({
          rate,
          firstFrame: 37,
          frameCount: 2,
          duration: 1 / rate,
        });
        expect(expected.events[0].time).toBeCloseTo(0, 6);
        expect(eventSourceFrame(expected, expected.events[0].time)).toBeCloseTo(38, 4);
        expect(plotSeries(expected, 'marker', 0).values[0]).toEqual([0, 1 / rate]);
        const c3d = parseC3D(exportC3D(source, 1, 3), 'crop.c3d');
        expect(c3d.timeline).toEqual(expected.timeline);
        expect(c3d.analogs[0].signal.rate).toBe(rate * 2);
        expect(c3d.events[0].time).toBeCloseTo(expected.events[0].time, 6);
        const output = new h5.File(resolve(folder, `timing-${rate}-${rotation}.h5`), 'w');
        try {
          writeSemanticH5(output, expected);
          const actual = parseH5Tree(output, 'crop.h5');
          expect(actual.timeline).toEqual(expected.timeline);
          expect(actual.analogs[0].signal.rate).toBe(rate * 2);
          expect(actual.events[0].time).toBeCloseTo(expected.events[0].time, 6);
          expect(eventSourceFrame(actual, actual.events[0].time)).toBeCloseTo(37, 4); // stored H5 origin is zero-based
          expect(plotSeries(actual, 'marker', 0).values[0]).toEqual([0, 1 / rate]);
        } finally {
          output.close();
        }
      },
    );

  it('reads the header rate when POINT:RATE is absent, without a vendor override', () => {
    const source = fixture(240, true);
    const editor = editC3DParameters(source, 'POINT');
    editor.remove('RATE');
    const data = parseC3D(editor.finish(), 'fallback.c3d');
    expect(data.timeline.rate).toBe(240);
    expect(data.timeline.duration).toBe(2 / 240);
  });
});

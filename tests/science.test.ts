import { describe, it, expect } from 'vitest';
import {
  frameAt,
  metres,
  momentScale,
  plateBasis,
  rotate,
  sample,
  uniqueLabels,
} from '../src/motion/math';
import { localWrench } from '../src/importers/c3d/forces';
import { parseC3D } from '../src/importers/c3d/importer';
import { parseH5Tree, type H5Node } from '../src/importers/h5/schema';
import { advanceFrame } from '../src/playback/clock';
import { resolveConnections } from '../src/motion/connections';
import fixtures from './fixtures/c3d.json';

function buffer(base64: string) {
  const bytes = Buffer.from(base64, 'base64');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
}
// Explicit tree builder: HDF row-major arrays, independent of production helpers.
function group(attrs: Record<string, unknown>, children: Record<string, H5Node> = {}): H5Node {
  const g: H5Node = {
    attrs: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])),
    keys: () => Object.keys(children),
  };
  g.get = (path) => {
    let current: H5Node | undefined = g;
    for (const key of path.split('/'))
      current = current === g ? children[key] : (current?.get?.(key) as H5Node | undefined);
    return current;
  };
  return g;
}
const dataset = (shape: number[], values: number[]): H5Node => ({
  shape,
  value: new Float64Array(values),
});
function h5Fixture() {
  const labeled = group(
    { Labels: ['A'], Unit: 'cm' },
    {
      Data: dataset([1, 4, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 1, 1]),
      Residuals: dataset([1, 1, 3], [0.2, -1, 0.4]),
    },
  );
  const plate = group(
    {
      Name: 'sensor',
      SamplingFrequency: 200,
      unit_force: 'N',
      unit_moment: 'Nmm',
      unit_position: 'mm',
      CoordinateSystem: 1,
    },
    {
      Force: dataset([3, 3], [0, 0, 0, 0, 0, 0, 100, 200, 300]),
      Moment: dataset([3, 3], new Array(9).fill(1000)),
      COP: dataset([3, 3], new Array(9).fill(100)),
      Location: dataset([3, 4], [100, -100, -100, 100, 100, 100, -100, -100, 0, 0, 0, 0]),
    },
  );
  return group(
    {},
    {
      Trajectories: group({ SamplingFrequency: 100, StartFrame: 10 }, { Labeled: labeled }),
      Analog: group(
        { Labels: ['EMG'], SamplingFrequency: 200 },
        { Data: dataset([1, 6], [0, 1, 2, 3, 4, 5]) },
      ),
      ForcePlates: group({}, { '0': plate }),
    },
  );
}

describe('units, coordinates and force mechanics', () => {
  it('normalizes physical units without axis swaps', () => {
    expect(metres('mm')).toBe(0.001);
    expect(metres('CM')).toBe(0.01);
    expect(metres('m')).toBe(1);
    expect(momentScale('N mm')).toBe(0.001);
    expect(() => metres('inch')).toThrow();
  });
  it('rotates a platform vector without translating it', () => {
    const basis = plateBasis([
      [1, 1, 0],
      [1, -1, 0],
      [-1, -1, 0],
      [-1, 1, 0],
    ]);
    expect(rotate(basis, [2, 3, 4])).toEqual([3, 2, -4]);
  });
  it('rejects degenerate corners', () => {
    expect(() =>
      plateBasis([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toThrow();
  });
  it('transports moments to the surface and anchors GRF at the COP', () => {
    const w = localWrench(2, [10, 20, 100, 30, -40, 5], [0, 0, -0.05]);
    expect(w.force).toEqual([10, 20, 100]);
    expect(w.moment).toEqual([29, -39.5, 5]);
    expect(w.cop).toEqual([0.395, 0.29, 0]);
    expect(w.freeMoment[0]).toBeCloseTo(0);
    expect(w.freeMoment[1]).toBeCloseTo(0);
    expect(w.freeMoment[2]).toBeCloseTo(0);
  });
  it('does not fabricate COP in absence of vertical load', () => {
    expect(localWrench(2, [0, 0, 0, 0, 0, 0], [0, 0, 0]).cop.every(Number.isNaN)).toBe(true);
  });
  it('calibrates all six type-4 channels with column-major matrix', () => {
    const cal = Array.from({ length: 36 }, (_, i) => (i % 7 === 0 ? 2 : 0));
    expect(localWrench(4, [1, 2, 3, 4, 5, 6], [0, 0, 0], cal).force).toEqual([2, 4, 6]);
  });
  it('sums type-3 transducer channels and moments', () => {
    const w = localWrench(3, [1, 2, 3, 4, 10, 20, 30, 40], [0.2, 0.3, -0.05]);
    expect(w.force).toEqual([3, 7, 100]);
    expect(w.moment[0]).toBeCloseTo(-12.35);
    expect(w.moment[1]).toBeCloseTo(0.15);
    expect(w.moment[2]).toBeCloseTo(0.1);
  });
});
describe('timing', () => {
  it('interpolates at independent source rate and never extrapolates', () => {
    const s = { values: new Float64Array([0, 10, 20]), components: 1, rate: 50, startTime: 0 };
    expect(sample(s, 0.01)).toBe(5);
    expect(sample(s, 0.04)).toBe(20);
    expect(sample(s, 0.05)).toBeNaN();
    expect(sample(s, -0.01)).toBeNaN();
  });
  it('preserves gaps, including finite sample directly before gap', () => {
    const s = { values: new Float64Array([1, NaN, 3]), components: 1, rate: 100, startTime: 0 };
    expect(sample(s, 0)).toBe(1);
    expect(sample(s, 0.005)).toBeNaN();
    expect(sample(s, 0.02)).toBe(3);
  });
  it('maps times and handles non-integer rates and loop boundaries', () => {
    expect(frameAt(0.015, 100, 3)).toBe(2);
    expect(frameAt(99, 120, 3)).toBe(2);
    expect(advanceFrame(0, 1, 119.88, 0.5, 1000, false).position).toBeCloseTo(59.94);
    expect(advanceFrame(9, 0.02, 100, 1, 10, true).position).toBe(1);
    expect(advanceFrame(9, 0.02, 100, 1, 10, false)).toEqual({ position: 9, ended: true });
  });
});
describe('C3D binary import', () => {
  for (const [variant, encoded] of Object.entries(fixtures))
    it(`reads ${variant} coordinates, residuals, scaled subframes and events`, () => {
      const d = parseC3D(buffer(encoded), 'synthetic.c3d');
      expect(d.timeline).toEqual({ rate: 100, frameCount: 3, firstFrame: 10, duration: 0.02 });
      expect(d.markers.labels).toEqual(['A', 'B']);
      expect(d.markers.positions[0]).toBeCloseTo(0.1);
      expect(d.markers.positions[6]).toBeCloseTo(0.11);
      expect(d.markers.valid).toEqual(new Uint8Array([1, 1, 1, 0, 1, 1]));
      expect(d.markers.residuals![0]).toBeCloseTo(0.001);
      expect(d.analogs[0].signal.values[5]).toBeCloseTo(1);
      expect(d.events[0].time).toBeCloseTo(0.01);
      expect(d.events[0].context).toBe('Left');
    });
  it('rejects malformed headers, truncated samples and DEC encoding', () => {
    expect(() => parseC3D(new ArrayBuffer(12), 'bad')).toThrow('header');
    const a = buffer(fixtures.intelFloat);
    expect(() => parseC3D(a.slice(0, 1600), 'bad')).toThrow('Truncated');
    new Uint8Array(a)[515] = 85;
    expect(() => parseC3D(a, 'bad')).toThrow('DEC');
  });
  it('rejects out-of-bounds parameter offsets', () => {
    const a = buffer(fixtures.intelFloat);
    new DataView(a).setInt16(523, 32000, true);
    expect(() => parseC3D(a, 'bad')).toThrow();
  });
});
describe('institute H5 normalization', () => {
  it('keeps marker-rate moving corners synchronized independently of force rate', () => {
    const root = h5Fixture();
    const geometry = root.get!('ForcePlates/0/Location') as H5Node;
    geometry.shape = [3, 4, 3];
    geometry.value = Float64Array.from({ length: 36 }, (_, i) => {
      const component = Math.floor(i / 3);
      return component < 4 ? (component === 0 || component === 3 ? 100 : -100) + (i % 3) * 10 : 0;
    });
    const plate = parseH5Tree(root, 'moving.h5').forcePlatforms[0];
    expect(plate.force.rate).toBe(200);
    expect(plate.corners!.rate).toBe(100);
    expect(sample(plate.corners!, 0.02, 0)).toBeCloseTo(0.12);
    expect(sample(plate.corners!, 0.03, 0)).toBeNaN();
  });
  it('honors stored units and residual missingness; independently rates analogs/forces', () => {
    const d = parseH5Tree(h5Fixture(), 'fixture.h5');
    expect(d.markers.positions[0]).toBeCloseTo(0.01);
    expect(d.markers.valid).toEqual(new Uint8Array([1, 0, 1]));
    expect(d.timeline.firstFrame).toBe(10);
    expect(d.analogs[0].signal.rate).toBe(200);
    expect(d.forcePlatforms[0].moment.values[0]).toBe(1);
    expect(d.forcePlatforms[0].cop.values[0]).toBe(0.1);
    expect(d.forcePlatforms[0].corners!.values[0]).toBe(0.1);
  });
  it('rejects generic HDF5 and missing marker dataset', () => {
    expect(() => parseH5Tree(group({}), 'x')).toThrow('missing Trajectories');
  });
  it('makes the legacy missing-unit assumption visible', () => {
    const root = h5Fixture();
    delete (root.get!('Trajectories/Labeled') as H5Node).attrs!.Unit;
    expect(parseH5Tree(root, 'x').warnings[0]).toContain('mm is assumed');
  });
  it('omits broken optional platform while retaining markers', () => {
    const root = h5Fixture();
    (root.get!('ForcePlates/0') as H5Node).attrs!.SamplingFrequency.value = 0;
    const d = parseH5Tree(root, 'x');
    expect(d.forcePlatforms).toHaveLength(0);
    expect(d.markers.labels).toEqual(['A']);
    expect(d.warnings[0]).toContain('sampling rate');
  });
  it('does not double-transform unresolved local H5 data', () => {
    const root = h5Fixture();
    (root.get!('ForcePlates/0') as H5Node).attrs!.CoordinateSystem.value = 0;
    const d = parseH5Tree(root, 'x');
    expect(d.forcePlatforms[0].coordinateFrame).toBe('unresolved');
    expect(d.warnings.join()).toContain('unresolved');
  });
});
describe('labels and links', () => {
  it('preserves duplicate channels instead of overwriting', () =>
    expect(uniqueLabels(['Fx', 'Fx', 'Fx'])).toEqual(['Fx', 'Fx_2', 'Fx_3']));
  it('only links exact available labels', () => {
    expect(resolveConnections(['LASI', 'RASI', 'unknown'], 'plug-in-gait')).toEqual([[0, 1]]);
    expect(resolveConnections(['foo', 'bar'], 'auto')).toEqual([]);
  });
});

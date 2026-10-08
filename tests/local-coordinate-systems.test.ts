import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters } from '../src/importers/c3d/parameters';
import { parseH5Tree, type H5Node } from '../src/importers/h5/schema';
import { embeddedC3DPlateType } from '../src/importers/h5/c3dForceMetadata';
import { physicalFixture } from './helpers/c3d';
import { exportC3D } from '../src/exporters/c3d';
import { cropMotionData } from '../src/motion/crop';
import type { ForcePlatform, MotionData, Series, Vec3 } from '../src/motion/types';
import { displayOptions } from '../src/components/displayOptions';
import { renameSessionMarker, setData, undoEdit, useSession } from '../src/state/session';
import {
  createPlatformCoordinateSystem,
  createRigidBodyCoordinateSystem,
  LOCAL_COORDINATE_AXIS_LENGTH_MM,
} from '../src/viewer/localCoordinateSystems';
import { isolateScientificScene, registerSceneUpdate } from '../src/viewer/scientificScene';

// Analytic Rz(a) Rx(b); asymmetric, tilted and nontrivial about two axes.
function rotation(a: number, b: number) {
  const c = Math.cos(a),
    s = Math.sin(a),
    u = Math.cos(b),
    v = Math.sin(b);
  return [c, -s * u, s * v, s, c * u, -c * v, 0, v, u];
}
const r0 = rotation(0.6, -0.4),
  r1 = rotation(-0.8, 0.7),
  r2 = rotation(1.1, -0.9);
const localOrigin: Vec3 = [12, -34, -50];
const series = (values: number[], components: number, rate = 100, startTime = 0): Series => ({
  values: new Float64Array(values),
  components,
  rate,
  startTime,
});
const h5Source: MotionData['source'] = { format: 'H5', originalPositionUnit: 'mm', metadata: {} };
function posePlate(): ForcePlatform {
  return {
    name: 'Synthetic plate',
    type: 2,
    force: series(new Array(18).fill(0), 3, 200),
    moment: series(new Array(18).fill(0), 3, 200),
    cop: series(new Array(18).fill(0), 3, 200),
    position: series([1234, -456, 78, 2000, 100, 250, 3000, 500, 400], 3),
    rotation: series([...r0, ...r1, ...r2], 9),
    origin: new Float64Array(localOrigin),
    poseFrame: 'global',
    coordinateFrame: 'global',
    provenance: 'Synthetic declared pose',
  };
}
function expectAxes(axes: THREE.AxesHelper, position: Vec3, r: number[], precision = 10) {
  expect(axes.visible).toBe(true);
  axes.position.toArray().forEach((v, i) => expect(v).toBeCloseTo(position[i] * 0.001, precision));
  // Check all directed XYZ endpoints in world space, detecting transpose/handedness mistakes.
  axes.updateMatrixWorld(true);
  for (let a = 0; a < 3; a++) {
    const endpoint = new THREE.Vector3()
      .setComponent(a, LOCAL_COORDINATE_AXIS_LENGTH_MM * 0.001)
      .applyMatrix4(axes.matrixWorld)
      .sub(axes.position);
    endpoint.toArray().forEach((v, i) => expect(v).toBeCloseTo(r[i * 3 + a] * 0.1, precision));
  }
}

function expectPlateAxes(
  axes: THREE.AxesHelper,
  anchor: Vec3,
  r: number[],
  precision = 10,
  type = 2,
  storedOrigin: Vec3 = localOrigin,
) {
  // ORIGIN points sensor -> surface. TYPE-3 lateral components describe transducer spacing.
  const local = type === 1 || type === 3 ? [0, 0, storedOrigin[2]] : storedOrigin;
  const origin = anchor.map(
    (v, a) => v - r[a * 3] * local[0] - r[a * 3 + 1] * local[1] - r[a * 3 + 2] * local[2],
  ) as Vec3;
  expectAxes(axes, origin, r, precision);
}

function expectPlateOffset(axes: THREE.AxesHelper, anchor: Vec3) {
  const local = axes.position
    .clone()
    .multiplyScalar(1000)
    .sub(new THREE.Vector3(...anchor))
    .applyQuaternion(axes.quaternion.clone().invert());
  local.toArray().forEach((v, a) => expect(v).toBeCloseTo(-localOrigin[a], 9));
}

describe('force-platform local coordinate systems', () => {
  it.each(
    ([2, 3, 4] as const).flatMap((type) => {
      const expectedOrigin: Vec3 = type === 3 ? [220, 180, -50] : localOrigin;
      return [
        { type, expectedOrigin, rawOrigin: expectedOrigin },
        { type, expectedOrigin, rawOrigin: expectedOrigin.map((v) => -v) },
      ];
    }),
  )(
    'locates a TYPE-$type measurement origin using ORIGIN $rawOrigin and a downward plate normal',
    ({ type, expectedOrigin, rawOrigin }) => {
      const input = physicalFixture(type),
        view = new DataView(input);
      const plateRotation = rotation(0.6, Math.PI - 0.4);
      const storage = readParameters(view).params.get('FORCE_PLATFORM:CORNERS')!.storage!;
      const originStorage = readParameters(view).params.get('FORCE_PLATFORM:ORIGIN')!.storage!;
      rawOrigin.forEach((v, i) => view.setFloat32(originStorage.offset + i * 4, v, true));
      const center = [1234, -456, 78];
      const corners = [
        [300, 200, 0],
        [-300, 200, 0],
        [-300, -200, 0],
        [300, -200, 0],
      ];
      const global = corners.flatMap((c) =>
        [0, 1, 2].map(
          (a) => center[a] + plateRotation[a * 3] * c[0] + plateRotation[a * 3 + 1] * c[1],
        ),
      );
      global.forEach((v, i) => view.setFloat32(storage.offset + i * 4, v, true));
      const data = parseC3D(input, 'oblique.c3d'),
        p = data.forcePlatforms[0];
      const helper = createPlatformCoordinateSystem(p, data.source);
      expect(p.type).toBe(type);
      expect(p.origin).toEqual(new Float64Array(expectedOrigin));
      const snapshot = structuredClone(data);
      expect(helper.axes.visible).toBe(false);
      helper.update(0, true);
      expectPlateAxes(helper.axes, center as Vec3, plateRotation, 6, type, expectedOrigin);
      expect(helper.axes.position.z).toBeLessThan(center[2] * 0.001);
      helper.update(1, true); // Static geometry persists at later times.
      expectPlateAxes(helper.axes, center as Vec3, plateRotation, 6, type, expectedOrigin);
      helper.update(1, false);
      expect(helper.axes.visible).toBe(false);
      expect(data).toEqual(snapshot);
      helper.dispose();
    },
  );
  it('subtracts the TYPE-2 sensor-to-surface vector from the H5 Position anchor', () => {
    const p = posePlate();
    p.position = series([1234, -456, 78], 3);
    p.rotation = series(r0, 9);
    // Corners remain global geometry; the sensor origin is obtained by inverting ORIGIN.
    p.corners = series([0, 0, 500, 800, 0, 500, 800, 600, 500, 0, 600, 500], 12);
    const helper = createPlatformCoordinateSystem(p, h5Source);
    helper.update(2, true);
    expectPlateAxes(helper.axes, [1234, -456, 78], r0);
    helper.dispose();
  });
  it.each([1, 3])(
    'TYPE-%i ignores transducer X/Y spacing and locates the origin below a horizontal plate',
    (type) => {
      const p = posePlate();
      p.type = type;
      p.position = series([1000, 2000, 300], 3);
      const down = [1, 0, 0, 0, -1, 0, 0, 0, -1];
      p.rotation = series(down, 9);
      p.origin = new Float64Array([220, 180, -45]);
      const helper = createPlatformCoordinateSystem(p, h5Source);
      helper.update(0, true);
      expectAxes(helper.axes, [1000, 2000, 255], down);
      p.origin[0] = 900;
      p.origin[1] = 700;
      helper.update(0, true);
      expectAxes(helper.axes, [1000, 2000, 255], down);
      p.origin[0] = NaN;
      p.origin[1] = Infinity;
      helper.update(0, true);
      expectAxes(helper.axes, [1000, 2000, 255], down);
      helper.dispose();
    },
  );
  it.each([2, 4])(
    'TYPE-%i inverts the full sensor-to-surface vector, including real lateral offsets',
    (type) => {
      const p = posePlate();
      p.type = type;
      p.position = series([1000, 2000, 300], 3);
      const down = [1, 0, 0, 0, -1, 0, 0, 0, -1];
      p.rotation = series(down, 9);
      const helper = createPlatformCoordinateSystem(p, h5Source);
      helper.update(0, true);
      expectAxes(helper.axes, [988, 1966, 250], down);
      helper.dispose();
    },
  );
  it.each([undefined, 5])(
    'does not guess nonzero H5 origin semantics for plate type %s',
    (type) => {
      const p = posePlate();
      p.type = type;
      const helper = createPlatformCoordinateSystem(p, h5Source);
      helper.update(0, true);
      expect(helper.axes.visible).toBe(false);
      helper.dispose();
    },
  );
  it('can use established C3D definition type provenance for stored H5 poses', () => {
    const p = posePlate();
    p.type = undefined;
    p.c3dSource = {
      definition: {
        type: 3,
        channels: Array.from({ length: 8 }, (_, i) => i),
        corners: new Float64Array(12),
        origin: localOrigin,
      },
    };
    const helper = createPlatformCoordinateSystem(p, h5Source);
    helper.update(0, true);
    expectPlateAxes(helper.axes, [1234, -456, 78], r0, 10, 3);
    helper.dispose();
  });
  it('follows independent geometry clocks and crop rebasing at multiple frames', () => {
    const p = posePlate();
    p.position!.times = p.rotation!.times = new Float64Array([0, 0.01, 0.02]);
    const helper = createPlatformCoordinateSystem(p, h5Source);
    for (const [time, position, r] of [
      [0, [1234, -456, 78], r0],
      [0.01, [2000, 100, 250], r1],
      [0.02, [3000, 500, 400], r2],
    ] as const) {
      helper.update(time, true);
      expectPlateAxes(helper.axes, [...position], [...r]);
    }
    const data = parseC3D(physicalFixture(), 'synthetic.c3d');
    data.timeline = { rate: 100, frameCount: 3, firstFrame: 20, duration: 0.02 };
    data.forcePlatforms = [p];
    data.source = h5Source;
    const cropped = cropMotionData(data, 1, 3);
    const croppedHelper = createPlatformCoordinateSystem(cropped.forcePlatforms[0], h5Source);
    croppedHelper.update(0, true);
    expectPlateAxes(croppedHelper.axes, [2000, 100, 250], r1);
    croppedHelper.update(0.01, true);
    expectPlateAxes(croppedHelper.axes, [3000, 500, 400], r2);
    helper.dispose();
    croppedHelper.dispose();
  });
  it('interpolates valid rotations without shear at fractional media times', () => {
    const helper = createPlatformCoordinateSystem(posePlate(), h5Source);
    helper.update(0.005, true);
    expect(helper.axes.visible).toBe(true);
    expectPlateOffset(helper.axes, [1617, -178, 164]);
    // Slerp traverses half the angular distance and remains a proper rotation.
    const first = helper.axes.quaternion.clone();
    helper.update(0, true);
    const start = helper.axes.quaternion.clone();
    helper.update(0.01, true);
    const end = helper.axes.quaternion.clone();
    expect(start.angleTo(first)).toBeCloseTo(start.angleTo(end) / 2, 10);
    expect(first.length()).toBeCloseTo(1, 12);
    helper.dispose();
  });
  it('does not accumulate the origin offset across repeated updates or toggles', () => {
    const p = posePlate(),
      snapshot = structuredClone(p);
    const helper = createPlatformCoordinateSystem(p, h5Source);
    for (let i = 0; i < 5; i++) {
      helper.update(0.01, true);
      expectPlateAxes(helper.axes, [2000, 100, 250], r1);
      helper.update(0.01, false);
      expect(helper.axes.visible).toBe(false);
    }
    expect(p).toEqual(snapshot);
    helper.dispose();
  });
  it.each(['missing', 'zero'])('keeps the frame anchor for a %s origin offset', (kind) => {
    const p = posePlate();
    p.origin = kind === 'missing' ? undefined : new Float64Array(3);
    const helper = createPlatformCoordinateSystem(p, h5Source);
    helper.update(0, true);
    expectAxes(helper.axes, [1234, -456, 78], r0);
    helper.dispose();
  });
  it.each([
    { kind: 'nonfinite', values: [12, NaN, -50] },
    { kind: 'infinite', values: [Infinity, -34, -50] },
    { kind: 'short', values: [12, -34] },
    { kind: 'long', values: [12, -34, -50, 0] },
  ])('hides a $kind origin offset', ({ values }) => {
    const p = posePlate();
    p.origin = new Float64Array(values);
    const helper = createPlatformCoordinateSystem(p, h5Source);
    helper.update(0, true);
    expect(helper.axes.visible).toBe(false);
    helper.dispose();
  });
  it.each([
    'missing position',
    'missing rotation',
    'unresolved pose',
    'NaN position',
    'NaN rotation',
    'zero rotation',
    'reflection',
    'shear',
    'out of range',
  ])('omits %s without a corner fallback', (invalid) => {
    const p = posePlate();
    p.corners = series([100, 100, 0, -100, 100, 0, -100, -100, 0, 100, -100, 0], 12);
    if (invalid === 'missing position') p.position = undefined;
    if (invalid === 'missing rotation') p.rotation = undefined;
    if (invalid === 'unresolved pose') p.poseFrame = undefined;
    if (invalid === 'NaN position') p.position!.values[0] = NaN;
    if (invalid === 'NaN rotation') p.rotation!.values[0] = NaN;
    if (invalid === 'zero rotation') p.rotation!.values.fill(0, 0, 9);
    if (invalid === 'reflection') p.rotation!.values.set([-1, 0, 0, 0, 1, 0, 0, 0, 1]);
    if (invalid === 'shear') p.rotation!.values[1] += 0.2;
    const helper = createPlatformCoordinateSystem(p, h5Source);
    helper.update(invalid === 'out of range' ? 1 : 0, true);
    expect(helper.axes.visible).toBe(false);
    helper.dispose();
  });
  it('does not infer H5 local axes from arbitrary corners or the assume-global force option', () => {
    const data = parseC3D(physicalFixture(), 'synthetic.c3d');
    const helper = createPlatformCoordinateSystem(data.forcePlatforms[0], h5Source);
    useSession.setState({ assumeGlobal: true });
    helper.update(0, true);
    expect(helper.axes.visible).toBe(false);
    helper.dispose();
  });
  it('preserves invalid gaps while allowing the exact valid endpoint', () => {
    const p = posePlate();
    p.rotation!.values[9] = NaN;
    const helper = createPlatformCoordinateSystem(p, h5Source);
    helper.update(0, true);
    expect(helper.axes.visible).toBe(true);
    helper.update(0.005, true);
    expect(helper.axes.visible).toBe(false);
    helper.update(0.01, true);
    expect(helper.axes.visible).toBe(false);
    helper.update(0.02, true);
    expect(helper.axes.visible).toBe(true);
    helper.dispose();
  });
  it('respects irregular pose timestamps and nonzero stream starts without extrapolation', () => {
    const p = posePlate();
    p.position!.times = p.rotation!.times = new Float64Array([0.1, 0.15, 0.3]);
    p.position!.startTime = p.rotation!.startTime = 0.1;
    const helper = createPlatformCoordinateSystem(p, h5Source);
    helper.update(0.15, true);
    expectPlateAxes(helper.axes, [2000, 100, 250], r1);
    helper.update(0.225, true);
    expect(helper.axes.visible).toBe(true);
    expectPlateOffset(helper.axes, [2500, 300, 325]);
    helper.update(0.09, true);
    expect(helper.axes.visible).toBe(false);
    helper.update(0.31, true);
    expect(helper.axes.visible).toBe(false);
    helper.dispose();
  });
  it.each(['nonfinite', 'degenerate'])('omits C3D %s corners', (invalid) => {
    const data = parseC3D(physicalFixture(), 'synthetic.c3d');
    const p = data.forcePlatforms[0];
    if (invalid === 'nonfinite') p.corners!.values[0] = NaN;
    else p.corners!.values.fill(0);
    const helper = createPlatformCoordinateSystem(p, data.source);
    helper.update(0, true);
    expect(helper.axes.visible).toBe(false);
    helper.dispose();
  });
});

describe('rigid-body local coordinate systems', () => {
  const body = () => ({
    name: 'Synthetic body',
    markers: ['Unrelated marker'],
    position: posePlate().position!,
    rotation: posePlate().rotation,
  });
  it('follows the stored origin/rotation at each frame rather than marker geometry', () => {
    const b = body(),
      helper = createRigidBodyCoordinateSystem(b),
      snapshot = structuredClone(b);
    expect(helper.axes.visible).toBe(false);
    for (const [time, position, r] of [
      [0, [1234, -456, 78], r0],
      [0.01, [2000, 100, 250], r1],
      [0.02, [3000, 500, 400], r2],
    ] as const) {
      helper.update(time, true);
      expectAxes(helper.axes, [...position], [...r]);
    }
    helper.update(0.005, true);
    expect(helper.axes.visible).toBe(true);
    expect(helper.axes.position.x).toBeCloseTo(1.617, 10);
    helper.update(0.01, false);
    expect(helper.axes.visible).toBe(false);
    expect(b).toEqual(snapshot);
    helper.dispose();
  });
  it.each([
    'missing rotation',
    'invalid translation',
    'invalid rotation',
    'reflection',
    'shear',
    'unavailable time',
  ])('hides %s and does not reuse the last valid pose', (invalid) => {
    const b = body(),
      helper = createRigidBodyCoordinateSystem(b);
    helper.update(0, true);
    expect(helper.axes.visible).toBe(true);
    if (invalid === 'missing rotation') b.rotation = undefined;
    if (invalid === 'invalid translation') b.position.values[3] = NaN;
    if (invalid === 'invalid rotation') b.rotation!.values[9] = NaN;
    if (invalid === 'reflection') b.rotation!.values.set([-1, 0, 0, 0, 1, 0, 0, 0, 1], 9);
    if (invalid === 'shear') b.rotation!.values[10] += 0.2;
    helper.update(invalid === 'unavailable time' ? 1 : 0.01, true);
    expect(helper.axes.visible).toBe(false);
    helper.dispose();
  });
  it('does not treat a single rigid-body frame as a timeless static pose', () => {
    const b = body();
    b.position = series([1234, -456, 78], 3);
    b.rotation = series(r0, 9);
    const helper = createRigidBodyCoordinateSystem(b);
    helper.update(0, true);
    expectAxes(helper.axes, [1234, -456, 78], r0);
    helper.update(0.01, true);
    expect(helper.axes.visible).toBe(false);
    helper.dispose();
  });
  it('uses importer-normalized matrix ordering and body origins after crop', () => {
    const group = (attrs: Record<string, unknown>, children: Record<string, H5Node>): H5Node => {
      const result: H5Node = {
        attrs: Object.fromEntries(Object.entries(attrs).map(([k, value]) => [k, { value }])),
        keys: () => Object.keys(children),
        get: (path) =>
          path
            .split('/')
            .reduce<H5Node | undefined>(
              (node, key) =>
                node === result ? children[key] : (node?.get?.(key) as H5Node | undefined),
              result,
            ),
      };
      return result;
    };
    const dataset = (shape: number[], values: number[]): H5Node => ({
      shape,
      value: new Float64Array(values),
    });
    const root = group(
      {},
      {
        MetaData: group({}, { Project: group({}, {}) }),
        Trajectories: group(
          { SamplingFrequency: 100 },
          {
            Labeled: group(
              { Labels: ['Unrelated marker'], Unit: 'mm' },
              {
                Data: dataset([1, 4, 3], [0, 0, 0, 0, 0, 0, 500, 500, 500, 1, 1, 1]),
              },
            ),
          },
        ),
        RigidBodies: group(
          {},
          {
            '0': group(
              { Name: 'Known body', Unit: 'mm' },
              {
                Position: dataset([3, 3], [1234, 2000, 3000, -456, 100, 500, 78, 250, 400]),
                Rotation: dataset(
                  [3, 3, 3],
                  r0.flatMap((v, i) => [v, r1[i], r2[i]]),
                ),
              },
            ),
          },
        ),
      },
    );
    const data = parseH5Tree(root, 'body.h5');
    const helper = createRigidBodyCoordinateSystem(data.rigidBodies![0]);
    helper.update(0, true);
    expectAxes(helper.axes, [1234, -456, 78], r0);
    helper.update(0.01, true);
    expectAxes(helper.axes, [2000, 100, 250], r1);
    const cropped = cropMotionData(data, 1, 3);
    const croppedHelper = createRigidBodyCoordinateSystem(cropped.rigidBodies![0]);
    croppedHelper.update(0, true);
    expectAxes(croppedHelper.axes, [2000, 100, 250], r1);
    croppedHelper.update(0.01, true);
    expectAxes(croppedHelper.axes, [3000, 500, 400], r2);
    helper.dispose();
    croppedHelper.dispose();
  });
});

describe('H5 force-platform type provenance', () => {
  function metadataRoot(types: number[], used = types.length): H5Node {
    const prefix = 'MetaData/C3DParameters/FORCE_PLATFORM';
    const nodes: Record<string, H5Node> = {
      [prefix]: {},
      [`${prefix}/USED`]: { attrs: { value: { value: new Int32Array([used]) } } },
      [`${prefix}/TYPE`]: { attrs: { value: { value: new Float64Array(types) } } },
    };
    return { get: (path) => nodes[path] };
  }
  it('retains source plate indices even when an earlier plate has an invalid type', () => {
    const root = metadataRoot([0, 3, 4]);
    expect(embeddedC3DPlateType(root, '0')).toBeUndefined();
    expect(embeddedC3DPlateType(root, '1')).toBe(3);
    expect(embeddedC3DPlateType(root, '2')).toBe(4);
  });
  it('reads type independently of calibration/channel definitions or original distance units', () => {
    expect(embeddedC3DPlateType(metadataRoot([3]), '0')).toBe(3);
  });
  it('leaves malformed or ambiguous type provenance unavailable', () => {
    expect(embeddedC3DPlateType({}, '0')).toBeUndefined();
    expect(embeddedC3DPlateType(metadataRoot([3], 2), '0')).toBeUndefined();
    expect(embeddedC3DPlateType(metadataRoot([3]), 'plate-name')).toBeUndefined();
    expect(embeddedC3DPlateType(metadataRoot([3]), '1')).toBeUndefined();
    expect(embeddedC3DPlateType(metadataRoot([2.5]), '0')).toBeUndefined();
  });
});

describe('display state and lifecycle', () => {
  beforeEach(() => {
    useSession.setState(useSession.getInitialState(), true);
    setData(parseC3D(physicalFixture(), 'synthetic.c3d'));
  });
  it('defaults on, exposes only available categories, and toggles independently', () => {
    expect(useSession.getState().display).toMatchObject({
      plateCoordinateSystems: true,
      rigidBodyCoordinateSystems: true,
    });
    const data = useSession.getState().data!;
    const keys = () => displayOptions(data).map(([key]) => key);
    expect(keys()).toContain('plateCoordinateSystems');
    expect(keys()).not.toContain('rigidBodyCoordinateSystems');
    data.forcePlatforms = [];
    data.rigidBodies = [];
    expect(keys()).not.toContain('plateCoordinateSystems');
    expect(keys()).not.toContain('rigidBodyCoordinateSystems');
    data.rigidBodies = [{ name: 'Synthetic body', markers: [], position: series([0, 0, 0], 3) }];
    expect(keys()).toContain('rigidBodyCoordinateSystems');
    useSession.setState((s) => ({
      display: { ...s.display, plateCoordinateSystems: false, rigidBodyCoordinateSystems: false },
    }));
    for (const key of ['plateCoordinateSystems', 'rigidBodyCoordinateSystems'] as const) {
      useSession.setState((s) => ({ display: { ...s.display, [key]: true } }));
      expect(useSession.getState().display[key]).toBe(true);
      expect(useSession.getState().display.rigidBodyCoordinateSystems).toBe(
        key === 'rigidBodyCoordinateSystems',
      );
    }
  });
  it.each(['clean', 'modified with undo/redo'])(
    'preserves %s data, dirty state, history and scientific export bytes',
    (mode) => {
      if (mode !== 'clean') {
        renameSessionMarker(0, 'One');
        renameSessionMarker(0, 'Two');
        undoEdit();
      }
      const before = useSession.getState(),
        contents = structuredClone(before.data);
      const input = physicalFixture();
      const dataExport = (data: MotionData) =>
        exportC3D(input, 0, data.timeline.frameCount, undefined, data.markers.labels);
      const exported = dataExport(before.data!);
      for (const key of ['plateCoordinateSystems', 'rigidBodyCoordinateSystems'] as const)
        for (const checked of [true, false, true])
          useSession.setState((s) => ({ display: { ...s.display, [key]: checked } }));
      const after = useSession.getState();
      expect(after.data).toBe(before.data);
      expect(after.data).toEqual(contents);
      expect(after.dirty).toBe(before.dirty);
      expect(after.history).toBe(before.history);
      expect(after.originalData).toBe(before.originalData);
      expect(after.sourceFile).toBe(before.sourceFile);
      expect(dataExport(after.data!)).toEqual(exported);
    },
  );
  it('reuses one helper across toggles and disposes its geometry/material once', () => {
    const helper = createPlatformCoordinateSystem(posePlate(), h5Source);
    const geometry = helper.axes.geometry,
      material = helper.axes.material;
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material as THREE.Material, 'dispose');
    for (let i = 0; i < 20; i++) helper.update(0, i % 2 === 0);
    expect(helper.axes.geometry).toBe(geometry);
    expect(helper.axes.material).toBe(material);
    expect(geometryDispose).not.toHaveBeenCalled();
    helper.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });
  it('updates the same helpers in isolated media scenes with snapshotted visibility', () => {
    const scene = new THREE.Scene(),
      helper = createPlatformCoordinateSystem(posePlate(), h5Source),
      body = createRigidBodyCoordinateSystem({
        name: 'Body',
        markers: [],
        position: posePlate().position!,
        rotation: posePlate().rotation,
      });
    scene.add(helper.axes, body.axes);
    const unregister = registerSceneUpdate(scene, {
      current(time, state, object) {
        helper.update(time, state.display.plateCoordinateSystems, object(helper.axes));
        body.update(time, state.display.rigidBodyCoordinateSystems, object(body.axes));
      },
    });
    const state = useSession.getState();
    state.display.plateCoordinateSystems = false;
    state.display.rigidBodyCoordinateSystems = false;
    const hidden = isolateScientificScene(scene, state);
    state.display.plateCoordinateSystems = true;
    state.display.rigidBodyCoordinateSystems = true;
    const shown = isolateScientificScene(scene, state);
    state.display.plateCoordinateSystems = false;
    state.display.rigidBodyCoordinateSystems = false;
    shown.update(0.01);
    hidden.update(0.01);
    expectPlateAxes(shown.scene.children[0] as THREE.AxesHelper, [2000, 100, 250], r1);
    expectAxes(shown.scene.children[1] as THREE.AxesHelper, [2000, 100, 250], r1);
    expect(hidden.scene.children[0].visible).toBe(false);
    expect(hidden.scene.children[1].visible).toBe(false);
    expect(helper.axes.visible).toBe(false);
    expect(body.axes.visible).toBe(false);
    expect(helper.axes.position.toArray()).toEqual([0, 0, 0]);
    expect(shown.scene.children).toHaveLength(2);
    shown.dispose();
    hidden.dispose();
    unregister();
    helper.dispose();
    body.dispose();
  });
});

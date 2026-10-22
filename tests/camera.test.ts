import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three-stdlib';
import type { MotionData, Series } from '../src/motion/types';
import { MOTION_UNITS } from '../src/motion/units';
import {
  dataCameraBounds,
  markerPoseBounds,
  representativeFrames,
} from '../src/viewer/cameraBounds';
import {
  calculateCameraFit,
  CameraController,
  CAMERA_DIRECTIONS,
} from '../src/viewer/cameraController';
import {
  applyCrop,
  cancelImport,
  editSessionEvent,
  openFile,
  openSessionEvent,
  renameSessionMarker,
  selectCrop,
  setCamera,
  setData,
  setFrame,
  toggleMarker,
  togglePlay,
  undoEdit,
  useSession,
} from '../src/state/session';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters } from '../src/importers/c3d/parameters';
import fixtures from './fixtures/c3d.json';
import { physicalFixture } from './helpers/c3d';

const pose = [
  [-300, -200, 100],
  [350, 250, 1900],
  [200, -250, 900],
];
function motion(frames = [pose]): MotionData {
  return {
    units: MOTION_UNITS,
    name: 'camera fixture',
    source: {
      format: 'H5',
      originalPositionUnit: 'mm',
      metadata: {},
      eventSchema: 'institute-current',
    },
    timeline: {
      rate: 100,
      frameCount: frames.length,
      firstFrame: 37,
      duration: frames.length / 100,
    },
    markers: {
      labels: frames[0].map((_, i) => `M${i}`),
      positions: new Float64Array(frames.flat(2)),
      valid: new Uint8Array(frames.length * frames[0].length).fill(1),
    },
    forcePlatforms: [],
    analogs: [],
    events: [{ label: 'event', context: '', time: 0.01 }],
    warnings: [],
  };
}
const series = (values: number[], components = 3, startTime = 0): Series => ({
  values: new Float64Array(values),
  components,
  rate: 100,
  startTime,
});
const closeVector = (actual: Vector3, expected: number[]) =>
  actual.toArray().forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 8));

describe('representative scene-space bounds', () => {
  it.each([
    [0, 0, 0],
    [-10000, -20000, -30000],
    [1000000, 2000000, 3000000],
  ])('bounds a normal pose translated by %j, %j, %j mm', (x, y, z) => {
    const data = motion([pose.map((p) => p.map((v, a) => v + [x, y, z][a]))]);
    const snapshot = data.markers.positions.slice();
    const bounds = dataCameraBounds(data)!;
    closeVector(bounds.getCenter(new Vector3()), [x / 1000 + 0.025, y / 1000, z / 1000 + 1]);
    closeVector(bounds.getSize(new Vector3()), [0.678, 0.528, 1.828]);
    expect(data.markers.positions).toEqual(snapshot);
  });
  it('retains a legitimate origin and rejects flags, negative residuals and nonfinite XYZ', () => {
    const data = motion([
      [
        [0, 0, 0],
        [NaN, 0, 0],
        [Infinity, 0, 0],
        [9000, 0, 0],
        [8000, 0, 0],
      ],
    ]);
    data.markers.valid[3] = 0;
    data.markers.residuals = new Float64Array([0, 0, 0, 0, -1]);
    closeVector(dataCameraBounds(data)!.getCenter(new Vector3()), [0, 0, 0]);
  });
  it('uses a nearby complete pose instead of one surviving marker in the first frame', () => {
    const data = motion([pose, pose.map((p) => p.map((v) => v + 10000))]);
    data.markers.valid.set([1, 0, 0], 0);
    closeVector(dataCameraBounds(data)!.getCenter(new Vector3()), [10.025, 10, 11]);
  });
  it('uses an earlier nearby pose at a requested frame with missing markers', () => {
    const data = motion([pose, pose]);
    data.markers.valid.fill(0, 3);
    expect(dataCameraBounds(data, 1)).toEqual(dataCameraBounds(data, 0));
  });
  it('prefers a populated nearby pose over three surviving markers in a large set', () => {
    const many = Array.from({ length: 20 }, (_, i) => [i * 10, 0, i * 100]);
    const data = motion([many, many.map((p) => [p[0] + 10000, p[1], p[2]])]);
    data.markers.valid.fill(0, 3, 20);
    expect(dataCameraBounds(data)!.min.x).toBeGreaterThan(9);
  });
  it('samples a bounded number of poses after leading gaps and never bounds a walking envelope', () => {
    const data = motion(
      Array.from({ length: 1000 }, (_, f) => pose.map((p) => [p[0] + f * 1000, p[1], p[2]])),
    );
    expect(representativeFrames(data, 500).length).toBeLessThanOrEqual(21);
    expect(dataCameraBounds(data)!.getSize(new Vector3()).x).toBeCloseTo(0.678);
    data.markers.valid.fill(0, 0, 20 * 3);
    const bounds = dataCameraBounds(data)!;
    expect(bounds.getSize(new Vector3()).x).toBeCloseTo(0.678);
    expect(bounds.min.x).toBeGreaterThan(20);
  });
  it('keeps the best insufficient pose if no complete pose exists', () => {
    const data = motion([pose, pose]);
    data.markers.valid.set([1, 0, 0, 1, 1, 0]);
    expect(dataCameraBounds(data)!.max.z).toBeCloseTo(1.914);
  });
  it.each([
    [[1234, -456, 789]],
    [
      [1234, -456, 789],
      [1234, -456, 789],
    ],
  ])('handles coincident/single points %j', (...points) => {
    closeVector(
      dataCameraBounds(motion([points]))!.getCenter(new Vector3()),
      [1.234, -0.456, 0.789],
    );
  });
  it('returns no bounds for empty or wholly invalid spatial data', () => {
    expect(dataCameraBounds(motion([[]]))).toBeNull();
    const data = motion();
    data.markers.valid.fill(0);
    expect(dataCameraBounds(data)).toBeNull();
  });
  it('rejects only a single extreme outlier with a populated, nondegenerate core', () => {
    const core = Array.from(
      { length: 8 },
      (_, i) => new Vector3(i % 2, (i >> 1) % 2, (i >> 2) % 2),
    );
    const bad = new Vector3(1000, 1000, 1000);
    expect(markerPoseBounds([...core, bad])!.max.x).toBeCloseTo(1.014);
    expect(markerPoseBounds([...core, new Vector3(5, 5, 5)])!.max.x).toBeCloseTo(5.014);
    expect(markerPoseBounds([...core.slice(0, 3), bad])!.max.x).toBeCloseTo(1000.014);
    expect(markerPoseBounds([...core, bad, bad.clone()])!.max.x).toBeCloseTo(1000.014);
    expect(markerPoseBounds([...core.map(() => new Vector3()), bad])!.max.x).toBeCloseTo(1000.014);
  });
  it('ignores distant plates when markers exist; uses current plate corners when they do not', () => {
    const data = motion([pose, pose]);
    data.forcePlatforms = [
      {
        name: 'moving',
        coordinateFrame: 'global',
        provenance: 'test',
        corners: series(
          [
            100000, 0, 0, 101000, 0, 0, 101000, 1000, 0, 100000, 1000, 0, 200000, 0, 0, 201000, 0,
            0, 201000, 1000, 0, 200000, 1000, 0,
          ],
          12,
        ),
        force: series([0, 0, 100000]),
        moment: series([0, 0, 0]),
        cop: series([1000000, 0, 0]),
      },
    ];
    expect(dataCameraBounds(data)!.max.x).toBeLessThan(1);
    data.markers.valid.fill(0);
    closeVector(dataCameraBounds(data, 1)!.getCenter(new Vector3()), [200.5, 0.5, 0]);
    data.forcePlatforms[0].corners = series(
      [100000, 0, 0, 101000, 0, 0, 101000, 1000, 0, 100000, 1000, 0],
      12,
      50,
    );
    closeVector(dataCameraBounds(data)!.getCenter(new Vector3()), [100.5, 0.5, 0]);
    data.forcePlatforms[0].corners.values[0] = NaN;
    expect(dataCameraBounds(data)).toBeNull();
  });
  it('falls back to a body origin using renderer pose validity and its independent clock', () => {
    const data = motion([pose, pose]);
    data.markers.valid.fill(0);
    data.rigidBodies = [
      {
        name: 'body',
        markers: [],
        position: series([1234, -456, 789], 3, 0.01),
        rotation: series([1, 0, 0, 0, 1, 0, 0, 0, 1], 9, 0.01),
      },
    ];
    closeVector(dataCameraBounds(data)!.getCenter(new Vector3()), [1.234, -0.456, 0.789]);
    data.forcePlatforms = [
      {
        name: 'distant plate',
        coordinateFrame: 'global',
        provenance: 'test',
        force: series([]),
        moment: series([]),
        cop: series([]),
        corners: series([100000, 0, 0, 101000, 0, 0, 101000, 1000, 0, 100000, 1000, 0], 12),
      },
    ];
    closeVector(dataCameraBounds(data)!.getCenter(new Vector3()), [1.234, -0.456, 0.789]);
    data.rigidBodies[0].rotation!.values[0] = 2;
    closeVector(dataCameraBounds(data)!.getCenter(new Vector3()), [100.5, 0.5, 0]);
    data.forcePlatforms = [];
    expect(dataCameraBounds(data)).toBeNull();
  });
  it.each(['mm', 'cm', 'm'])('uses normalized C3D %s coordinates exactly once', (unit) => {
    const bytes = physicalFixture();
    const unitStorage = readParameters(new DataView(bytes)).params.get('POINT:UNITS')!.storage!;
    new Uint8Array(bytes, unitStorage.offset, unitStorage.bytes).set(
      new TextEncoder().encode(unit.padEnd(2)),
    );
    const factor = unit === 'mm' ? 1 : unit === 'cm' ? 0.1 : 0.001;
    const view = new DataView(bytes);
    for (let f = 0; f < 400; f++) {
      const at = 4096 + f * 256;
      [1234 * factor, -456 * factor, 789 * factor].forEach((v, a) =>
        view.setFloat32(at + a * 4, v, true),
      );
    }
    closeVector(
      dataCameraBounds(parseC3D(bytes, 'units.c3d'))!.getCenter(new Vector3()),
      [1.234, -0.456, 0.789],
    );
  });
});

function setup() {
  const camera = new PerspectiveCamera(42, 1.5, 0.005, 2000);
  camera.up.set(0, 0, 1);
  camera.position.set(2, -3, 2);
  const controls = new OrbitControls(camera);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.05;
  controls.maxDistance = 1000;
  const invalidate = vi.fn();
  const controller = new CameraController(camera, controls, invalidate);
  return { camera, controls, controller, invalidate };
}
function expectInside(camera: PerspectiveCamera | OrthographicCamera, bounds: Box3, margin = 1.2) {
  camera.updateMatrixWorld();
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new Vector3(x, y, z).project(camera);
        expect(Math.abs(projected.x)).toBeLessThanOrEqual(1 / margin + 1e-7);
        expect(Math.abs(projected.y)).toBeLessThanOrEqual(1 / margin + 1e-7);
        expect(Math.abs(projected.z)).toBeLessThanOrEqual(1);
      }
}

describe('shared camera geometry and point targeting', () => {
  it.each([0.05, 0.3, 1, 3, 10])(
    'frames a deep, off-origin pose at aspect %j with padding',
    (aspect) => {
      const { camera, controller, controls } = setup();
      camera.aspect = aspect;
      const data = motion([pose.map((p) => p.map((v, a) => v + [100000, -50000, 40000][a]))]);
      expect(controller.fitCameraToData(data)).toBe(true);
      expectInside(camera, dataCameraBounds(data)!);
      expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
      closeVector(controls.target, [100.025, -50, 41]);
      const projected = dataCameraBounds(data)!.getCenter(new Vector3()).project(camera);
      expect(Math.hypot(projected.x, projected.y)).toBeLessThan(1e-8);
    },
  );
  it.each(Object.keys(CAMERA_DIRECTIONS) as (keyof typeof CAMERA_DIRECTIONS)[])(
    'preserves the %s preset orientation',
    (preset) => {
      const { camera, controller, controls } = setup();
      controller.resetCameraView(motion(), 0, preset);
      closeVector(
        camera.position.clone().sub(controls.target).normalize(),
        new Vector3(...CAMERA_DIRECTIONS[preset]).normalize().toArray(),
      );
      expectInside(camera, dataCameraBounds(motion())!);
    },
  );
  it('accounts for configurable margins and perspective zoom', () => {
    const { camera, controller, controls } = setup();
    camera.zoom = 2;
    controller.fitCameraToData(motion(), 0, { margin: 1.5 });
    expectInside(camera, dataCameraBounds(motion())!, 1.5);
    const padded = camera.position.distanceTo(controls.target);
    controller.fitCameraToData(motion(), 0, { margin: 1 });
    expect(camera.position.distanceTo(controls.target)).toBeLessThan(padded);
    expect(camera.far).toBeGreaterThan(controls.maxDistance + 2);
    camera.aspect = 0.00001;
    expect(controller.fitCameraToData(motion())).toBe(true);
    expectInside(camera, dataCameraBounds(motion())!, 1.2);
    expect(controls.maxDistance).toBeGreaterThan(camera.position.distanceTo(controls.target));
    expect(camera.far).toBeGreaterThan(controls.maxDistance);
  });
  it.each([0.2, 2])('frames with orthographic zoom at aspect %j', (aspect) => {
    const camera = new OrthographicCamera(-aspect, aspect, 1, -1, 0.005, 2000);
    camera.up.set(0, 0, 1);
    camera.position.set(2, -3, 2);
    const controls = new OrbitControls(camera);
    const controller = new CameraController(camera, controls);
    expect(controller.fitCameraToData(motion())).toBe(true);
    expectInside(camera, dataCameraBounds(motion())!);
    expect(camera.zoom).toBeGreaterThan(0);
  });
  it.each([
    [[2000, 3000, 1000]],
    [
      [2000, 3000, 1000],
      [2000.00001, 3000, 1000],
    ],
  ])('keeps tiny bounds finite %j', (...points) => {
    const { camera, controller, controls } = setup();
    expect(controller.fitCameraToData(motion([points]))).toBe(true);
    expect(camera.position.distanceTo(controls.target)).toBeGreaterThanOrEqual(0.299999);
    expectInside(camera, dataCameraBounds(motion([points]))!);
  });
  it('keeps body pose axes visible when body-only geometry is fitted in a narrow viewport', () => {
    const { camera, controller } = setup();
    camera.aspect = 0.05;
    const data = motion();
    data.markers.valid.fill(0);
    data.rigidBodies = [
      {
        name: 'body',
        markers: [],
        position: series([1000, -2000, 3000]),
        rotation: series([1, 0, 0, 0, 1, 0, 0, 0, 1], 9),
      },
    ];
    expect(controller.fitCameraToData(data)).toBe(true);
    expectInside(camera, new Box3(new Vector3(0.9, -2.1, 2.9), new Vector3(1.1, -1.9, 3.1)));
  });
  it('focuses a world point with the same direction, distance, zoom and damping', () => {
    const { camera, controller, controls, invalidate } = setup();
    controller.fitCameraToData(motion());
    const offset = camera.position.clone().sub(controls.target);
    const direction = camera.getWorldDirection(new Vector3());
    const zoom = camera.zoom;
    const target = new Vector3(123.456, -456.789, 1.234);
    expect(controller.focusCameraOnPoint(target)).toBe(true);
    closeVector(controls.target, target.toArray());
    closeVector(camera.position.clone().sub(controls.target), offset.toArray());
    closeVector(camera.getWorldDirection(new Vector3()), direction.toArray());
    expect(camera.zoom).toBe(zoom);
    expect(controls.enableDamping).toBe(true);
    expect(controls.minDistance).toBe(0.05);
    expect(controls.maxDistance).toBe(1000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it('clears pending damping before a fit so subsequent control updates keep the pivot stable', () => {
    const { camera, controller, controls } = setup();
    controls.setAzimuthalAngle(1.3);
    controller.resetCameraView(motion());
    const position = camera.position.clone();
    const target = controls.target.clone();
    for (let i = 0; i < 20; i++) controls.update();
    closeVector(camera.position, position.toArray());
    closeVector(controls.target, target.toArray());
  });
  it('rejects unusable fits/focuses without modifying a safe camera', () => {
    const { camera, controller } = setup();
    const previous = camera.position.clone();
    expect(controller.fitCameraToData(motion([[]]))).toBe(false);
    expect(controller.focusCameraOnPoint(new Vector3(NaN, 0, 0))).toBe(false);
    expect(
      controller.focusCameraOnPoint(new Vector3(), { offset: new Vector3(1e308, 1e308, 1e308) }),
    ).toBe(false);
    expect(calculateCameraFit(camera, new Box3(), new Vector3(1, 1, 1))).toBeNull();
    expect(calculateCameraFit(camera, dataCameraBounds(motion())!, new Vector3())).toBeNull();
    closeVector(camera.position, previous.toArray());
  });
});

describe('camera request lifecycle with real session operations', () => {
  const initial = useSession.getInitialState();
  beforeEach(() => {
    useSession.setState(initial, true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  });
  afterEach(() => {
    cancelImport();
    useSession.setState(initial, true);
    vi.unstubAllGlobals();
  });
  function harness() {
    const setupResult = setup();
    const sync = () => {
      const state = useSession.getState();
      return state.data
        ? setupResult.controller.applyRequest(state.data, state.frame, state.camera)
        : false;
    };
    return { ...setupResult, sync };
  }
  it('automatically fits each successful activation once and refuses stale requests', () => {
    const { camera, controls, sync, controller, invalidate } = harness();
    setData(motion());
    expect(sync()).toBe(true);
    const old = useSession.getState().camera;
    expect(sync()).toBe(false);
    const other = motion([pose.map((p) => [p[0] + 100000, p[1], p[2]])]);
    setData(other);
    expect(sync()).toBe(true);
    closeVector(controls.target, [100.025, 0, 1]);
    const position = camera.position.clone();
    expect(controller.applyRequest(motion(), 0, old)).toBe(false);
    closeVector(camera.position, position.toArray());
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it('preserves manual navigation through playback, scrubbing, events, edits, visibility, crop and resize', () => {
    const { camera, controls, sync, invalidate } = harness();
    setData(motion([pose, pose, pose]));
    sync();
    controls.target.add(new Vector3(3, 4, 5));
    camera.position.add(new Vector3(3, 4, 5));
    const target = controls.target.clone(),
      position = camera.position.clone();
    const actions = [
      () => togglePlay(),
      () => setFrame(2),
      () => setFrame(1),
      () => openSessionEvent(0),
      () => editSessionEvent('update', 0, { label: 'changed', context: '', time: 0.01 }),
      () => renameSessionMarker(0, 'Renamed'),
      () => undoEdit(),
      () => toggleMarker(0),
      () => useSession.setState((s) => ({ display: { ...s.display, markers: false } })),
      () => {
        selectCrop(0, 2);
        applyCrop();
      },
      () => {
        camera.aspect = 0.5;
        camera.updateProjectionMatrix();
      },
    ];
    for (const action of actions) {
      action();
      expect(sync()).toBe(false);
      closeVector(controls.target, target.toArray());
      closeVector(camera.position, position.toArray());
    }
    expect(invalidate).toHaveBeenCalledTimes(1);
    setCamera('perspective');
    expect(sync()).toBe(true);
    closeVector(controls.target, [0.025, 0, 1]);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it('consumes empty-geometry commands without retrying as frames/data change', () => {
    const { camera, sync, invalidate } = harness();
    const position = camera.position.clone();
    const data = motion();
    data.markers.valid.fill(0);
    setData(data);
    expect(sync()).toBe(false);
    useSession.setState({ data: motion(), frame: 1 });
    expect(sync()).toBe(false);
    closeVector(camera.position, position.toArray());
    expect(invalidate).not.toHaveBeenCalled();
    setCamera('perspective');
    expect(sync()).toBe(true);
  });
  it.each(['c3d', 'h5'])(
    'a successful %s import fits; rapid imports cannot activate a stale worker',
    (extension) => {
      const workers: { onmessage?: (event: { data: unknown }) => void; terminate: () => void }[] =
        [];
      vi.stubGlobal(
        'Worker',
        class {
          terminate = vi.fn();
          postMessage = vi.fn();
          constructor() {
            workers.push(this);
          }
        },
      );
      const { controls, sync, invalidate } = harness();
      const data = parseC3D(
        Uint8Array.from(Buffer.from(fixtures.intelFloat, 'base64')).buffer,
        'test.c3d',
      );
      const file = new File(['fixture'], `camera.${extension}`);
      openFile(file);
      openFile(file);
      workers[0].onmessage?.({ data: { data } });
      expect(useSession.getState().data).toBeNull();
      workers[1].onmessage?.({ data: { data } });
      expect(sync()).toBe(true);
      const target = controls.target.clone();
      workers[0].onmessage?.({ data: { data: motion() } });
      expect(sync()).toBe(false);
      closeVector(controls.target, target.toArray());
      expect(invalidate).toHaveBeenCalledTimes(1);
    },
  );
});

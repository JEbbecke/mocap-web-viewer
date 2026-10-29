import { expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { parseC3D } from '../src/importers/c3d/importer';
import fixtures from './fixtures/c3d.json';
import { MarkerPickGesture, pickMarkerInScreenSpace } from '../src/viewer/markerPicking';

const rect = { left: 75, top: 40, width: 800, height: 600 };
function setup(distance = 10, size = rect, orthographic = false) {
  const camera = orthographic
    ? new OrthographicCamera(-4, 4, 3, -3, 0.01, 1000)
    : new PerspectiveCamera(42, size.width / size.height, 0.01, 1000);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const data = parseC3D(
    Uint8Array.from(Buffer.from(fixtures.intelFloat, 'base64')).buffer,
    'picking.c3d',
  );
  data.timeline.frameCount = 2;
  data.markers.labels = ['A', 'B'];
  data.markers.positions = new Float64Array([0, 0, 0, 10000000, 0, 0, 10000000, 0, 0, 0, 0, 0]);
  data.markers.valid = new Uint8Array(4).fill(1);
  data.markers.residuals = new Float64Array(4);
  const input = {
    data,
    camera,
    rect: size,
    frame: 0,
    hidden: new Set<number>(),
    clientX: size.left + size.width / 2,
    clientY: size.top + size.height / 2,
  };
  const put = (marker: number, dx: number, dy = 0, z = 0) => {
    const world = new Vector3((2 * dx) / size.width, (-2 * dy) / size.height, 0).unproject(camera);
    if (camera instanceof PerspectiveCamera)
      world
        .sub(camera.position)
        .multiplyScalar((distance - z) / (distance - world.z))
        .add(camera.position);
    else world.z = z;
    data.markers.positions.set(world.multiplyScalar(1000).toArray(), marker * 3);
  };
  return { input, put };
}

it.each([0.3, 10, 500])('keeps the 12 CSS pixel bound at camera distance %s', (distance) => {
  const { input } = setup(distance);
  expect(pickMarkerInScreenSpace(input)).toBe(0);
  expect(pickMarkerInScreenSpace({ ...input, clientX: input.clientX + 11.9 })).toBe(0);
  expect(pickMarkerInScreenSpace({ ...input, clientX: input.clientX + 12.1 })).toBeNull();
  expect(
    pickMarkerInScreenSpace({ ...input, clientX: input.clientX + 9, clientY: input.clientY + 9 }),
  ).toBeNull();
});

it.each([
  { left: 0, top: 0, width: 320, height: 900 },
  { left: 200, top: 150, width: 1600, height: 450 },
])('uses the canvas CSS rectangle %j including its page offset', (size) => {
  const { input, put } = setup(30, size);
  put(0, 40, 30);
  expect(
    pickMarkerInScreenSpace({ ...input, clientX: input.clientX + 49, clientY: input.clientY + 30 }),
  ).toBe(0);
  expect(
    pickMarkerInScreenSpace({ ...input, clientX: input.clientX + 53, clientY: input.clientY + 30 }),
  ).toBeNull();
});

it.each([1, 1.5, 2, 3])('does not scale CSS tolerance with device pixel ratio %s', (dpr) => {
  const { input } = setup();
  // A retina drawing buffer changes resolution, not the DOM rectangle consumed
  // by picking. The browser suite also clicks a real DPR=2 canvas.
  const canvas = {
    width: rect.width * dpr,
    height: rect.height * dpr,
    getBoundingClientRect: () => rect,
  };
  expect(
    pickMarkerInScreenSpace({
      ...input,
      rect: canvas.getBoundingClientRect(),
      clientX: input.clientX + 10,
    }),
  ).toBe(0);
});

it('supports the projection of an orthographic camera', () => {
  const { input, put } = setup(10, rect, true);
  put(0, 10);
  expect(pickMarkerInScreenSpace(input)).toBe(0);
  input.camera.zoom = 2;
  input.camera.updateProjectionMatrix();
  expect(pickMarkerInScreenSpace(input)).toBeNull();
});

it('chooses a clearly nearer marker and rejects near ties regardless of label order or depth', () => {
  const { input, put } = setup();
  put(0, 3);
  put(1, -8);
  expect(pickMarkerInScreenSpace(input)).toBe(0);
  put(0, 8);
  put(1, -3);
  expect(pickMarkerInScreenSpace(input)).toBe(1);
  put(0, 5);
  put(1, -6);
  expect(pickMarkerInScreenSpace(input)).toBeNull();
  put(0, 0);
  put(1, 0, 0, -10);
  expect(pickMarkerInScreenSpace(input)).toBeNull();
});

it.each([
  'hidden',
  'missing',
  'nan',
  'infinity',
  'residual',
  'behind',
  'near clip',
  'far clip',
  'offscreen',
  'missing frame',
])('excludes %s markers', (scenario) => {
  const { input, put } = setup();
  if (scenario === 'hidden') input.hidden.add(0);
  if (scenario === 'missing') input.data.markers.valid[0] = 0;
  if (scenario === 'nan') input.data.markers.positions[0] = NaN;
  if (scenario === 'infinity') input.data.markers.positions[1] = Infinity;
  if (scenario === 'residual') input.data.markers.residuals![0] = -1;
  if (scenario === 'behind') input.data.markers.positions[2] = 20000;
  if (scenario === 'near clip') input.data.markers.positions[2] = 9999;
  if (scenario === 'far clip') input.data.markers.positions[2] = -1000000;
  if (scenario === 'missing frame') input.frame = 100;
  if (scenario === 'offscreen') {
    put(0, rect.width / 2 + 3);
    input.clientX = rect.left + rect.width - 1;
  }
  expect(pickMarkerInScreenSpace(input)).toBeNull();
});

it('uses only current-frame samples without changing coordinates', () => {
  const { input } = setup();
  const before = input.data.markers.positions.slice();
  expect(pickMarkerInScreenSpace(input)).toBe(0);
  expect(pickMarkerInScreenSpace({ ...input, frame: 1 })).toBe(1);
  expect(input.data.markers.positions).toEqual(before);
});

it('rejects a zero-size canvas and pointers outside the canvas', () => {
  const { input } = setup();
  expect(pickMarkerInScreenSpace({ ...input, rect: { ...rect, width: 0 } })).toBeNull();
  expect(pickMarkerInScreenSpace({ ...input, clientX: rect.left - 1 })).toBeNull();
});

const pointer = (clientX = 100, clientY = 100, button = 0, pointerId = 1) => ({
  clientX,
  clientY,
  button,
  pointerId,
});
it('accepts a click within the existing 4px drag threshold', () => {
  const gesture = new MarkerPickGesture();
  gesture.down(pointer());
  gesture.up(pointer(104));
  let picked = false;
  gesture.pick({ ...pointer(104), type: 'click' }, () => {
    picked = true;
  });
  expect(picked).toBe(true);
});

it.each(['drag', 'returning drag', 'cancel', 'second pointer', 'no down', 'wrong button'])(
  'prevents a pick after %s',
  (scenario) => {
    const gesture = new MarkerPickGesture();
    if (scenario !== 'no down') gesture.down(pointer());
    if (scenario.includes('drag')) gesture.move(pointer(110));
    if (scenario === 'cancel') gesture.cancel();
    if (scenario === 'second pointer') gesture.down(pointer(100, 100, 0, 2));
    gesture.up(pointer(scenario === 'drag' ? 110 : 100));
    let picked = false;
    gesture.pick(
      { ...pointer(100, 100, scenario === 'wrong button' ? 2 : 0), type: 'click' },
      () => {
        picked = true;
      },
    );
    expect(picked).toBe(false);
  },
);

it.each([false, true])('waits for right-button release before opening a menu (pan=%s)', (pan) => {
  const gesture = new MarkerPickGesture();
  gesture.down(pointer(100, 100, 2));
  let opened = false;
  gesture.pick({ ...pointer(100, 100, 2), type: 'contextmenu' }, () => {
    opened = true;
  });
  expect(opened).toBe(false);
  if (pan) gesture.move(pointer(120, 100, 2));
  gesture.up(pointer(100, 100, 2));
  expect(opened).toBe(!pan);
});

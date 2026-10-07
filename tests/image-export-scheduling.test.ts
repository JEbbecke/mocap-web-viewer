import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSceneImageRequest } from '../src/viewer/ImageExportBridge';
import { DEFAULT_IMAGE_EXPORT } from '../src/viewer/imageExport';

const mocks = vi.hoisted(() => ({ after: vi.fn(), render: vi.fn() }));
vi.mock('@react-three/fiber', () => ({ addAfterEffect: mocks.after }));
vi.mock('../src/viewer/imageExport', async (original) => ({
  ...(await original()),
  renderSceneImage: mocks.render,
}));
let effects: Set<() => void>;
const frame = { current: 0 };
const root = {
  gl: {} as THREE.WebGLRenderer,
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  size: { width: 800, height: 600, top: 0, left: 0 },
};
beforeEach(() => {
  effects = new Set();
  frame.current = 0;
  root.size.width = 800;
  mocks.render
    .mockReset()
    .mockResolvedValue({ blob: new Blob(['PNG'], { type: 'image/png' }), width: 800, height: 600 });
  mocks.after.mockImplementation((effect: () => void) => {
    effects.add(effect);
    return () => effects.delete(effect);
  });
});
afterEach(() => {
  vi.useRealTimers();
});
const completeFrame = () => {
  frame.current++;
  effects.forEach((effect) => effect());
};

it('waits for this root to finish a new frame and reads its current scene only once', async () => {
  const get = vi.fn(() => root);
  const bridge = createSceneImageRequest(get, frame);
  const controller = new AbortController();
  const result = bridge.request(DEFAULT_IMAGE_EXPORT, controller.signal);
  // Another root's after effect must not capture our stale frame.
  effects.forEach((effect) => effect());
  expect(get).not.toHaveBeenCalled();
  expect(mocks.render).not.toHaveBeenCalled();
  const plate = new THREE.Object3D();
  root.scene.add(plate);
  plate.position.set(1, 2, 3);
  completeFrame();
  await expect(result).resolves.toMatchObject({ width: 800, height: 600 });
  expect(mocks.render).toHaveBeenCalledWith(
    root.gl,
    root.scene,
    root.camera,
    DEFAULT_IMAGE_EXPORT,
    controller.signal,
  );
  expect(effects.size).toBe(0);
  completeFrame();
  expect(mocks.render).toHaveBeenCalledOnce();
});
it.each(['abort', 'unmount'])(
  'cancels a queued capture on %s without rendering or retaining an effect',
  async (reason) => {
    const bridge = createSceneImageRequest(() => root, frame),
      controller = new AbortController();
    const result = bridge.request(DEFAULT_IMAGE_EXPORT, controller.signal);
    if (reason === 'abort') controller.abort();
    else bridge.cancel();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(effects.size).toBe(0);
    completeFrame();
    expect(mocks.render).not.toHaveBeenCalled();
  },
);
it('rejects a zero-size root and propagates rendering errors without changing live state', async () => {
  const bridge = createSceneImageRequest(() => root, frame);
  root.size.width = 0;
  const zero = bridge.request(DEFAULT_IMAGE_EXPORT, new AbortController().signal);
  completeFrame();
  await expect(zero).rejects.toThrow('no size');
  root.size.width = 800;
  mocks.render.mockRejectedValueOnce(new Error('GPU failed'));
  const failed = bridge.request(DEFAULT_IMAGE_EXPORT, new AbortController().signal);
  completeFrame();
  await expect(failed).rejects.toThrow('GPU failed');
  expect(effects.size).toBe(0);
  expect(root.size.width).toBe(800);
});
it('times out an inactive/unavailable renderer and removes the queued effect', async () => {
  vi.useFakeTimers();
  const bridge = createSceneImageRequest(() => root, frame);
  const result = expect(
    bridge.request(DEFAULT_IMAGE_EXPORT, new AbortController().signal),
  ).rejects.toThrow('unavailable');
  await vi.advanceTimersByTimeAsync(5000);
  await result;
  expect(effects.size).toBe(0);
  expect(mocks.render).not.toHaveBeenCalled();
});

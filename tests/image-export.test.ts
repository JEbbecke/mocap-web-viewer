import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ImageExportControl } from '../src/components/ImageExportControl';
import {
  DEFAULT_IMAGE_EXPORT,
  IMAGE_RESOLUTIONS,
  imageCamera,
  imageFilename,
  imageSize,
  renderSceneImage,
  saveSceneImage,
} from '../src/viewer/imageExport';
import { parseC3D } from '../src/importers/c3d/importer';
import fixtures from './fixtures/c3d.json';
import { renameSessionMarker, setData, useSession } from '../src/state/session';

const fake = vi.hoisted(() => ({ createRenderer: vi.fn() }));
vi.mock('three', async (original) => {
  const actual = await original<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor(options: unknown) {
        return fake.createRenderer(options);
      }
    },
  };
});

const context = () => ({
  MAX_RENDERBUFFER_SIZE: 1,
  MAX_TEXTURE_SIZE: 2,
  MAX_VIEWPORT_DIMS: 3,
  isContextLost: vi.fn(() => false),
  getParameter: vi.fn((parameter: number): number | Int32Array =>
    parameter === 3 ? new Int32Array([8192, 8192]) : 8192,
  ),
  getContextAttributes: () => ({ alpha: true }),
});
const makeRenderer = (canvas = { width: 900, height: 600 }) => ({
  domElement: canvas,
  getContext: vi.fn(() => context()),
  outputColorSpace: THREE.SRGBColorSpace,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.15,
  getClearColor: (color: THREE.Color) => color.set('#111c26'),
  getClearAlpha: () => 1,
  shadowMap: { enabled: false, type: THREE.PCFShadowMap },
  localClippingEnabled: false,
  clippingPlanes: [],
  sortObjects: true,
  setPixelRatio: vi.fn(),
  setSize: vi.fn((width: number, height: number) => {
    canvas.width = width;
    canvas.height = height;
  }),
  setClearColor: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
});
let live: ReturnType<typeof makeRenderer>, temporary: ReturnType<typeof makeRenderer>;
let drawing: {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  font: string;
};
let canvases: {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
}[];
let camera: THREE.PerspectiveCamera, scene: THREE.Scene;
const signal = () => new AbortController().signal;
const exportImage = (watermark = false, abortSignal = signal()) =>
  renderSceneImage(
    live as unknown as THREE.WebGLRenderer,
    scene,
    camera,
    { resolution: '2160p', watermark },
    abortSignal,
  );

beforeEach(() => {
  camera = new THREE.PerspectiveCamera(42, 1.5, 0.005, 2000);
  camera.position.set(2, -3, 2);
  camera.up.set(0, 0, 1);
  camera.zoom = 1.4;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#111c26');
  const marker = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial());
  marker.position.set(1, 2, 3);
  scene.add(marker);
  live = makeRenderer();
  drawing = { save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), font: '' };
  canvases = [];
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => drawing),
        toBlob: vi.fn((callback: BlobCallback) =>
          callback(new Blob(['png'], { type: 'image/png' })),
        ),
      };
      canvases.push(canvas);
      return canvas;
    }),
  });
  fake.createRenderer.mockImplementation(({ canvas }) => {
    temporary = makeRenderer(canvas);
    return temporary;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('defaults to the current viewport with an optional enabled watermark and supports exact native sizes', () => {
  expect(DEFAULT_IMAGE_EXPORT).toEqual({ resolution: 'viewport', watermark: true });
  expect(IMAGE_RESOLUTIONS.map((option) => option.value)).toEqual(['viewport', '1080p', '2160p']);
  for (const [resolution, width, height] of [
    ['viewport', 900, 600],
    ['1080p', 1920, 1080],
    ['2160p', 3840, 2160],
  ] as const)
    expect(imageSize(resolution, { width: 900, height: 600 })).toEqual({ width, height });
  expect(() => imageSize('2160p', { width: 0, height: 600 })).toThrow('no size');
});
it('uses sanitized basenames, excludes local paths and supplies a fallback', () => {
  const size = { width: 3840, height: 2160 };
  expect(imageFilename('C:\\private\\participant\\trial.c3d', size)).toBe('trial_3d_3840x2160.png');
  expect(imageFilename('/private/trial.h5', size)).toBe('trial_3d_3840x2160.png');
  expect(imageFilename('bad:*?"<>|\0. .h5', size)).toBe('bad_________3d_3840x2160.png');
  expect(imageFilename(undefined, size)).toBe('je-motion-lab.png');
  expect(imageFilename('.h5', size)).toBe('je-motion-lab.png');
});
it('preserves camera pose and zoom while fitting both aspect directions without cropping or stretching', () => {
  const before = camera.toJSON();
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 600, height: 900 },
  ]) {
    const clone = imageCamera(camera, size) as THREE.PerspectiveCamera;
    expect(clone).not.toBe(camera);
    expect(clone.aspect).toBe(size.width / size.height);
    expect(clone.position).toEqual(camera.position);
    expect(clone.quaternion.toArray()).toEqual(camera.quaternion.toArray());
    expect(clone.zoom).toBe(camera.zoom);
    // Project the original four frustum corners at fixed depth: all must still fit.
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        const point = new THREE.Vector3(x, y, 0).unproject(camera).project(clone);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(1.000001);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(1.000001);
      }
  }
  expect(camera.toJSON()).toEqual(before);
});
it.each([false, true])(
  'renders native 4K with unchanged scene, camera, renderer and scientific session (modified: %s)',
  async (modified) => {
    const data = parseC3D(
      Uint8Array.from(Buffer.from(fixtures.intelFloat, 'base64')).buffer,
      'synthetic.c3d',
    );
    setData(data);
    if (modified) renameSessionMarker(0, 'Edited');
    const state = useSession.getState();
    const scientific = structuredClone(state.data);
    const cameraBefore = camera.toJSON();
    const markerBefore = scene.children[0].position.clone();
    const image = await exportImage();
    expect(image).toMatchObject({ width: 3840, height: 2160 });
    expect(image.blob.type).toBe('image/png');
    expect(temporary.setSize).toHaveBeenCalledWith(3840, 2160, false);
    expect(temporary.setPixelRatio).toHaveBeenCalledWith(1);
    expect(temporary.render.mock.calls[0][0]).toBe(scene);
    expect(temporary.render.mock.calls[0][1]).not.toBe(camera);
    expect(temporary.outputColorSpace).toBe(live.outputColorSpace);
    expect(temporary.toneMapping).toBe(live.toneMapping);
    expect(temporary.toneMappingExposure).toBe(live.toneMappingExposure);
    expect(drawing.drawImage).toHaveBeenCalledWith(canvases[0], 0, 0);
    expect(drawing.fillText).not.toHaveBeenCalled();
    expect(temporary.dispose).toHaveBeenCalledOnce();
    expect(temporary.forceContextLoss).toHaveBeenCalledOnce();
    expect(canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
    expect(live.domElement).toEqual({ width: 900, height: 600 });
    expect(live.setSize).not.toHaveBeenCalled();
    expect(live.render).not.toHaveBeenCalled();
    expect(live.dispose).not.toHaveBeenCalled();
    expect(camera.toJSON()).toEqual(cameraBefore);
    expect(scene.children[0].position).toEqual(markerBefore);
    expect(useSession.getState()).toBe(state);
    expect(useSession.getState().data).toEqual(scientific);
    expect(state.dirty).toBe(modified);
    expect(state.history.past).toHaveLength(modified ? 1 : 0);
  },
);
it('composites only enabled watermark text at resolution-scaled bottom-right positions', async () => {
  await exportImage(true);
  expect(drawing.fillText.mock.calls).toEqual([
    ['JE Motion Lab', 3792, 2070],
    ['jemolab.com', 3792, 2112],
  ]);
  expect(drawing.save).toHaveBeenCalledOnce();
  expect(drawing.restore).toHaveBeenCalledOnce();
});
it.each(['render', 'null blob', 'empty blob', 'encoding', 'context lost', 'canvas allocation'])(
  'cleans up and preserves live state after %s failure',
  async (failure) => {
    const before = camera.toJSON();
    const create = fake.createRenderer.getMockImplementation()!;
    fake.createRenderer.mockImplementation((options) => {
      const renderer = create(options);
      if (failure === 'render')
        renderer.render.mockImplementation(() => {
          throw new Error('GPU render failed');
        });
      if (failure === 'context lost')
        renderer.getContext.mockReturnValue({ ...context(), isContextLost: () => true });
      return renderer;
    });
    const createCanvas = vi.mocked(document.createElement).getMockImplementation()!;
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const canvas = createCanvas(tag) as HTMLCanvasElement;
      if (canvases.length === 2) {
        if (failure === 'null blob')
          vi.mocked(canvas.toBlob).mockImplementation((callback) => callback(null));
        if (failure === 'empty blob')
          vi.mocked(canvas.toBlob).mockImplementation((callback) =>
            callback(new Blob([], { type: 'image/png' })),
          );
        if (failure === 'encoding')
          vi.mocked(canvas.toBlob).mockImplementation(() => {
            throw new Error('encoding');
          });
        if (failure === 'canvas allocation') vi.mocked(canvas.getContext).mockReturnValue(null);
      }
      return canvas;
    });
    await expect(exportImage()).rejects.toThrow();
    if (failure !== 'canvas allocation') {
      expect(temporary.dispose).toHaveBeenCalledOnce();
      expect(temporary.forceContextLoss).toHaveBeenCalledOnce();
    }
    expect(camera.toJSON()).toEqual(before);
    expect(live.setSize).not.toHaveBeenCalled();
    expect(live.dispose).not.toHaveBeenCalled();
    expect(canvases.at(-1)).toMatchObject({ width: 1, height: 1 });
  },
);
it('rejects unsupported device dimensions and lost live contexts before allocating export resources', async () => {
  live.getContext.mockReturnValue({
    ...context(),
    getParameter: vi.fn((parameter: number) =>
      parameter === 3 ? new Int32Array([1024, 1024]) : 1024,
    ),
  });
  await expect(exportImage()).rejects.toThrow('smaller resolution');
  expect(canvases).toHaveLength(0);
  live.getContext.mockReturnValue({ ...context(), isContextLost: vi.fn(() => true) });
  await expect(exportImage()).rejects.toThrow('unavailable');
});
it('cancels asynchronous PNG encoding and releases resources without producing a file', async () => {
  const original = vi.mocked(document.createElement).getMockImplementation()!;
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const canvas = original(tag) as HTMLCanvasElement;
    vi.mocked(canvas.toBlob).mockImplementation(() => {});
    return canvas;
  });
  const controller = new AbortController();
  const result = exportImage(true, controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(temporary.dispose).toHaveBeenCalledOnce();
  expect(temporary.forceContextLoss).toHaveBeenCalledOnce();
  expect(canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
});
it('times out stalled PNG encoding and rejects already cancelled requests', async () => {
  vi.useFakeTimers();
  const original = vi.mocked(document.createElement).getMockImplementation()!;
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const canvas = original(tag) as HTMLCanvasElement;
    vi.mocked(canvas.toBlob).mockImplementation(() => {});
    return canvas;
  });
  const result = expect(exportImage()).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(15000);
  await result;
  const controller = new AbortController();
  controller.abort();
  await expect(exportImage(false, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
it('offers the PNG locally with a sanitized filename and releases its Blob URL', () => {
  vi.useFakeTimers();
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const blob = new Blob(['PNG'], { type: 'image/png' });
  saveSceneImage({ blob, width: 1920, height: 1080 }, 'trial.h5');
  expect(create).toHaveBeenCalledWith(blob);
  expect(anchor.download).toBe('trial_3d_1920x1080.png');
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledWith('blob:local');
});
it('exposes the dedicated Export image action and disables it without a dataset', () => {
  const html = renderToStaticMarkup(
    createElement(ImageExportControl, { data: null, active: true, request: { current: null } }),
  );
  expect(html).toContain('Export image');
  expect(html).toContain('disabled');
  expect(html).not.toContain('Download');
});

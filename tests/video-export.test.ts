import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { videoSchedule, videoFrameTime } from '../src/viewer/videoTiming';
import {
  DEFAULT_VIDEO_EXPORT,
  VIDEO_FORMATS,
  videoCapability,
  videoMenuCapability,
  videoFilename,
  videoExtension,
  renderSceneVideo,
} from '../src/viewer/videoExport';
import { createVideoExportRequest } from '../src/viewer/VideoExportBridge';
import {
  registerSceneUpdate,
  isolateScientificScene,
  markerFrameAt,
} from '../src/viewer/scientificScene';
import { holdPlaybackClock, startClock } from '../src/playback/clock';
import { sample3, sample } from '../src/motion/math';
import { parseC3D } from '../src/importers/c3d/importer';
import fixtures from './fixtures/c3d.json';
import { cropMotionData } from '../src/motion/crop';
import { useSession, setData, renameSessionMarker } from '../src/state/session';

const mock = vi.hoisted(() => ({ surface: vi.fn() }));
vi.mock('../src/viewer/imageExport', async (original) => ({
  ...(await original()),
  createSceneImageSurface: mock.surface,
}));
let encoder: FakeEncoder,
  fail = '',
  closedFrames = 0;
let render: ReturnType<typeof vi.fn>, dispose: ReturnType<typeof vi.fn>;
class FakeFrame {
  timestamp: number;
  duration: number;
  constructor(_canvas: unknown, init: { timestamp: number; duration: number }) {
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }
  close() {
    closedFrames++;
  }
}
class FakeEncoder {
  static isConfigSupported = vi.fn(async (_config: VideoEncoderConfig) => ({ supported: true }));
  state = 'unconfigured';
  frames: { timestamp: number; duration: number }[] = [];
  constructor(private init: VideoEncoderInit) {
    encoder = this;
  }
  configure() {
    if (fail === 'startup') throw new Error('startup failed');
    this.state = 'configured';
  }
  encode(frame: FakeFrame, options: VideoEncoderEncodeOptions) {
    this.frames.push({ timestamp: frame.timestamp, duration: frame.duration });
    if (fail === 'runtime') {
      this.init.error(new DOMException('encoding failed'));
      return;
    }
    if (fail === 'omitted') return;
    this.init.output({
      timestamp: fail === 'timing' ? frame.timestamp + 1 : frame.timestamp,
      type: options.keyFrame ? 'key' : 'delta',
      byteLength: fail === 'memory' ? 65 * 1024 * 1024 : 3,
      copyTo: (bytes: Uint8Array) => bytes.set([1, 2, 3]),
    } as unknown as EncodedVideoChunk);
  }
  async flush() {
    if (fail === 'stalled') await new Promise(() => {});
  }
  close() {
    this.state = 'closed';
  }
}
const data = () =>
  parseC3D(Uint8Array.from(Buffer.from(fixtures.intelFloat, 'base64')).buffer, 'synthetic.c3d');
const root = () => ({
  gl: { domElement: { width: 800, height: 600 } } as THREE.WebGLRenderer,
  camera: new THREE.PerspectiveCamera(),
  scene: new THREE.Scene(),
  size: { width: 800, height: 600, top: 0, left: 0 },
});
beforeEach(() => {
  fail = '';
  closedFrames = 0;
  vi.stubGlobal('VideoEncoder', FakeEncoder);
  vi.stubGlobal('VideoFrame', FakeFrame);
  FakeEncoder.isConfigSupported.mockReset().mockResolvedValue({ supported: true });
  render = vi.fn();
  dispose = vi.fn();
  mock.surface.mockReturnValue({ canvas: {}, render, dispose });
  setData(data());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([30, 60] as const)(
  'schedules 1 s at %s fps with explicit timestamps and an exclusive endpoint',
  (fps) => {
    const schedule = videoSchedule(0, 1, fps, 1);
    expect(schedule.frameCount).toBe(fps);
    const frames = Array.from({ length: fps }, (_, i) => videoFrameTime(schedule, i));
    expect(frames[0]).toMatchObject({ time: 0, timestamp: 0 });
    expect(frames.at(-1)!.time).toBeLessThan(1);
    expect(frames.reduce((sum, frame) => sum + frame.duration, 0)).toBe(1e6);
    expect(() => videoFrameTime(schedule, fps)).toThrow('outside');
  },
);
it.each([1, 0.5, 0.25] as const)(
  'maps fractional physical starts and export speed %s independently of source frame origin',
  (speed) => {
    const schedule = videoSchedule(0.005, 1.005, 30, speed);
    expect(schedule.frameCount).toBe(30 / speed);
    expect(schedule.durationUs).toBe(1e6 / speed);
    expect(videoFrameTime(schedule, 1).time).toBeCloseTo(0.005 + speed / 30);
    const source = data();
    source.timeline.firstFrame = 700;
    const cropped = cropMotionData(source, 1, 3);
    expect(cropped.timeline.firstFrame).toBe(701);
    expect(videoSchedule(0, cropped.timeline.duration, 30, speed).start).toBe(0);
    expect(markerFrameAt(cropped, 0)).toBe(0);
  },
);
it('preserves short/fractional clip duration and rejects zero duration/unsafe configurations', () => {
  const short = videoSchedule(0, 0.005, 30, 1);
  expect(short.frameCount).toBe(1);
  expect(videoFrameTime(short, 0)).toEqual({ time: 0, timestamp: 0, duration: 5000 });
  const fractional = videoSchedule(0, 1.01, 30, 1);
  expect(fractional.frameCount).toBe(31);
  expect(videoFrameTime(fractional, 30).duration).toBe(10000);
  expect(() => videoSchedule(0, 0, 30, 1)).toThrow();
  expect(() => videoSchedule(0, 121, 30, 1)).toThrow('two minutes');
  expect(() => videoSchedule(0, 1e-8, 30, 1)).toThrow('too short');
  expect(DEFAULT_VIDEO_EXPORT).toEqual({ resolution: '1080p', fps: 30, speed: 1, watermark: true });
});
it('detects preferred codecs, fallback and unsupported runtimes without browser-name assumptions', async () => {
  expect((await videoCapability({ width: 1920, height: 1080 }, 30))?.format).toBe(VIDEO_FORMATS[0]);
  FakeEncoder.isConfigSupported
    .mockReset()
    .mockResolvedValueOnce({ supported: false })
    .mockResolvedValueOnce({ supported: true });
  expect((await videoCapability({ width: 800, height: 600 }, 60))?.format).toBe(VIDEO_FORMATS[1]);
  expect(FakeEncoder.isConfigSupported.mock.calls.map((call) => call[0])).toMatchObject([
    { codec: VIDEO_FORMATS[0].codec },
    { codec: VIDEO_FORMATS[1].codec },
  ]);
  vi.stubGlobal('VideoEncoder', undefined);
  expect(await videoCapability({ width: 800, height: 600 }, 30)).toBeNull();
});
it('uses the shared basename sanitization with MIME-correct filenames', () => {
  expect(videoFilename('C:\\private\\trial.h5', 60, 'video/webm;codecs=vp9')).toBe(
    'trial_3d_60fps.webm',
  );
  expect(videoFilename('bad:?.c3d', 30, 'video/webm')).toBe('bad___3d_30fps.webm');
  expect(videoFilename(undefined, 30, 'video/webm')).toBe('je-motion-lab-video.webm');
  expect(() => videoExtension('video/mp4')).toThrow('container');
});
it('keeps video available for viewport-only or 60-fps-only native encoders', async () => {
  FakeEncoder.isConfigSupported.mockImplementation(async (config) => ({
    supported: config.width === 800 && config.framerate === 60,
  }));
  const capability = await videoMenuCapability(
    { width: 800, height: 600 },
    new AbortController().signal,
  );
  expect(capability?.config).toMatchObject({ width: 800, height: 600, framerate: 60 });
});
it('cancels stalled native capability detection and bounds unsupported probes', async () => {
  vi.useFakeTimers();
  FakeEncoder.isConfigSupported.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const cancelled = videoCapability({ width: 1920, height: 1080 }, 30, controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  const unsupported = videoCapability({ width: 1920, height: 1080 }, 30);
  await vi.advanceTimersByTimeAsync(10000);
  await expect(unsupported).resolves.toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it('isolates mutable instance/geometry buffers and preserves canonical independent stream clocks', () => {
  const state = useSession.getState(),
    scene = new THREE.Scene();
  const marker = new THREE.InstancedMesh(
    new THREE.SphereGeometry(),
    new THREE.MeshBasicMaterial(),
    1,
  );
  marker.setColorAt(0, new THREE.Color('red'));
  const plate = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(12), 3),
    ),
    new THREE.MeshBasicMaterial(),
  );
  const arrow = new THREE.ArrowHelper();
  scene.add(marker, plate, arrow);
  const originalArrowPose = arrow.quaternion.toArray();
  const force = {
    values: new Float64Array([0, 0, 100, 0, 0, 200, 0, 0, 300]),
    components: 3,
    rate: 200,
    startTime: 0.005,
  };
  const corners = { values: new Float64Array([0, 10, 20]), components: 1, rate: 100, startTime: 0 };
  let observed: number[] = [];
  const unregister = registerSceneUpdate(scene, {
    current(time, display, object) {
      observed = sample3(force, time);
      object(plate).geometry.attributes.position.array[0] = sample(corners, time);
      object(marker).setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 2, 3));
      object(arrow).setDirection(new THREE.Vector3(0, 1, 0));
      expect(display.hidden).not.toBe(state.hidden);
    },
  });
  const snapshot = isolateScientificScene(scene, state);
  snapshot.update(0.0075);
  expect(observed).toEqual([0, 0, 150]);
  expect(
    (snapshot.scene.children[1] as THREE.Mesh).geometry.attributes.position.array[0],
  ).toBeCloseTo(7.5);
  expect(plate.geometry.attributes.position.array[0]).toBe(0);
  expect(marker.instanceMatrix.array).not.toEqual(
    (snapshot.scene.children[0] as THREE.InstancedMesh).instanceMatrix.array,
  );
  expect(marker.instanceColor!.array).not.toBe(
    (snapshot.scene.children[0] as THREE.InstancedMesh).instanceColor!.array,
  );
  expect(arrow.quaternion.toArray()).toEqual(originalArrowPose);
  expect(
    markerFrameAt(
      { ...state.data!, timeline: { ...state.data!.timeline, rate: 200, frameCount: 100 } },
      1 / 30,
    ),
  ).toBe(6);
  snapshot.dispose();
  unregister();
  expect(scene.children).toHaveLength(3);
});
it.each(['success', 'startup', 'runtime', 'render', 'timing', 'omitted', 'memory', 'cancel'])(
  'leaves science, camera, playback and timeline untouched and releases resources on %s',
  async (mode) => {
    renameSessionMarker(0, 'Edited');
    useSession.setState({ playing: true, frame: 1, speed: 0.5, selected: 1 });
    const state = useSession.getState(),
      arrays = structuredClone(state.data),
      live = root(),
      beforeCamera = live.camera.toJSON();
    fail = mode;
    if (mode === 'render')
      render.mockImplementation(() => {
        throw new Error('render failed');
      });
    const controller = new AbortController();
    const request = createVideoExportRequest(() => live, state.data);
    const result = request.exportVideo(DEFAULT_VIDEO_EXPORT, controller.signal, () => {
      if (mode === 'cancel') controller.abort();
    });
    if (mode === 'success') {
      const output = await result;
      expect(output.blob.type).toBe('video/webm;codecs=vp9');
      expect(output.blob.size).toBeGreaterThan(0);
      expect(render).toHaveBeenCalledWith(expect.any(THREE.Scene), true);
      expect(encoder.frames[0]).toMatchObject({ timestamp: 0 });
    } else await expect(result).rejects.toThrow();
    expect(useSession.getState()).toBe(state);
    expect(state.data).toEqual(arrays);
    expect(live.camera.toJSON()).toEqual(beforeCamera);
    expect(live.gl.domElement.width).toBe(800);
    expect(dispose).toHaveBeenCalledOnce();
    expect(encoder.state).toBe('closed');
    expect(closedFrames).toBe(encoder.frames.length);
  },
);
it('times out a stalled encoder and rejects unavailable or zero-size configurations', async () => {
  vi.useFakeTimers();
  fail = 'stalled';
  const live = root(),
    snapshot = { scene: live.scene, update: vi.fn() };
  const check = expect(
    renderSceneVideo(
      live.gl,
      live.camera,
      snapshot,
      0.1,
      DEFAULT_VIDEO_EXPORT,
      new AbortController().signal,
      vi.fn(),
    ),
  ).rejects.toThrow('stopped responding');
  await vi.advanceTimersByTimeAsync(30000);
  await check;
  expect(encoder.state).toBe('closed');
  live.gl.domElement.width = 0;
  await expect(
    renderSceneVideo(
      live.gl,
      live.camera,
      snapshot,
      0.1,
      DEFAULT_VIDEO_EXPORT,
      new AbortController().signal,
      vi.fn(),
    ),
  ).rejects.toThrow('no size');
});
it('holds and resumes the live clock without session writes or accumulated export wall time', () => {
  let callback: (time: number) => void = () => {},
    now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => {
    callback = fn;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  useSession.setState({ playing: true, loop: true, frame: 0 });
  const stop = startClock(),
    release = holdPlaybackClock(),
    state = useSession.getState();
  now = 10000;
  callback(now);
  expect(useSession.getState()).toBe(state);
  release();
  release();
  callback(9999); // RAF timestamp can precede the resume call's performance.now().
  expect(useSession.getState().frame).toBe(0);
  now = 10001;
  callback(now);
  expect(useSession.getState().frame).toBe(0);
  expect(useSession.getState().playing).toBe(true);
  stop();
});

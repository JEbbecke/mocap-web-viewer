import type * as THREE from 'three';
import { createSceneImageSurface, imageSize, mediaBasename, type ImageSize } from './imageExport';
import { videoFrameTime, videoSchedule } from './videoTiming';
import { webmBlob, type WebmPacket } from './webm';

export const VIDEO_FORMATS = [
  { codec: 'vp09.00.41.08', mime: 'video/webm;codecs=vp9', containerCodec: 'V_VP9' },
  { codec: 'vp8', mime: 'video/webm;codecs=vp8', containerCodec: 'V_VP8' },
] as const;
export const DEFAULT_VIDEO_EXPORT: VideoExportOptions = {
  resolution: '1080p',
  fps: 30,
  speed: 1,
  watermark: true,
};
export interface VideoExportOptions {
  resolution: 'viewport' | '1080p';
  fps: 30 | 60;
  speed: 1 | 0.5 | 0.25;
  watermark: boolean;
}
export interface VideoProgress {
  completed: number;
  total: number;
}
export interface ExportedVideo {
  blob: Blob;
  fps: number;
}
export interface VideoExportRequest {
  viewport: () => ImageSize;
  exportVideo: (
    options: VideoExportOptions,
    signal: AbortSignal,
    progress: (progress: VideoProgress) => void,
  ) => Promise<ExportedVideo>;
}
export const VIDEO_UNAVAILABLE =
  'This browser does not expose a supported video encoder. Image export remains available.';
const MAX_ENCODED_BYTES = 64 * 1024 * 1024;
export async function videoCapability(
  size: ImageSize,
  fps: 30 | 60,
  signal = new AbortController().signal,
) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  if (size.width <= 0 || size.height <= 0 || size.width * size.height > 1920 * 1080) return null;
  for (const format of VIDEO_FORMATS) {
    const config: VideoEncoderConfig = {
      codec: format.codec,
      width: size.width,
      height: size.height,
      framerate: fps,
      bitrate: fps === 60 ? 8e6 : 6e6,
      latencyMode: 'realtime',
    };
    try {
      if ((await waitForEncoder(VideoEncoder.isConfigSupported(config), signal, 5000)).supported)
        return { format, config };
    } catch {
      signal.throwIfAborted();
      /* Try the next native codec. */
    }
  }
  return null;
}
export function videoExtension(mime: string) {
  if (mime.split(';')[0].trim().toLowerCase() !== 'video/webm')
    throw new Error('Unsupported video container.');
  return 'webm';
}
/** Menu availability considers every exposed setting, not just the Full HD default. */
export async function videoMenuCapability(viewport: ImageSize | undefined, signal: AbortSignal) {
  const sizes = [{ width: 1920, height: 1080 }, ...(viewport ? [viewport] : [])];
  for (const size of sizes)
    for (const fps of [30, 60] as const) {
      signal.throwIfAborted();
      const capability = await videoCapability(size, fps, signal);
      if (capability) return capability;
    }
  return null;
}
export function videoFilename(sourceName: string | undefined, fps: number, mime: string) {
  const stem = mediaBasename(sourceName),
    extension = videoExtension(mime);
  return stem ? `${stem}_3d_${fps}fps.${extension}` : `je-motion-lab-video.${extension}`;
}

function waitForEncoder<T>(promise: Promise<T>, signal: AbortSignal, timeout = 30000): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown, value?: T) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(value!);
    };
    const cancel = () => finish(new DOMException('Video export cancelled.', 'AbortError'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'The video encoder stopped responding. Try a shorter clip or a smaller resolution.',
          ),
        ),
      timeout,
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    promise.then(
      (value) => finish(undefined, value),
      (error) => finish(error),
    );
  });
}
function yieldToBrowser(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Video export cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, 0);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/** Native offline encoding: rendering/encoding wall time never changes sample times or output duration. */
export async function renderSceneVideo(
  live: THREE.WebGLRenderer,
  camera: THREE.Camera,
  snapshot: { scene: THREE.Scene; update: (time: number) => void },
  duration: number,
  options: VideoExportOptions,
  signal: AbortSignal,
  progress: (progress: VideoProgress) => void,
): Promise<ExportedVideo> {
  signal.throwIfAborted();
  const schedule = videoSchedule(0, duration, options.fps, options.speed);
  const size = imageSize(options.resolution, {
    width: live.domElement.width,
    height: live.domElement.height,
  });
  if (size.width * size.height > 1920 * 1080)
    throw new Error('Video export is limited to 1080p pixel count. Choose 1920 × 1080.');
  const capability = await videoCapability(size, options.fps, signal);
  signal.throwIfAborted();
  if (!capability) throw new Error(VIDEO_UNAVAILABLE);
  const packets: WebmPacket[] = [];
  let bytes = 0,
    failure: Error | undefined,
    encoder: VideoEncoder | undefined;
  const abort = () => {
    if (encoder && encoder.state !== 'closed') encoder.close();
  };
  let surface: ReturnType<typeof createSceneImageSurface> | undefined;
  signal.addEventListener('abort', abort, { once: true });
  try {
    surface = createSceneImageSurface(live, camera, size);
    encoder = new VideoEncoder({
      output(chunk) {
        if (signal.aborted || failure) return;
        try {
          const expected = videoFrameTime(schedule, packets.length);
          if (
            chunk.timestamp !== expected.timestamp ||
            (packets.length === 0 && chunk.type !== 'key')
          )
            throw new Error(
              'The encoder did not preserve video frame timing. No video was exported.',
            );
          bytes += chunk.byteLength;
          if (bytes > MAX_ENCODED_BYTES)
            throw new Error(
              'The video exceeds the 64 MiB export limit. Crop the trial and try again.',
            );
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          packets.push({
            timestamp: expected.timestamp,
            duration: expected.duration,
            key: chunk.type === 'key',
            bytes: data,
          });
        } catch (error) {
          failure = error instanceof Error ? error : new Error('Video encoding failed.');
          abort();
        }
      },
      error(error) {
        failure = error;
        abort();
      },
    });
    encoder.configure(capability.config);
    progress({ completed: 0, total: schedule.frameCount });
    for (let index = 0; index < schedule.frameCount; index++) {
      signal.throwIfAborted();
      if (failure) throw failure;
      const frameTime = videoFrameTime(schedule, index);
      snapshot.update(frameTime.time);
      surface.render(snapshot.scene, options.watermark);
      const frame = new VideoFrame(surface.canvas, {
        timestamp: frameTime.timestamp,
        duration: frameTime.duration,
      });
      try {
        encoder.encode(frame, { keyFrame: index % (options.fps * 2) === 0 });
      } finally {
        frame.close();
      }
      // Flush each batch: bound native uncompressed frames, yield for cancellation/progress, never skip frames.
      if ((index + 1) % 4 === 0 || index + 1 === schedule.frameCount) {
        await waitForEncoder(encoder.flush(), signal);
        if (failure) throw failure;
        progress({ completed: index + 1, total: schedule.frameCount });
        await yieldToBrowser(signal);
      }
    }
    signal.throwIfAborted();
    if (packets.length !== schedule.frameCount)
      throw new Error('The encoder omitted video frames. No video was exported.');
    return {
      blob: webmBlob(
        packets,
        size.width,
        size.height,
        capability.format.containerCodec,
        schedule.durationUs,
        capability.format.mime,
      ),
      fps: options.fps,
    };
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    throw failure ?? error;
  } finally {
    signal.removeEventListener('abort', abort);
    abort();
    surface?.dispose();
    packets.length = 0;
  }
}

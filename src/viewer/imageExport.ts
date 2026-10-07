import * as THREE from 'three';

export const IMAGE_RESOLUTIONS = [
  { value: 'viewport', label: 'Current viewport' },
  { value: '1080p', label: '1920 × 1080' },
  { value: '2160p', label: '3840 × 2160' },
] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number]['value'];
export interface ImageExportOptions {
  resolution: ImageResolution;
  watermark: boolean;
}
export const DEFAULT_IMAGE_EXPORT: ImageExportOptions = { resolution: 'viewport', watermark: true };
export interface ImageSize {
  width: number;
  height: number;
}
export interface ExportedImage extends ImageSize {
  blob: Blob;
}
export type ImageExportRequest = (
  options: ImageExportOptions,
  signal: AbortSignal,
) => Promise<ExportedImage>;

export function imageSize(resolution: ImageResolution, viewport: ImageSize): ImageSize {
  // Even fixed-size exports require a real visible viewport/projection.
  if (
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    throw new Error('The 3D viewport has no size. Reopen the viewer and try again.');
  if (resolution === '1080p') return { width: 1920, height: 1080 };
  if (resolution === '2160p') return { width: 3840, height: 2160 };
  return { ...viewport };
}

export function imageFilename(sourceName: string | undefined, size: ImageSize): string {
  const basename = (sourceName ?? '').split(/[\\/]/).at(-1) ?? '';
  const stem = basename
    .replace(/\.[^.]*$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return stem && !/^_+$/.test(stem)
    ? `${stem}_3d_${size.width}x${size.height}.png`
    : 'je-motion-lab.png';
}

/** Expand one projection axis to retain the complete viewport framing without stretching. */
export function imageCamera(camera: THREE.Camera, size: ImageSize): THREE.Camera {
  const clone = camera.clone();
  const aspect = size.width / size.height;
  if (clone instanceof THREE.PerspectiveCamera) {
    if (aspect < clone.aspect)
      clone.fov = THREE.MathUtils.radToDeg(
        2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(clone.fov / 2)) * clone.aspect) / aspect),
      );
    clone.aspect = aspect;
    clone.updateProjectionMatrix();
  } else if (clone instanceof THREE.OrthographicCamera) {
    const width = clone.right - clone.left,
      height = clone.top - clone.bottom;
    const cx = (clone.right + clone.left) / 2,
      cy = (clone.top + clone.bottom) / 2;
    const halfWidth = Math.max(width, height * aspect) / 2;
    const halfHeight = Math.max(height, width / aspect) / 2;
    clone.left = cx - halfWidth;
    clone.right = cx + halfWidth;
    clone.top = cy + halfHeight;
    clone.bottom = cy - halfHeight;
    clone.updateProjectionMatrix();
  } else throw new Error('This camera cannot export an image.');
  return clone;
}

export function paintWatermark(context: CanvasRenderingContext2D, size: ImageSize) {
  const scale = Math.min(size.width, size.height) / 1080;
  const padding = 24 * scale;
  context.save();
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.fillStyle = 'rgba(235, 244, 249, 0.72)';
  context.shadowColor = 'rgba(0, 0, 0, 0.65)';
  context.shadowBlur = 3 * scale;
  context.font = `500 ${22 * scale}px system-ui, sans-serif`;
  context.fillText('JE Motion Lab', size.width - padding, size.height - padding - 21 * scale);
  context.font = `${14 * scale}px system-ui, sans-serif`;
  context.fillText('jemolab.com', size.width - padding, size.height - padding);
  context.restore();
}

function checkContext(renderer: THREE.WebGLRenderer, size: ImageSize) {
  const context = renderer.getContext();
  if (context.isContextLost())
    throw new Error('The 3D renderer is unavailable. Reload the viewer and try again.');
  const limit = Math.min(
    context.getParameter(context.MAX_RENDERBUFFER_SIZE),
    context.getParameter(context.MAX_TEXTURE_SIZE),
  );
  const viewport = context.getParameter(context.MAX_VIEWPORT_DIMS) as Int32Array;
  if (size.width > Math.min(limit, viewport[0]) || size.height > Math.min(limit, viewport[1]))
    throw new Error(
      'This device cannot render that image resolution. Choose a smaller resolution.',
    );
}

function pngBlob(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, blob?: Blob) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(blob!);
    };
    const cancel = () => finish(new DOMException('Image export cancelled.', 'AbortError'));
    const timeout = setTimeout(
      () => finish(new Error('PNG creation timed out. Try a smaller resolution.')),
      15000,
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    try {
      canvas.toBlob((blob) => {
        if (signal.aborted) return;
        if (!blob || blob.size === 0 || blob.type !== 'image/png')
          finish(new Error('The browser could not create a PNG. Try a smaller resolution.'));
        else finish(undefined, blob);
      }, 'image/png');
    } catch {
      finish(new Error('The browser could not encode the image. Try a smaller resolution.'));
    }
  });
}

/** Called after R3F renders: reuse its exact scene buffers, including every stream's current clock. */
export async function renderSceneImage(
  live: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: ImageExportOptions,
  signal: AbortSignal,
): Promise<ExportedImage> {
  signal.throwIfAborted();
  const size = imageSize(options.resolution, {
    width: live.domElement.width,
    height: live.domElement.height,
  });
  checkContext(live, size);
  const renderCanvas = document.createElement('canvas');
  const output = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    output.width = size.width;
    output.height = size.height;
    const context = output.getContext('2d');
    if (!context) throw new Error('The browser could not create an image canvas.');
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: renderCanvas,
        antialias: true,
        alpha: live.getContext().getContextAttributes()?.alpha ?? false,
      });
      checkContext(renderer, size);
      renderer.setPixelRatio(1);
      renderer.setSize(size.width, size.height, false);
      renderer.outputColorSpace = live.outputColorSpace;
      renderer.toneMapping = live.toneMapping;
      renderer.toneMappingExposure = live.toneMappingExposure;
      renderer.setClearColor(live.getClearColor(new THREE.Color()), live.getClearAlpha());
      renderer.shadowMap.enabled = live.shadowMap.enabled;
      renderer.shadowMap.type = live.shadowMap.type;
      renderer.localClippingEnabled = live.localClippingEnabled;
      renderer.clippingPlanes = live.clippingPlanes;
      renderer.sortObjects = live.sortObjects;
      renderer.render(scene, imageCamera(camera, size));
      checkContext(renderer, size);
      // Copy immediately; no persistent preserveDrawingBuffer or live canvas resize.
      context.drawImage(renderCanvas, 0, 0);
    } finally {
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderCanvas.width = renderCanvas.height = 1;
    }
    if (options.watermark) paintWatermark(context, size);
    return { ...size, blob: await pngBlob(output, signal) };
  } finally {
    output.width = output.height = 1;
  }
}

export function saveSceneImage(image: ExportedImage, sourceName?: string) {
  const url = URL.createObjectURL(image.blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = imageFilename(sourceName, image);
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Allow browsers to consume the Blob before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

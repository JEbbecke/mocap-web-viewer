import { useEffect, useRef, type RefObject } from 'react';
import { addAfterEffect, useFrame, useThree, type RootState } from '@react-three/fiber';
import { renderSceneImage, type ImageExportRequest } from './imageExport';

/** Wait for this root's next completed frame so export never advances/interpolates science separately. */
export function ImageExportBridge({ request }: { request: RefObject<ImageExportRequest | null> }) {
  const get = useThree((s) => s.get);
  const rendered = useRef(0);
  useFrame(() => {
    rendered.current++;
  });
  useEffect(() => {
    const bridge = createSceneImageRequest(get, rendered);
    request.current = bridge.request;
    return () => {
      request.current = null;
      bridge.cancel();
    };
  }, [get, request]);
  return null;
}

/** One-shot scheduling and cleanup, independently testable without a DOM/WebGL root. */
export function createSceneImageRequest(
  get: () => Pick<RootState, 'gl' | 'scene' | 'camera' | 'size'>,
  rendered: { current: number },
) {
  let cancelPending: (() => void) | undefined;
  const request: ImageExportRequest = (options, signal) =>
    new Promise((resolve, reject) => {
      cancelPending?.();
      const previous = rendered.current;
      const finish = () => {
        unsubscribe();
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
        cancelPending = undefined;
      };
      const cancel = () => {
        finish();
        reject(new DOMException('Image export cancelled.', 'AbortError'));
      };
      const unsubscribe = addAfterEffect(() => {
        if (rendered.current === previous) return;
        finish();
        const { gl, scene, camera, size } = get();
        if (size.width <= 0 || size.height <= 0) {
          reject(new Error('The 3D viewport has no size. Reopen the viewer and try again.'));
          return;
        }
        renderSceneImage(gl, scene, camera, options, signal).then(resolve, reject);
      });
      const timeout = setTimeout(() => {
        finish();
        reject(new Error('The 3D renderer is unavailable. Reopen the viewer and try again.'));
      }, 5000);
      signal.addEventListener('abort', cancel, { once: true });
      cancelPending = cancel;
      if (signal.aborted) cancel();
    });
  return { request, cancel: () => cancelPending?.() };
}

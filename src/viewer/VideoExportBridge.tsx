import { useEffect, type RefObject } from 'react';
import { useThree, type RootState } from '@react-three/fiber';
import type { MotionData } from '../motion/types';
import { useSession } from '../state/session';
import { holdPlaybackClock } from '../playback/clock';
import { isolateScientificScene } from './scientificScene';
import { renderSceneVideo, type VideoExportRequest } from './videoExport';

export function VideoExportBridge({
  data,
  request,
}: {
  data: MotionData | null;
  request: RefObject<VideoExportRequest | null>;
}) {
  const get = useThree((state) => state.get);
  useEffect(() => {
    request.current = createVideoExportRequest(get, data);
    return () => {
      request.current = null;
    };
  }, [data, get, request]);
  return null;
}
export function createVideoExportRequest(
  get: () => Pick<RootState, 'gl' | 'camera' | 'scene' | 'size'>,
  data: MotionData | null,
): VideoExportRequest {
  return {
    viewport: () => {
      const { gl, size } = get();
      return size.width > 0 && size.height > 0
        ? { width: gl.domElement.width, height: gl.domElement.height }
        : { width: 0, height: 0 };
    },
    async exportVideo(options, signal, progress) {
      if (!data) throw new Error('Open a recording before exporting video.');
      const { gl, camera, scene, size } = get();
      if (!size.width || !size.height)
        throw new Error('The 3D viewport has no size. Reopen the viewer.');
      const release = holdPlaybackClock();
      let snapshot: ReturnType<typeof isolateScientificScene> | undefined;
      try {
        snapshot = isolateScientificScene(scene, useSession.getState());
        return await renderSceneVideo(
          gl,
          camera,
          snapshot,
          data.timeline.duration,
          options,
          signal,
          progress,
        );
      } finally {
        snapshot?.dispose();
        release();
      }
    },
  };
}

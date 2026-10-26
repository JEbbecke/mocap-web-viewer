import { Box3, Vector3 } from 'three';
import type { MotionData } from '../motion/types';
import { sample } from '../motion/math';
import { sceneLength } from './scale';
import { markerScenePosition } from './markerPosition';
import {
  createRigidBodyCoordinateSystem,
  LOCAL_COORDINATE_AXIS_LENGTH_MM,
} from './localCoordinateSystems';

const finite = (point: Vector3) => point.toArray().every(Number.isFinite);

/** Reject only one overwhelmingly isolated sample in a reasonably populated pose.
 * No anatomical/unit threshold: its radius must exceed every other radius by 20x.
 * Small or coincident sets have too little evidence to discard any valid point. */
export function markerPoseBounds(points: Vector3[]): Box3 | null {
  let accepted = points.filter(finite);
  if (accepted.length >= 8) {
    const median = (axis: 'x' | 'y' | 'z') => {
      const sorted = accepted.map((p) => p[axis]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const center = new Vector3(median('x'), median('y'), median('z'));
    const radii = accepted
      .map((point) => ({ point, radius: point.distanceTo(center) }))
      .sort((a, b) => b.radius - a.radius);
    if (radii[1].radius > 0 && radii[0].radius > 20 * radii[1].radius)
      accepted = accepted.filter((point) => point !== radii[0].point);
  }
  // Include the largest existing marker sphere, including the selected marker.
  return accepted.length
    ? new Box3().setFromPoints(accepted).expandByScalar(sceneLength(14))
    : null;
}

/** Bounded search: initial pose, four neighbours each side, then twelve trial samples.
 * Choose one pose, never the complete travel envelope. Frames are zero-based here;
 * timeline.firstFrame is source provenance, not a positions-array offset. */
export function representativeFrames(data: MotionData, initialFrame: number): number[] {
  const count = data.timeline.frameCount;
  if (count < 1) return [];
  const first = Math.max(0, Math.min(count - 1, Math.round(initialFrame) || 0));
  const frames = new Set<number>([first]);
  for (let delta = 1; delta <= 4; delta++)
    for (const frame of [first - delta, first + delta])
      if (frame >= 0 && frame < count) frames.add(frame);
  for (let i = 0; i < 12; i++) frames.add(Math.round((i * (count - 1)) / 11));
  return [...frames];
}

export function dataCameraBounds(data: MotionData, initialFrame = 0): Box3 | null {
  const frames = representativeFrames(data, initialFrame);
  const count = data.markers.labels.length;
  const required = Math.min(count, Math.max(3, Math.ceil(count / 2)));
  let best: Vector3[] = [];
  for (const frame of frames) {
    const points: Vector3[] = [];
    for (let marker = 0; marker < count; marker++) {
      const point = markerScenePosition(data, frame, marker);
      if (point) points.push(point);
    }
    if (points.length > best.length) best = points;
    if (points.length >= required && points.length) break;
  }
  if (best.length) return markerPoseBounds(best);

  // Prefer body origins next so distant platforms cannot shrink a tracked body.
  // Sample geometry on its own clock, as the renderer does; exclude decorations.
  const bodies = (data.rigidBodies ?? []).map(createRigidBodyCoordinateSystem);
  try {
    for (const frame of frames) {
      const time = frame / data.timeline.rate;
      const points: Vector3[] = [];
      for (const body of bodies) {
        // Reuse the renderer's pose validity/clock rules, bounding only its origin.
        body.update(time, true);
        if (body.axes.visible) points.push(body.axes.position.clone());
      }
      if (points.length)
        return new Box3()
          .setFromPoints(points)
          .expandByScalar(sceneLength(LOCAL_COORDINATE_AXIS_LENGTH_MM));
    }
  } finally {
    bodies.forEach((body) => body.dispose());
  }
  for (const frame of frames) {
    const time = frame / data.timeline.rate;
    const points: Vector3[] = [];
    for (const plate of data.forcePlatforms) {
      if (!plate.corners) continue;
      const corners = Array.from(
        { length: 4 },
        (_, corner) =>
          new Vector3(
            ...([0, 1, 2].map((axis) =>
              sceneLength(sample(plate.corners!, time, corner * 3 + axis, true)),
            ) as [number, number, number]),
          ),
      );
      if (corners.every(finite)) points.push(...corners);
    }
    if (points.length) return new Box3().setFromPoints(points).expandByScalar(sceneLength(14));
  }
  return null;
}

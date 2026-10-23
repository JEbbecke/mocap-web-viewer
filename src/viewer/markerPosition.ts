import { Vector3 } from 'three';
import type { MotionData } from '../motion/types';
import { SCENE_UNITS_PER_MM } from './scale';

/** Active-frame position shared by drawing, picking and camera commands. No gap search. */
export function markerScenePosition(
  data: MotionData,
  frame: number,
  marker: number,
  target = new Vector3(),
): Vector3 | null {
  const count = data.markers.labels.length;
  if (
    !Number.isInteger(marker) ||
    marker < 0 ||
    marker >= count ||
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame >= data.timeline.frameCount
  )
    return null;
  const index = frame * count + marker;
  const residual = data.markers.residuals?.[index] ?? NaN;
  if (
    !data.markers.valid[index] ||
    (data.markers.residuals && (!Number.isFinite(residual) || residual < 0))
  )
    return null;
  target.fromArray(data.markers.positions, index * 3).multiplyScalar(SCENE_UNITS_PER_MM);
  return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)
    ? target
    : null;
}

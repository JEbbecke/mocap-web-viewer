import { Vector3, type Camera } from 'three';
import type { MotionData } from '../motion/types';
import { markerScenePosition } from './markerPosition';

export const MARKER_PICK_RADIUS_PX = 12;
const AMBIGUITY_MARGIN_PX = 2;
const DRAG_THRESHOLD_PX = 4;

/** Fallback only: direct sphere intersections retain priority and depth ordering.
 * Coordinates and dimensions are CSS pixels, never drawing-buffer pixels. */
export function pickMarkerInScreenSpace({
  data,
  frame,
  hidden,
  camera,
  rect,
  clientX,
  clientY,
}: {
  data: MotionData;
  frame: number;
  hidden: ReadonlySet<number>;
  camera: Camera;
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
  clientX: number;
  clientY: number;
}): number | null {
  const x = clientX - rect.left,
    y = clientY - rect.top;
  if (!(rect.width > 0 && rect.height > 0) || x < 0 || y < 0 || x > rect.width || y > rect.height)
    return null;
  const point = new Vector3();
  let best: number | null = null,
    nearest = Infinity,
    runnerUp = Infinity;
  for (let marker = 0; marker < data.markers.labels.length; marker++) {
    if (hidden.has(marker) || !markerScenePosition(data, frame, marker, point)) continue;
    point.applyMatrix4(camera.matrixWorldInverse);
    if (point.z >= 0) continue;
    point.applyMatrix4(camera.projectionMatrix);
    if (
      ![point.x, point.y, point.z].every(Number.isFinite) ||
      Math.abs(point.x) > 1 ||
      Math.abs(point.y) > 1 ||
      Math.abs(point.z) > 1
    )
      continue;
    const distance = Math.hypot(
      ((point.x + 1) * rect.width) / 2 - x,
      ((1 - point.y) * rect.height) / 2 - y,
    );
    if (distance > MARKER_PICK_RADIUS_PX) continue;
    if (distance < nearest) {
      runnerUp = nearest;
      nearest = distance;
      best = marker;
    } else runnerUp = Math.min(runnerUp, distance);
  }
  // No index/depth tie-break for a miss: overlapping centres are not a clear hit.
  return runnerUp - nearest >= AMBIGUITY_MARGIN_PX ? best : null;
}

type PointerSample = Pick<PointerEvent, 'pointerId' | 'button' | 'clientX' | 'clientY'>;

/** Canvas-local gesture guard shared by direct and fallback picks. Keep the
 * existing 4px threshold, including excursions that return to the start. */
export class MarkerPickGesture {
  private pointer: number | null = null;
  private button = -1;
  private x = 0;
  private y = 0;
  private valid = false;
  private pending: (() => void) | null = null;

  down(event: PointerSample) {
    if (this.pointer !== null) {
      this.cancel();
      return;
    }
    this.pointer = event.pointerId;
    this.button = event.button;
    this.x = event.clientX;
    this.y = event.clientY;
    this.valid = true;
    this.pending = null;
  }

  move(event: PointerSample) {
    if (this.pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - this.x, event.clientY - this.y) > DRAG_THRESHOLD_PX)
      this.valid = false;
  }

  up(event: PointerSample) {
    if (this.pointer !== event.pointerId) return;
    this.move(event);
    this.pointer = null;
    const pending = this.pending;
    this.pending = null;
    if (this.valid) pending?.();
  }

  cancel() {
    this.pointer = null;
    this.valid = false;
    this.pending = null;
  }

  pick(event: Pick<MouseEvent, 'type' | 'button' | 'clientX' | 'clientY'>, run: () => void) {
    if (
      !this.valid ||
      event.button !== this.button ||
      Math.hypot(event.clientX - this.x, event.clientY - this.y) > DRAG_THRESHOLD_PX
    )
      return;
    // Some browsers emit contextmenu on right-down. Wait for release so a pan
    // starting on a marker cannot select it or open a menu mid-gesture.
    if (this.pointer !== null) {
      if (event.type === 'contextmenu') this.pending = run;
    } else run();
  }
}

import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls } from 'three-stdlib';
import type { MotionData, Vec3 } from '../motion/types';
import type { CameraPreset } from '../state/session';
import { dataCameraBounds } from './cameraBounds';

type ViewCamera = PerspectiveCamera | OrthographicCamera;
export const CAMERA_DIRECTIONS: Record<CameraPreset, [number, number, number]> = {
  perspective: [1.3, -1.8, 1],
  front: [2, 0, 0],
  side: [0, -2, 0],
  top: [0, -0.001, 2],
};
export const DEFAULT_CAMERA_MARGIN = 1.2;
const MIN_DISTANCE = 0.3;
const finite = (point: Vector3) => point.toArray().every(Number.isFinite);

export interface CameraFitOptions {
  margin?: number;
  /** Camera-to-target direction in scene coordinates; omitted preserves orientation. */
  direction?: Vector3;
  minDistance?: number;
}
export interface CameraView {
  target: Vector3;
  offset: Vector3;
  zoom: number;
  near: number;
  far: number;
}

/** Pure fit using all eight corners in camera space, including their depth.
 * Padding scales projected X/Y, so both FOV constraints hold at any aspect. */
export function calculateCameraFit(
  camera: ViewCamera,
  bounds: Box3,
  direction: Vector3,
  options: CameraFitOptions = {},
): CameraView | null {
  if (bounds.isEmpty() || !finite(bounds.min) || !finite(bounds.max)) return null;
  const target = bounds.getCenter(new Vector3());
  const outward = direction.clone().normalize();
  if (!finite(target) || !finite(outward) || outward.lengthSq() === 0) return null;
  const orientation = camera.clone();
  orientation.position.copy(outward);
  orientation.lookAt(new Vector3());
  const inverse = orientation.quaternion.clone().invert();
  const corners: Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        corners.push(new Vector3(x, y, z).sub(target).applyQuaternion(inverse));
  const margin = Math.max(1, options.margin ?? DEFAULT_CAMERA_MARGIN);
  let distance = Math.max(MIN_DISTANCE, options.minDistance ?? 0);
  let zoom = camera.zoom;
  if (camera instanceof PerspectiveCamera) {
    const tanY = Math.tan((camera.getEffectiveFOV() * Math.PI) / 360);
    const tanX = tanY * camera.aspect;
    for (const p of corners)
      distance = Math.max(
        distance,
        p.z + margin * Math.max(Math.abs(p.x) / tanX, Math.abs(p.y) / tanY),
      );
  } else {
    // The live viewer is perspective; keep the primitive usable with an orthographic camera.
    const halfWidth = Math.min(camera.right, -camera.left);
    const halfHeight = Math.min(camera.top, -camera.bottom);
    let required = 0;
    for (const p of corners) {
      required = Math.max(
        required,
        (margin * Math.abs(p.x)) / halfWidth,
        (margin * Math.abs(p.y)) / halfHeight,
      );
      distance = Math.max(distance, p.z + MIN_DISTANCE);
    }
    zoom = required > 0 ? 1 / required : 1;
  }
  // Keep the closest corner in front even for bounds along the viewing direction.
  const maxZ = Math.max(...corners.map((p) => p.z));
  distance = Math.max(distance, maxZ + MIN_DISTANCE);
  const depths = corners.map((p) => distance - p.z);
  const near = Math.min(0.005, Math.min(...depths) / 2);
  // Retain the existing navigation range (including zooming back out), and
  // expand only when fitted depth requires it. No huge fixed replacement range.
  const far = Math.max(camera.far, Math.max(...depths) * 2);
  const offset = outward.multiplyScalar(distance);
  if (
    ![distance, zoom, near, far, margin].every(Number.isFinite) ||
    !finite(offset) ||
    zoom <= 0 ||
    near <= 0
  )
    return null;
  return { target, offset, zoom, near, far };
}

/** One owner of camera/OrbitControls writes. No scene scan, animation or session state.
 * Focus accepts already transformed scene coordinates, preserving the camera offset
 * by default. Fits and preset resets use that same point-targeting operation. */
export class CameraController {
  private handledRevision = -1;

  constructor(
    readonly camera: ViewCamera,
    readonly controls: OrbitControls,
    private invalidate: () => void = () => {},
  ) {}

  focusCameraOnPoint(target: Vector3, view?: Partial<Omit<CameraView, 'target'>>): boolean {
    const { camera, controls } = this;
    const offset = view?.offset?.clone() ?? camera.position.clone().sub(controls.target);
    if (!finite(target) || !finite(offset) || !Number.isFinite(offset.length())) return false;
    if (offset.length() < controls.minDistance || offset.lengthSq() === 0)
      offset
        .copy(camera.getWorldDirection(new Vector3()).negate())
        .multiplyScalar(Math.max(MIN_DISTANCE, controls.minDistance));
    const position = target.clone().add(offset);
    if (!finite(position)) return false;
    const damping = controls.enableDamping;
    const autoRotate = controls.autoRotate;
    // Drain pending input before applying the authoritative pose. Otherwise damped
    // pan/rotation from the previous trial can move a freshly fitted pivot.
    controls.enableDamping = controls.autoRotate = false;
    controls.update();
    controls.target.copy(target);
    camera.position.copy(position);
    if (view?.zoom !== undefined) camera.zoom = view.zoom;
    if (view?.near !== undefined) camera.near = view.near;
    if (view?.far !== undefined) camera.far = view.far;
    // Preserve navigation constraints, extending the distance ceiling only if needed.
    if (offset.length() > controls.maxDistance) controls.maxDistance = offset.length() * 2;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls.update();
    controls.enableDamping = damping;
    controls.autoRotate = autoRotate;
    camera.updateMatrixWorld();
    this.invalidate();
    return true;
  }

  fitCameraToData(data: MotionData, frame = 0, options: CameraFitOptions = {}): boolean {
    const bounds = dataCameraBounds(data, frame);
    if (!bounds) return false;
    const direction = options.direction ?? this.camera.position.clone().sub(this.controls.target);
    const view = calculateCameraFit(this.camera, bounds, direction, {
      ...options,
      minDistance: Math.max(this.controls.minDistance, options.minDistance ?? 0),
    });
    return view ? this.focusCameraOnPoint(view.target, view) : false;
  }

  resetCameraView(data: MotionData, frame = 0, preset: CameraPreset = 'perspective'): boolean {
    return this.fitCameraToData(data, frame, {
      direction: new Vector3(...CAMERA_DIRECTIONS[preset]),
    });
  }

  /** The existing session command increments on successful activation and toolbar
   * actions, never on edits/playback/resize. Consume empty fits too; no retries. */
  applyRequest(
    data: MotionData,
    frame: number,
    request: { preset: CameraPreset; revision: number; point?: Vec3 },
  ): boolean {
    if (request.revision <= this.handledRevision) return false;
    this.handledRevision = request.revision;
    if (request.point) return this.focusCameraOnPoint(new Vector3(...request.point));
    return this.resetCameraView(data, frame, request.preset);
  }
}

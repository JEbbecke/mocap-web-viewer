import * as THREE from 'three';
import type { ForcePlatform, MotionData, Series, Vec3 } from '../motion/types';
import { plateBasis, sample } from '../motion/math';
import { sceneLength, SCENE_UNITS_PER_MM } from './scale';

/** Physical length, shared by all local XYZ inspection aids (red/green/blue). */
export const LOCAL_COORDINATE_AXIS_LENGTH_MM = 100;
const ROTATION_TOLERANCE = 1e-4;

export function createLocalCoordinateAxes(name: string) {
  const axes = new THREE.AxesHelper(sceneLength(LOCAL_COORDINATE_AXIS_LENGTH_MM));
  axes.name = name;
  axes.visible = false;
  // Inspection geometry must not intercept marker selection.
  axes.raycast = () => {};
  return axes;
}

export function createPoseScratch() {
  return {
    matrix: new THREE.Matrix4(),
    first: new THREE.Quaternion(),
    last: new THREE.Quaternion(),
  };
}
type PoseScratch = ReturnType<typeof createPoseScratch>;

/** Row-major scientific local-to-lab matrix. Reject scale, shear, reflection and gaps. */
function readRotation(series: Series, index: number, scratch: PoseScratch, out: THREE.Quaternion) {
  const r = series.values.subarray(index * 9, index * 9 + 9);
  if (r.length !== 9 || !r.every(Number.isFinite)) return false;
  for (let a = 0; a < 3; a++) {
    const length = r[a] ** 2 + r[a + 3] ** 2 + r[a + 6] ** 2;
    if (Math.abs(length - 1) > ROTATION_TOLERANCE) return false;
    for (let b = a + 1; b < 3; b++)
      if (Math.abs(r[a] * r[b] + r[a + 3] * r[b + 3] + r[a + 6] * r[b + 6]) > ROTATION_TOLERANCE)
        return false;
  }
  scratch.matrix.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
  if (Math.abs(scratch.matrix.determinant() - 1) > ROTATION_TOLERANCE) return false;
  out.setFromRotationMatrix(scratch.matrix).normalize();
  return true;
}

/** Same source clocks/range/gap policy as sample(); interpolate valid rotations on SO(3). */
function sampleRotation(
  series: Series,
  time: number,
  staticPose: boolean,
  scratch: PoseScratch,
  out: THREE.Quaternion,
) {
  if (series.components !== 9) return false;
  const n = series.values.length / 9;
  if (!n) return false;
  let index = (time - series.startTime) * series.rate;
  if (staticPose && n === 1) index = 0;
  else if (series.times) {
    const times = series.times;
    if (time < times[0] - 1e-8 || time > times[n - 1] + 1e-8) return false;
    let lo = 0,
      hi = n - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (times[mid] <= time) lo = mid;
      else hi = mid - 1;
    }
    index = lo === n - 1 ? lo : lo + (time - times[lo]) / (times[lo + 1] - times[lo]);
  }
  if (index < -1e-8 || index > n - 1 + 1e-8) return false;
  const nearest = Math.round(index);
  index = Math.max(0, Math.min(n - 1, Math.abs(index - nearest) < 1e-8 ? nearest : index));
  const lo = Math.floor(index),
    fraction = index - lo;
  if (!readRotation(series, lo, scratch, scratch.first)) return false;
  if (fraction < 1e-8) out.copy(scratch.first);
  else {
    if (!readRotation(series, lo + 1, scratch, scratch.last)) return false;
    out.copy(scratch.first).slerp(scratch.last, fraction);
  }
  return true;
}

/** Pose translations alone are scaled; rotation remains lab XYZ, with no axis remapping. */
export function updatePoseCoordinateAxes(
  axes: THREE.AxesHelper,
  position: Series | undefined,
  rotation: Series | undefined,
  time: number,
  enabled: boolean,
  staticPose: boolean,
  scratch: PoseScratch,
) {
  axes.visible = false;
  if (!enabled || position?.components !== 3 || !rotation) return;
  const x = sample(position, time, 0, staticPose),
    y = sample(position, time, 1, staticPose),
    z = sample(position, time, 2, staticPose);
  if (
    ![x, y, z].every(Number.isFinite) ||
    !sampleRotation(rotation, time, staticPose, scratch, axes.quaternion)
  )
    return;
  axes.position.set(sceneLength(x), sceneLength(y), sceneLength(z));
  axes.visible = true;
}

/** H5 needs its declared global pose. Only C3D defines local axes from ordered corners. */
export function createPlatformCoordinateSystem(plate: ForcePlatform, source: MotionData['source']) {
  const axes = createLocalCoordinateAxes(`Force platform coordinate system: ${plate.name}`);
  const scratch = createPoseScratch();
  const offset = new THREE.Vector3();
  const type = plate.type ?? plate.c3dSource?.definition?.type;
  const applyOriginOffset = (target: THREE.AxesHelper) => {
    if (!target.visible || !plate.origin) return;
    if (plate.origin.length !== 3) {
      target.visible = false;
      return;
    }
    const origin = plate.origin;
    // C3D ORIGIN points from the measurement origin to the surface centre.
    // Invert it to locate the measurement origin from the surface anchor.
    // TYPE-3 X/Y are inter-transducer distances, not coordinate-origin translations.
    if (type === 2 || type === 4) offset.set(-origin[0], -origin[1], -origin[2]);
    else if (type === 1 || type === 3) offset.set(0, 0, -origin[2]);
    else if (origin.every((v) => v === 0)) return;
    else {
      // A nonzero ORIGIN without established type semantics cannot locate a reliable origin.
      target.visible = false;
      return;
    }
    if (![offset.x, offset.y, offset.z].every(Number.isFinite)) {
      target.visible = false;
      return;
    }
    // The importers already converted POINT/position units and the legacy C3D sign convention.
    offset.multiplyScalar(SCENE_UNITS_PER_MM).applyQuaternion(target.quaternion);
    target.position.add(offset);
  };
  return {
    axes,
    update(time: number, enabled: boolean, target = axes) {
      target.visible = false;
      if (!enabled) return;
      // An explicit pose is authoritative; never replace invalid samples with corner guesses.
      if (plate.position || plate.rotation) {
        if (plate.poseFrame === 'global')
          updatePoseCoordinateAxes(
            target,
            plate.position,
            plate.rotation,
            time,
            true,
            true,
            scratch,
          );
        applyOriginOffset(target);
        return;
      }
      if (
        source.format !== 'C3D' ||
        plate.coordinateFrame !== 'global' ||
        plate.corners?.components !== 12
      )
        return;
      const corners = Array.from(
        { length: 4 },
        (_, i) => [0, 1, 2].map((a) => sample(plate.corners!, time, i * 3 + a, true)) as Vec3,
      );
      if (!corners.every((c) => c.every(Number.isFinite))) return;
      try {
        const [x, y, z] = plateBasis(corners);
        scratch.matrix.set(
          x[0],
          y[0],
          z[0],
          0,
          x[1],
          y[1],
          z[1],
          0,
          x[2],
          y[2],
          z[2],
          0,
          0,
          0,
          0,
          1,
        );
        target.quaternion.setFromRotationMatrix(scratch.matrix);
        target.position.set(
          ...([0, 1, 2].map((a) =>
            sceneLength(corners.reduce((sum, c) => sum + c[a], 0) / 4),
          ) as Vec3),
        );
        target.visible = true;
        applyOriginOffset(target);
      } catch {
        // Degenerate corners do not define a frame.
      }
    },
    dispose() {
      axes.dispose();
    },
  };
}

/** Render the stored body pose directly; marker membership never supplies an orientation/pivot. */
export function createRigidBodyCoordinateSystem(
  body: NonNullable<MotionData['rigidBodies']>[number],
) {
  const axes = createLocalCoordinateAxes(`Rigid body coordinate system: ${body.name}`);
  const scratch = createPoseScratch();
  return {
    axes,
    update(time: number, enabled: boolean, target = axes) {
      updatePoseCoordinateAxes(target, body.position, body.rotation, time, enabled, false, scratch);
    },
    dispose() {
      axes.dispose();
    },
  };
}

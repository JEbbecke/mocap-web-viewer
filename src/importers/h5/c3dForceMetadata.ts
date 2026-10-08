import type { H5Node } from './schema';
import type {
  C3DAnalogEncoding,
  C3DPlateDefinition,
  ForcePlatform,
  Vec3,
} from '../../motion/types';

function group(root: H5Node, path: string): H5Node | undefined {
  return (root.get?.(`MetaData/C3DParameters/${path}`) as H5Node | null) ?? undefined;
}
function numeric(root: H5Node, path: string, shape?: number[]): number[] {
  const attribute = group(root, path)?.attrs?.value;
  if (!attribute) throw new Error(`missing ${path}`);
  if (shape && attribute.shape?.join(',') !== shape.join(','))
    throw new Error(`invalid ${path} dimensions`);
  const raw = attribute.value;
  if (!Array.isArray(raw) && !ArrayBuffer.isView(raw)) throw new Error(`invalid ${path} values`);
  const values = Array.from(raw as ArrayLike<number | bigint>, Number);
  if (
    values.some((v) => !Number.isFinite(v)) ||
    (shape && values.length !== shape.reduce((a, b) => a * b, 1))
  )
    throw new Error(`invalid ${path} values`);
  return values;
}

/** HDF5 attribute arrays are row-major, unlike C3D parameter arrays.
 * Never infer the original plate type or channel mapping from signal labels. */
export function embeddedC3DPlateType(root: H5Node, key: string): number | undefined {
  if (!group(root, 'FORCE_PLATFORM')) return;
  try {
    const used = numeric(root, 'FORCE_PLATFORM/USED')[0],
      index = Number(key);
    const types = numeric(root, 'FORCE_PLATFORM/TYPE');
    if (
      !Number.isInteger(used) ||
      used < 1 ||
      used > 1024 ||
      !/^\d+$/.test(key) ||
      index >= used ||
      types.length !== used
    )
      return;
    const type = types[index];
    return Number.isSafeInteger(type) && type > 0 ? type : undefined;
  } catch {
    // Type provenance can be unavailable even when the current global pose is valid.
    return;
  }
}

export function embeddedC3DPlate(root: H5Node, key: string): ForcePlatform['c3dSource'] {
  if (!group(root, 'FORCE_PLATFORM')) return;
  try {
    const used = numeric(root, 'FORCE_PLATFORM/USED')[0];
    const index = Number(key);
    if (!Number.isInteger(used) || used < 1 || used > 1024 || !/^\d+$/.test(key) || index >= used)
      throw new Error('original plate identity is unavailable');
    const units = group(root, 'POINT/UNITS')?.attrs?.value.value;
    const text = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    if (String(text(units)).trim().toLowerCase() !== 'mm')
      throw new Error('original point units must be mm for channel reuse');
    const forceUnits = group(root, 'FORCE_PLATFORM/UNITS')?.attrs?.value.value;
    if (forceUnits !== undefined && String(text(forceUnits)).trim().toLowerCase() !== 'n')
      throw new Error('original force units must be N for channel reuse');
    const type = numeric(root, 'FORCE_PLATFORM/TYPE', [used])[index];
    if (type !== 2 && type !== 3 && type !== 4)
      throw new Error('original plate type is unsupported');
    const channelShape = group(root, 'FORCE_PLATFORM/CHANNEL')?.attrs?.value.shape;
    const stride = channelShape?.[0];
    if (stride !== 6 && stride !== 8)
      throw new Error('invalid original channel mapping dimensions');
    if (type === 3 && stride !== 8) throw new Error('TYPE-3 requires eight channels');
    const rawChannels = numeric(root, 'FORCE_PLATFORM/CHANNEL', [stride, used]);
    const channels = Array.from(
      { length: type === 3 ? 8 : 6 },
      (_, c) => rawChannels[c * used + index] - 1,
    );
    if (
      channels.some((c) => !Number.isSafeInteger(c) || c < 0) ||
      new Set(channels).size !== channels.length
    )
      throw new Error('invalid original analog channel identities');
    const rawCorners = numeric(root, 'FORCE_PLATFORM/CORNERS', [3, 4, used]);
    const corners = Float64Array.from(
      { length: 12 },
      (_, i) => rawCorners[((i % 3) * 4 + Math.floor(i / 3)) * used + index],
    );
    const rawOrigin = numeric(root, 'FORCE_PLATFORM/ORIGIN', [3, used]);
    const origin = Array.from({ length: 3 }, (_, axis) => rawOrigin[axis * used + index]) as Vec3;
    // Match the established C3D convention for origin signs.
    if (origin[2] > 0) for (let axis = 0; axis < 3; axis++) origin[axis] *= -1;
    const definition: C3DPlateDefinition = { type, channels, corners, origin };
    if (type === 4) {
      const matrix = numeric(root, 'FORCE_PLATFORM/CAL_MATRIX', [6, 6, used]);
      definition.calibration = Float64Array.from(
        { length: 36 },
        (_, i) => matrix[((i % 6) * 6 + Math.floor(i / 6)) * used + index],
      );
    }
    if (type === 3 && group(root, 'FORCE_PLATFORM/FPCOPPOLY')) {
      const shape = group(root, 'FORCE_PLATFORM/FPCOPPOLY')?.attrs?.value.shape;
      if (
        shape?.join(',') !== [6, 2, used].join(',') &&
        shape?.join(',') !== [2, 6, used].join(',')
      )
        throw new Error('invalid original COP polynomial dimensions');
      const poly = numeric(root, 'FORCE_PLATFORM/FPCOPPOLY', shape);
      definition.copPolynomial = Float64Array.from(
        { length: 12 },
        (_, i) => poly[(shape[0] === 6 ? (i % 6) * 2 + Math.floor(i / 6) : i) * used + index],
      );
    }
    return { definition };
  } catch (error) {
    return { issue: error instanceof Error ? error.message : 'invalid original C3D definition' };
  }
}

/** Recover the original float32 sample encoding from already-scaled H5 analogs.
 * The writer reverses this encoding before storing samples, so scaling runs once. */
export function embeddedC3DAnalogEncoding(root: H5Node): C3DAnalogEncoding | undefined {
  if (!group(root, 'ANALOG')) return;
  try {
    const used = numeric(root, 'ANALOG/USED')[0];
    if (!Number.isInteger(used) || used < 1 || used > 65535) return;
    const general = numeric(root, 'ANALOG/GEN_SCALE')[0];
    const scale = numeric(root, 'ANALOG/SCALE', [used]).map((s) => s * general);
    const offset = numeric(root, 'ANALOG/OFFSET', [used]);
    if (
      scale.some((s) => !s || Math.fround(s) !== s) ||
      offset.some((o) => !Number.isInteger(o) || o < -32768 || o > 32767)
    )
      return;
    return { scale: Float64Array.from(scale), offset: Float64Array.from(offset) };
  } catch {
    return;
  }
}

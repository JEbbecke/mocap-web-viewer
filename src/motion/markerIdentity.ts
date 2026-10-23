import type { MotionData } from './types';

export const markerSourceId = (data: MotionData, index: number) =>
  data.markers.sourceIndices?.[index] ?? index;
export const markerSourceIds = (data: MotionData) =>
  data.markers.sourceIndices ?? data.markers.labels.map((_, index) => index);
export const markerIndex = (data: MotionData, id: number) =>
  data.markers.sourceIndices
    ? data.markers.sourceIndices.indexOf(id)
    : Number.isInteger(id) && id >= 0 && id < data.markers.labels.length
      ? id
      : -1;

/** Same-format writers must receive an ordered subset of immutable source columns. */
export function validateMarkerSubset(indices: number[], count: number) {
  if (
    !indices.length ||
    indices.some(
      (id, i) =>
        !Number.isSafeInteger(id) || id < 0 || id >= count || (i > 0 && id <= indices[i - 1]),
    )
  )
    throw new Error(
      'Marker selection must retain at least one source column in its original order.',
    );
}

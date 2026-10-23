import type { MotionData } from './types';
import type { EditCommand } from './history';
import { validateLabel } from './labelValidation';
import { markerIndex, markerSourceId } from './markerIdentity';

export function validateMarkerLabel(data: MotionData, marker: number, input: string) {
  return validateLabel(data.markers.labels, marker, input, data.source.format, 'marker');
}

/** Capture immutable source identity; the current array position may change on deletion. */
export function renameMarkerCommand(
  data: MotionData,
  marker: number,
  input: string,
): EditCommand<MotionData> | null {
  const label = validateMarkerLabel(data, marker, input);
  const oldLabel = data.markers.labels[marker];
  const id = markerSourceId(data, marker);
  if (label === oldLabel) return null;
  const editedBefore = data.source.labelsEdited;
  const memberships = data.rigidBodies?.map((body) =>
    body.markers.flatMap((name, index) => (name === oldLabel ? [index] : [])),
  );
  const change = (current: MotionData, value: string, edited: boolean | undefined): MotionData => {
    const labels = [...current.markers.labels];
    const index = markerIndex(current, id);
    if (index < 0) throw new Error('Marker no longer exists.');
    labels[index] = value;
    return {
      ...current,
      source: { ...current.source, labelsEdited: edited },
      markers: {
        ...current.markers,
        labels,
        connectionLabels: current.markers.connectionLabels ?? current.markers.labels,
      },
      ...(memberships
        ? {
            rigidBodies: current.rigidBodies?.map((body, index) => ({
              ...body,
              markers: body.markers.map((name, member) =>
                memberships[index].includes(member) ? value : name,
              ),
            })),
          }
        : {}),
    };
  };
  return {
    description: `Rename ${oldLabel} to ${label}`,
    apply: (current) => change(current, label, true),
    revert: (current) => change(current, oldLabel, editedBefore),
  };
}

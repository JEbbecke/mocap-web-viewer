import type { MotionData } from './types';
import type { EditCommand } from './history';
import { validateLabel } from './labelValidation';

export function validateMarkerLabel(data: MotionData, marker: number, input: string) {
  return validateLabel(data.markers.labels, marker, input, data.source.format, 'marker');
}

/** Marker index is the stable source-column identity: edits/crops never reorder columns. */
export function renameMarkerCommand(
  data: MotionData,
  marker: number,
  input: string,
): EditCommand<MotionData> | null {
  const label = validateMarkerLabel(data, marker, input);
  const oldLabel = data.markers.labels[marker];
  if (label === oldLabel) return null;
  const editedBefore = data.source.labelsEdited;
  const change = (current: MotionData, value: string, edited: boolean | undefined): MotionData => {
    const labels = [...current.markers.labels];
    labels[marker] = value;
    return {
      ...current,
      source: { ...current.source, labelsEdited: edited },
      markers: {
        ...current.markers,
        labels,
        connectionLabels: current.markers.connectionLabels ?? current.markers.labels,
      },
    };
  };
  return {
    description: `Rename ${oldLabel} to ${label}`,
    apply: (current) => change(current, label, true),
    revert: (current) => change(current, oldLabel, editedBefore),
  };
}

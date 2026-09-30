import type { MotionData } from './types';
import type { EditCommand } from './history';
import { validateLabel } from './labelValidation';

/** Channel indices identify source columns; names never determine sample/force mapping. */
export function renameAnalogCommand(
  data: MotionData,
  channel: number,
  input: string,
): EditCommand<MotionData> | null {
  const label = validateLabel(
    data.analogs.map((a) => a.name),
    channel,
    input,
    data.source.format,
    'analog channel',
  );
  const oldLabel = data.analogs[channel].name;
  if (label === oldLabel) return null;
  const editedBefore = data.source.analogLabelsEdited;
  const change = (current: MotionData, name: string, edited: boolean | undefined): MotionData => ({
    ...current,
    source: { ...current.source, analogLabelsEdited: edited },
    analogs: current.analogs.map((a, i) => (i === channel ? { ...a, name } : a)),
  });
  return {
    description: `Rename analog ${oldLabel} to ${label}`,
    apply: (current) => change(current, label, true),
    revert: (current) => change(current, oldLabel, editedBefore),
  };
}

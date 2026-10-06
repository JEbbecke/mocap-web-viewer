import type * as H5 from 'h5wasm';
import type { MotionData } from '../motion/types';
import { parseDataLabelKey } from '../motion/dataLabels';

/** Resolve UI indices against imported source identities, never mutable names. */
export function h5LabelUpdates(
  input: H5.File,
  motion: MotionData,
  edits: Record<string, string> = {},
  markers?: string[],
  analogs?: string[],
) {
  const updates = new Map<string, Record<string, string | string[]>>();
  for (const [kind, labels] of [
    ['POINT', markers],
    ['ANALOG', analogs],
  ] as const) {
    if (!labels) continue;
    const path = `/MetaData/C3DParameters/${kind}/LABELS`;
    const group = input.get(path) as H5.Group | null;
    const original = group?.attrs.value?.value;
    if (Array.isArray(original) && original.length === labels.length)
      updates.set(path, { value: [...labels] });
  }
  const setName = (path: string | undefined, name: string) => {
    if (!path || !input.get(path)) throw new Error('Label source group no longer exists.');
    updates.set('/' + path, { Name: name });
  };
  const setLabel = (path: string, index: number | undefined, name: string) => {
    const group = input.get(path) as H5.Group | null;
    const count = (group?.get('Data') as H5.Dataset | null)?.shape?.[0];
    if (index === undefined || count === undefined || index < 0 || index >= count)
      throw new Error('Label source row no longer exists.');
    const attrs = updates.get('/' + path) ?? {};
    const raw = group!.attrs.Labels?.value;
    const stored = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const labels =
      (attrs.Labels as string[] | undefined) ??
      Array.from({ length: count }, (_, i) =>
        stored.length === count && typeof stored[i] === 'string'
          ? (stored[i] as string)
          : `Variable ${i + 1} (unlabelled)`,
      );
    labels[index] = name;
    updates.set('/' + path, { ...attrs, Labels: labels });
  };
  for (const [key, name] of Object.entries(edits)) {
    if (!name.trim() || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid data label.');
    const { kind, index } = parseDataLabelKey(key);
    if (kind === 'plate') setName(motion.forcePlatforms[index]?.sourcePath, name);
    else if (kind === 'body') setName(motion.rigidBodies?.[index]?.sourcePath, name);
    else if (kind === 'signal') {
      const signal = motion.signals?.[index];
      if (!signal || !['EMG', 'IKResults', 'IDResults'].includes(signal.group))
        throw new Error('Unsupported signal label target.');
      setLabel(signal.sourcePath ?? signal.group, signal.sourceIndex, name);
    } else {
      if (name.toLowerCase() === 'time')
        throw new Error('Time is reserved for the model time row.');
      setLabel(
        kind === 'ik' ? 'IKResults' : 'IDResults',
        motion.source.info?.modelResults?.[kind]?.entries?.[index]?.sourceIndex,
        name,
      );
    }
  }
  return updates;
}

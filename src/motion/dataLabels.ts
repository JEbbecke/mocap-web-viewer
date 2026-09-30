import type { MotionData } from './types';
import type { EditCommand } from './history';
import { validateLabel } from './labelValidation';

export type DataLabelKind = 'plate' | 'body' | 'signal' | 'ik' | 'id';
export interface DataLabelTarget {
  kind: DataLabelKind;
  index: number;
}
export const dataLabelKey = ({ kind, index }: DataLabelTarget) => `${kind}:${index}`;
export function parseDataLabelKey(key: string): DataLabelTarget {
  const match = /^(plate|body|signal|ik|id):(\d+)$/.exec(key);
  if (!match) throw new Error('Unknown data label target.');
  return { kind: match[1] as DataLabelKind, index: Number(match[2]) };
}
export function dataLabelNames(data: MotionData, kind: DataLabelKind) {
  if (kind === 'plate') return data.forcePlatforms.map((p) => p.name);
  if (kind === 'body') return (data.rigidBodies ?? []).map((b) => b.name);
  if (kind === 'signal') return (data.signals ?? []).map((s) => s.name);
  return (data.source.info?.modelResults?.[kind]?.entries ?? []).map((e) => e.name);
}
export function renameDataCommand(
  data: MotionData,
  target: DataLabelTarget,
  input: string,
): EditCommand<MotionData> | null {
  const { kind, index } = target;
  const names = dataLabelNames(data, kind);
  // Named signals have separate namespaces (EMG, IK, ID, rigid bodies).
  const group = kind === 'signal' ? data.signals?.[index]?.group : undefined;
  const scoped = names.map((name, i) =>
    kind === 'signal' && data.signals?.[i]?.group !== group ? '' : name,
  );
  const noun = {
    plate: 'force platform',
    body: 'rigid body',
    signal: 'signal',
    ik: 'IK variable',
    id: 'ID variable',
  }[kind];
  const label = validateLabel(scoped, index, input, data.source.format, noun);
  if (
    (kind === 'ik' || kind === 'id' || group === 'IKResults' || group === 'IDResults') &&
    label.toLowerCase() === 'time'
  )
    throw new Error('Time is reserved for the model time row.');
  const oldLabel = names[index];
  if (oldLabel === label) return null;
  const key = dataLabelKey(target),
    oldOverride = data.source.dataLabels?.[key];
  const change = (current: MotionData, name: string, override: string | undefined): MotionData => {
    const dataLabels = { ...current.source.dataLabels };
    if (override === undefined) delete dataLabels[key];
    else dataLabels[key] = override;
    const next = { ...current, source: { ...current.source, dataLabels } };
    if (kind === 'plate')
      next.forcePlatforms = current.forcePlatforms.map((p, i) =>
        i === index ? { ...p, name } : p,
      );
    else if (kind === 'body') {
      next.rigidBodies = current.rigidBodies!.map((b, i) => (i === index ? { ...b, name } : b));
      const signalIndex = (current.signals ?? []).flatMap((s, i) =>
        s.group === 'RigidBodies' ? [i] : [],
      )[index];
      next.signals = current.signals?.map((s, i) => (i === signalIndex ? { ...s, name } : s));
    } else if (kind === 'signal')
      next.signals = current.signals!.map((s, i) => (i === index ? { ...s, name } : s));
    else {
      const info = current.source.info!,
        result = info.modelResults![kind]!;
      next.source.info = {
        ...info,
        modelResults: {
          ...info.modelResults,
          [kind]: {
            ...result,
            entries: result.entries!.map((e, i) => (i === index ? { ...e, name } : e)),
          },
        },
      };
    }
    return next;
  };
  return {
    description: `Rename ${noun} ${oldLabel} to ${label}`,
    apply: (current) => change(current, label, label),
    revert: (current) => change(current, oldLabel, oldOverride),
  };
}

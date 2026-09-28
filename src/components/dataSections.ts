import type { MotionData } from '../motion/types';
import { metadataText } from '../motion/metadata';

export interface DataEntry {
  id: string;
  name: string;
  detail?: string;
  marker?: number;
  plot?: string;
  time?: number;
}
export interface DataSection {
  name: string;
  entries: DataEntry[];
  note?: string;
}
const detail = (unit?: string, rate?: number) =>
  [metadataText(unit), rate && Number.isFinite(rate) && rate > 0 ? `${rate} Hz` : undefined]
    .filter(Boolean)
    .join(' · ');

/** References and small display strings only; never copy numerical signal arrays. */
export function dataSections(data: MotionData): DataSection[] {
  const signals = data.signals ?? [];
  const bodySignals = signals.flatMap((s, i) => (s.group === 'RigidBodies' ? [i] : []));
  const named = (group: string): DataEntry[] =>
    signals.flatMap((s, i) =>
      s.group === group
        ? [
            {
              id: `signal:${i}`,
              name: s.name,
              detail: detail(s.unit, s.signal.rate),
              plot: `signal:${i}`,
            },
          ]
        : [],
    );
  const models = (key: 'ik' | 'id', group: string) => {
    const parsed = named(group).filter((s) => s.name.trim().toLowerCase() !== 'time');
    return parsed.length
      ? { entries: parsed }
      : {
          entries: (data.source.info?.modelResults?.[key]?.entries ?? []).map((s, i) => ({
            id: `${key}:${i}`,
            name: s.name,
            detail: detail(s.unit, s.rate),
          })),
          note: 'Variable metadata only; model signals are not plotted.',
        };
  };
  return [
    {
      name: 'Markers',
      entries: data.markers.labels.map((name, marker) => ({
        id: `marker:${marker}`,
        name,
        marker,
      })),
    },
    {
      name: 'Analog channels',
      entries: data.analogs.map((s, i) => ({
        id: `analog:${i}`,
        name: s.name,
        detail: detail(s.unit, s.signal.rate),
        plot: `analog:${i}`,
      })),
    },
    {
      name: 'Force platforms',
      entries: data.forcePlatforms.map((s, i) => ({
        id: `plate:${i}`,
        name: s.name || `Plate ${i + 1}`,
        detail: detail(undefined, s.force.rate),
        plot: `plate:${i}:force`,
      })),
    },
    {
      name: 'Events',
      entries: data.events.map((s, i) => ({
        id: `event:${i}`,
        name: s.label,
        detail: [`${s.time.toFixed(3)} s`, s.context].filter(Boolean).join(' · '),
        time: s.time,
      })),
    },
    {
      name: 'Rigid bodies',
      entries: (data.rigidBodies ?? []).map((s, i) => {
        // H5 imports body positions into the existing named-signal collection in body order.
        const signalIndex = bodySignals[i];
        return {
          id: `body:${i}`,
          name: s.name,
          detail: detail(data.units.position, s.position.rate),
          ...(signalIndex !== undefined ? { plot: `signal:${signalIndex}` } : {}),
        };
      }),
    },
    {
      name: 'EMG channels',
      entries: named('EMG'),
      note: 'Dedicated EMG group; analog channels retain their source grouping.',
    },
    { name: 'IK results', ...models('ik', 'IKResults') },
    { name: 'ID results', ...models('id', 'IDResults') },
  ].filter((s) => s.entries.length);
}

export function filterDataSections(sections: DataSection[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return sections.map((s) => ({ ...s, total: s.entries.length }));
  return sections
    .map((s) => ({
      ...s,
      total: s.entries.length,
      entries: s.entries.filter((e) => e.name.toLowerCase().includes(query)),
    }))
    .filter((s) => s.entries.length);
}

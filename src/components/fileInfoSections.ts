import type { MotionData } from '../motion/types';
import { metadataText, metadataValues, type MetadataValue } from '../motion/metadata';

export interface InfoRow {
  label: string;
  values: string[];
  summary?: string;
}
export interface InfoSection {
  title: string;
  rows: InfoRow[];
}

/** Presentation only. Counts and rates follow current (possibly cropped) data;
 * embedded provenance remains unchanged. No source-schema parsing in React. */
export function fileInfoSections(data: MotionData): InfoSection[] {
  const info = data.source.info;
  const row = (label: string, value: unknown): InfoRow => ({
    label,
    values: metadataValues(value),
  });
  const field = (label: string, value?: MetadataValue): InfoRow => ({
    label,
    values: (value?.values ?? []).flatMap((v) => {
      const text = metadataText(v),
        unit = metadataText(value?.unit);
      return text === undefined ? [] : [unit ? `${text} ${unit}` : text];
    }),
  });
  const timestamp = (value?: string) => value?.replace(/^(\d{4}-\d{2}-\d{2})T(?=\d{2}:)/, '$1 ');
  const timestampField = (label: string, value?: MetadataValue) =>
    field(label, value && { ...value, values: value.values.map((v) => timestamp(v)!) });
  const rates = (values: number[]) =>
    [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
  const analogRates = rates(data.analogs.map((a) => a.signal.rate));
  const forceRates = rates(data.forcePlatforms.map((p) => p.force.rate));
  const rateText = (values: number[]) => (values.length ? `${values.join(', ')} Hz` : undefined);
  const rateRows =
    analogRates.length && analogRates.join(',') === forceRates.join(',')
      ? [row('Analog / force rate', rateText(analogRates))]
      : [row('Analog rate', rateText(analogRates)), row('Force rate', rateText(forceRates))];
  const types = new Map<number, number>();
  for (const type of info?.platformTypes ?? []) types.set(type, (types.get(type) ?? 0) + 1);
  const typeText = [...types]
    .sort(([a], [b]) => a - b)
    .map(([type, count]) => (types.size === 1 ? `Type ${type}` : `Type ${type} × ${count}`))
    .join(', ');
  const bodies = data.rigidBodies ?? [];
  const bodyNames = bodies.flatMap((b) => metadataValues(b.name));
  const bodyRow =
    bodyNames.length > 3
      ? { label: 'Rigid bodies', summary: `${bodies.length} — names`, values: bodyNames }
      : row(
          'Rigid bodies',
          bodies.length
            ? `${bodies.length}${bodyNames.length ? ` — ${bodyNames.join(', ')}` : ''}`
            : undefined,
        );
  const emgCount =
    info?.emgChannels ?? (data.signals?.filter((s) => s.group === 'EMG').length || undefined);
  const resultText = (result?: { variables?: number }) =>
    result
      ? result.variables === undefined
        ? 'Present'
        : `${result.variables} ${result.variables === 1 ? 'variable' : 'variables'}`
      : undefined;
  const subject = info?.subject,
    provenance = info?.provenance;
  const sections: InfoSection[] = [
    {
      title: 'File & Recording',
      rows: [
        row('File', data.name),
        row('Format', data.source.format),
        row('Date', timestamp(info?.created)),
        row('Frames', data.timeline.frameCount),
        row('Duration', `${data.timeline.duration.toFixed(3)} s`),
        row('Source first frame', data.timeline.firstFrame),
      ],
    },
    {
      title: 'Acquisition',
      rows: [
        row('Point rate', `${data.timeline.rate} Hz`),
        ...rateRows,
        row('Source position unit', data.source.originalPositionUnit),
        row('Coordinate system', info?.coordinateSystem),
        row(types.size > 1 ? 'Force platform types' : 'Force platform type', typeText),
        row('Manufacturer', info?.manufacturer),
        row('Acquisition software', info?.software),
      ],
    },
    {
      title: 'Data',
      rows: [
        row('Markers', data.markers.labels.length),
        row('Analog channels', data.analogs.length),
        row('Force platforms', data.forcePlatforms.length),
        row('Events', data.events.length),
        bodyRow,
        row('EMG channels', emgCount),
        row('IK results', resultText(info?.modelResults?.ik)),
        row('ID results', resultText(info?.modelResults?.id)),
      ],
    },
    {
      title: 'Subject & Trial',
      rows: [
        field('Subject ID', subject?.id),
        field('Subject name', subject?.name),
        field('Age', subject?.age),
        field('Sex', subject?.sex),
        field('Body height', subject?.height),
        field('Body mass', subject?.mass),
        field('Condition', subject?.condition),
      ],
    },
    {
      title: 'Project & Provenance',
      rows: [
        field('Project', provenance?.project),
        field('Project PI', provenance?.projectPI),
        field('Original files', provenance?.originalFiles),
        field('Source path', provenance?.sourcePath),
        timestampField('Created local', provenance?.createdLocal),
        timestampField('Created UTC', provenance?.createdUTC),
        timestampField('Last updated', provenance?.lastUpdated),
      ],
    },
    {
      title: 'Location',
      rows: [
        field('Latitude', info?.location?.latitude),
        field('Longitude', info?.location?.longitude),
      ],
    },
  ];
  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => r.values.length) }))
    .filter((s) => s.rows.length);
}

import type { MotionData } from '../motion/types';
import { metadataValues, type MetadataValue } from '../motion/metadata';
import {
  metadataFieldValues,
  metadataTimestamp,
  sameTimestampInstant,
  sourceBasename,
} from './metadataDisplay';
import {
  fileSizeText,
  timestampText,
  timestampTooltip,
  parseFileTimestamp,
  type FileTimestamp,
} from '../motion/fileMetadata';

export interface InfoRow {
  label: string;
  values: string[];
  summary?: string;
  tooltip?: string;
  /** Exact values remain copyable; only the initial presentation is shortened. */
  displayValues?: string[];
  kind?: 'timestamp' | 'path';
  detailLabels?: string[];
  group?: string;
}
export interface InfoSection {
  title: string;
  rows: InfoRow[];
  notes?: Record<string, string>;
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
    values: metadataFieldValues(value),
  });
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
            : 0,
        );
  const emgCount = info?.emgChannels ?? data.signals?.filter((s) => s.group === 'EMG').length ?? 0;
  const resultText = (kind: 'ik' | 'id') => {
    const result = info?.modelResults?.[kind];
    const named =
      data.signals?.filter(
        (s) =>
          s.group === (kind === 'ik' ? 'IKResults' : 'IDResults') &&
          s.name.trim().toLowerCase() !== 'time',
      ).length ?? 0;
    return named
      ? `${named} ${named === 1 ? 'variable' : 'variables'}`
      : result
        ? result.variables === undefined
          ? 'Present'
          : `${result.variables} ${result.variables === 1 ? 'variable' : 'variables'}`
        : '0 variables';
  };
  const subject = info?.subject,
    provenance = info?.provenance;
  const filesystem = data.source.filesystem;
  const timestamps = info?.fileTimestamps;
  const created =
    timestamps?.created ?? parseFileTimestamp(provenance?.createdLocal?.values ?? info?.created);
  const createdUTC = timestamps?.createdUTC ?? parseFileTimestamp(provenance?.createdUTC?.values);
  const modified = timestamps?.modified ?? parseFileTimestamp(provenance?.lastUpdated?.values);
  const timestampRow = (label: string, value?: FileTimestamp): InfoRow => ({
    label,
    kind: 'timestamp',
    detailLabels: [
      value?.status === 'valid' && value.timezone === 'utc'
        ? 'UTC timestamp'
        : 'Original timestamp',
    ],
    values: [value && value.status !== 'missing' ? value.raw : 'Not available'],
    displayValues: [
      value?.status === 'valid' ? metadataTimestamp(value.raw)! : timestampText(value),
    ],
    tooltip: timestampTooltip(value),
  });
  const available = (value?: FileTimestamp) => !!value && value.status !== 'missing';
  const embeddedRows: InfoRow[] = [];
  if (available(created) && available(createdUTC)) {
    if (sameTimestampInstant(created, createdUTC)) {
      const primary = timestampRow('Created', created);
      primary.values.push(createdUTC.raw);
      primary.detailLabels = ['Original/local timestamp', 'UTC timestamp'];
      primary.tooltip = `${timestampTooltip(created)}\nUTC representation:\n${timestampTooltip(createdUTC)}`;
      embeddedRows.push(primary);
    } else {
      embeddedRows.push(
        timestampRow('Created (local/original)', created),
        timestampRow('Created (UTC field)', createdUTC),
      );
    }
  } else if (available(created) || available(createdUTC)) {
    embeddedRows.push(timestampRow('Created', available(created) ? created : createdUTC));
  }
  if (available(modified)) embeddedRows.push(timestampRow('Last modified', modified));
  if (!embeddedRows.length) embeddedRows.push(row('Created / Last modified', 'Not available'));
  else {
    if (!available(created) && !available(createdUTC))
      embeddedRows.unshift(row('Created', 'Not available'));
    if (!available(modified)) embeddedRows.push(row('Last modified', 'Not available'));
  }
  // In H5, info.created and provenance date fields are parser aliases of these attributes.
  // JE_METADATA:CREATED can coexist independently with CREATED_LOCAL; keep that source explicit.
  if (data.source.format === 'C3D' && info?.created && provenance?.createdLocal) {
    embeddedRows.push(
      timestampRow(
        'Created (JE_METADATA:CREATED)',
        parseFileTimestamp(info.created, 'JE_METADATA v1: CREATED'),
      ),
    );
  }
  const pathRow = (label: string, value?: MetadataValue): InfoRow => {
    const exact = field(label, value);
    return {
      ...exact,
      kind: 'path',
      displayValues:
        exact.values.length > 3
          ? [
              `${sourceBasename(exact.values[0]) || exact.values[0]} + ${exact.values.length - 1} more`,
            ]
          : exact.values.map((path) => sourceBasename(path) || path),
      tooltip: exact.values.join('\n'),
    };
  };
  const originalFiles = pathRow('Original files', provenance?.originalFiles);
  const sourcePath = pathRow('Source path', provenance?.sourcePath);
  const originalPath = originalFiles.values[0];
  // Both provenance fields identify the same single file only when their complete,
  // absolute paths match exactly. Basenames/relative paths cannot establish identity.
  const sameSource =
    originalFiles.values.length === 1 &&
    sourcePath.values.length === 1 &&
    originalPath === sourcePath.values[0] &&
    /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(originalPath) &&
    !!sourceBasename(originalPath);
  const provenancePaths: InfoRow[] = sameSource
    ? [
        {
          label: 'Original source',
          kind: 'path',
          values: [originalPath, sourcePath.values[0]],
          displayValues: [sourceBasename(originalPath)],
          detailLabels: ['Original files', 'Source path'],
          tooltip: `Original files:\n${originalPath}\nSource path:\n${sourcePath.values[0]}`,
        },
      ]
    : [originalFiles, sourcePath];
  const grouped = (name: string, rows: InfoRow[]) => rows.map((r) => ({ ...r, group: name }));
  const origin =
    filesystem?.origin === 'local'
      ? 'Local file / File API'
      : filesystem?.origin === 'bundled-demo'
        ? 'Bundled demo / fetched bytes'
        : 'Not available';
  const filesystemRows = available(filesystem?.modifiedAt)
    ? [row('Created', 'Not available'), timestampRow('Last modified', filesystem?.modifiedAt)]
    : [row('Created / Last modified', 'Not available')];
  const sections: InfoSection[] = [
    {
      title: 'File & Recording',
      rows: [
        row('File name', sourceBasename(filesystem?.name ?? data.name)),
        {
          label: 'File size',
          values: [fileSizeText(filesystem?.sizeBytes)],
          tooltip: filesystem ? `${filesystem.sizeBytes.toLocaleString('en-US')} bytes` : undefined,
        },
        row('Format', data.source.format),
        row('Frames', data.timeline.frameCount),
        row('Duration', `${data.timeline.duration.toFixed(3)} s`),
        row('Source first frame', data.timeline.firstFrame),
        ...grouped('Subject & Trial', [
          field('Subject ID', subject?.id),
          field('Subject group', subject?.group),
          field('Subject name', subject?.name),
          field('Age', subject?.age),
          field('Sex', subject?.sex),
          field('Body height', subject?.height),
          field('Body mass', subject?.mass),
          field('Condition', subject?.condition),
        ]),
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
        ...grouped('Location', [
          field('Latitude', info?.location?.latitude),
          field('Longitude', info?.location?.longitude),
        ]),
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
        row('IK results', resultText('ik')),
        row('ID results', resultText('id')),
      ],
    },
    {
      title: 'Dates & Provenance',
      notes: { 'Filesystem metadata': `Source: ${origin}` },
      rows: [
        ...grouped('Embedded file metadata', embeddedRows),
        ...grouped('Filesystem metadata', filesystemRows),
        ...grouped('Provenance', [
          field('Project', provenance?.project),
          field('Project PI', provenance?.projectPI),
          ...provenancePaths,
        ]),
      ],
    },
  ];
  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => r.values.length) }))
    .filter((s) => s.rows.length);
}

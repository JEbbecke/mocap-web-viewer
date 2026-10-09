import { independentModelMessage, type ModelView } from '../motion/modelTiming';
import type { MotionData, Series } from '../motion/types';
import { eventSourceFrame } from '../motion/events';
import { metadataText } from '../motion/metadata';
import { fileInfoSections } from '../components/fileInfoSections';

export type Cell = string | number | boolean | undefined;
export interface Column {
  name: string;
  numeric?: boolean;
}
export interface Dataset {
  id: string;
  name: string;
  path: string[];
  columns: Column[];
  count: number;
  cell: (row: number, column: number) => Cell;
  facts: [string, string][];
  time?: (row: number) => number;
  current?: (time: number) => number;
  seek?: (row: number) => number;
  model?: ModelView & { kind: 'ik' | 'id'; sourceIndex: number; unit: string; aligned?: boolean };
}
const col = (name: string, numeric = true): Column => ({ name, numeric });
const xyz = ['X', 'Y', 'Z'];
const matrix = Array.from({ length: 9 }, (_, i) => `R${Math.floor(i / 3) + 1}${(i % 3) + 1} [1]`);
export const sampleTime = (s: Series, i: number) => s.times?.[i] ?? s.startTime + i / s.rate;

/** Nearest physical sample, with no extrapolation outside the represented clock. */
export function sampleAt(s: Series, time: number) {
  const n = s.values.length / s.components;
  if (!n || time < sampleTime(s, 0) - 1e-9 || time > sampleTime(s, n - 1) + 1e-9) return -1;
  if (!s.times) return Math.max(0, Math.min(n - 1, Math.round((time - s.startTime) * s.rate)));
  let a = 0,
    b = n;
  while (a < b) {
    const mid = Math.floor((a + b) / 2);
    if (s.times[mid] < time) a = mid + 1;
    else b = mid;
  }
  return a > 0 && (a === n || time - s.times[a - 1] <= s.times[a] - time) ? a - 1 : a;
}
export function seriesDataset(
  id: string,
  name: string,
  path: string[],
  s: Series,
  unit: string,
  labels?: string[],
  isStatic = false,
): Dataset {
  const count = s.values.length / s.components;
  return {
    id,
    name,
    path,
    count,
    columns: [
      col('Sample (0-based)'),
      ...(!isStatic ? [col('Time [s]')] : []),
      ...Array.from({ length: s.components }, (_, i) =>
        col(
          labels?.[i] ??
            `${s.components === 1 ? 'Value' : (xyz[i] ?? `Component ${i + 1}`)} [${unit}]`,
        ),
      ),
    ],
    cell: (r, c) =>
      c === 0
        ? r
        : !isStatic && c === 1
          ? sampleTime(s, r)
          : s.values[r * s.components + c - (isStatic ? 1 : 2)],
    facts: [
      ['Unit', unit],
      ['Samples', String(count)],
      [
        'Clock',
        isStatic
          ? 'Static; no time axis'
          : s.times
            ? 'Explicit timestamps'
            : 'Regular sample clock',
      ],
      ...(!isStatic ? [['Nominal rate', `${s.rate} Hz`] as [string, string]] : []),
    ],
    ...(!isStatic
      ? { time: (r: number) => sampleTime(s, r), current: (t: number) => sampleAt(s, t) }
      : {}),
  };
}
export function modelUnit(data: MotionData, kind: 'ik' | 'id', index: number) {
  const result = data.source.info?.modelResults?.[kind],
    entry = result?.entries?.[index];
  return (
    metadataText(entry?.unit) ??
    (kind === 'ik' && entry?.coordinateType === 'rotation' && result?.inDegrees !== undefined
      ? result.inDegrees
        ? 'deg'
        : 'rad'
      : 'unknown')
  );
}

/** Small catalogs and row accessors over existing buffers; no sample materialization. */
export function explorerDatasets(data: MotionData): Dataset[] {
  const datasets: Dataset[] = [];
  data.markers.labels.forEach((name, m) => {
    const stride = data.markers.labels.length,
      q = data.markers.quality;
    const optional: [Column, (r: number) => Cell][] = [];
    if (data.markers.residuals)
      optional.push([col('Residual [mm]'), (r) => data.markers.residuals![r * stride + m]]);
    if (q?.type) optional.push([col('Source quality type'), (r) => q.type![r * stride + m]]);
    if (q?.virtual) optional.push([col('Virtual', false), () => !!q.virtual![m]]);
    if (q?.cameraMasks)
      optional.push([
        col('Camera mask', false),
        (r) =>
          q.cameraMasksKnown?.[m] === 0
            ? 'unknown'
            : Array.from(
                { length: q.cameraCount },
                (_, c) => q.cameraMasks![(r * stride + m) * q.cameraCount + c],
              ).join(', '),
      ]);
    datasets.push({
      id: `marker:${m}`,
      name,
      path: ['Trajectories'],
      count: data.timeline.frameCount,
      columns: [
        col('Index (0-based)'),
        col('Current frame (1-based)'),
        col('Source frame'),
        col('Time [s]'),
        ...xyz.map((a) => col(`${a} [mm]`)),
        col('Valid', false),
        ...optional.map((o) => o[0]),
      ],
      cell: (r, c) =>
        c === 0
          ? r
          : c === 1
            ? r + 1
            : c === 2
              ? eventSourceFrame(data, r / data.timeline.rate)
              : c === 3
                ? r / data.timeline.rate
                : c < 7
                  ? data.markers.positions[(r * stride + m) * 3 + c - 4]
                  : c === 7
                    ? !!data.markers.valid[r * stride + m]
                    : optional[c - 8][1](r),
      facts: [
        ['Position / residual unit', 'mm'],
        ['Point rate', `${data.timeline.rate} Hz`],
        ['Frames', String(data.timeline.frameCount)],
        ['Source frames', data.source.format === 'C3D' ? 'C3D one-based' : 'H5 zero-based'],
        [
          'Invalid samples',
          'Validity is shown separately; stored coordinates and residuals are retained.',
        ],
      ],
      time: (r) => r / data.timeline.rate,
      current: (t) => Math.round(t * data.timeline.rate),
    });
  });
  data.analogs.forEach((a, i) =>
    datasets.push(
      seriesDataset(`analog:${i}`, a.name, ['Analog'], a.signal, metadataText(a.unit) ?? 'unknown'),
    ),
  );
  data.forcePlatforms.forEach((p, i) => {
    const path = ['Force Platforms', p.name || `Plate ${i + 1}`];
    const facts: [string, string][] = [
      ['Name', path[1]],
      ['Coordinate frame', p.coordinateFrame],
      ['Provenance', p.provenance],
    ];
    const type = data.source.info?.platformTypes?.[p.sourceIndex ?? i];
    if (type !== undefined) facts.push(['Type', String(type)]);
    if (p.origin)
      facts.push(['Sensor origin [mm]', Array.from(p.origin).map(exactCell).join(', ')]);
    const fields: [string, Series | undefined, string, string[] | undefined, boolean?][] = [
      ['Force', p.force, 'N', ['Fx [N]', 'Fy [N]', 'Fz [N]']],
      ['Moment', p.moment, 'Nm', ['Mx [Nm]', 'My [Nm]', 'Mz [Nm]']],
      ['COP', p.cop, 'mm', undefined],
      ['Free moment', p.freeMoment, 'Nm', p.freeMoment?.components === 1 ? ['Tz [Nm]'] : undefined],
      [
        'Corners',
        p.corners,
        'mm',
        Array.from({ length: 12 }, (_, j) => `Corner ${Math.floor(j / 3) + 1} ${xyz[j % 3]} [mm]`),
        p.corners?.values.length === 12,
      ],
      ['Position', p.position, 'mm', undefined, p.position?.values.length === 3],
      ['Rotation matrix', p.rotation, '1', matrix, p.rotation?.values.length === 9],
    ];
    fields.forEach(([field, s, unit, labels, isStatic]) => {
      if (!s) return;
      const d = seriesDataset(
        `plate:${i}:${field}`,
        field,
        ['Corners', 'Position', 'Rotation matrix'].includes(field) ? [...path, 'Geometry'] : path,
        s,
        unit,
        labels,
        isStatic,
      );
      d.facts.push(...facts);
      datasets.push(d);
    });
  });
  if (data.events.length) {
    const fields: [Column, (r: number) => Cell][] = [
      [col('Label', false), (r) => data.events[r].label],
      [col('Time [s]'), (r) => data.events[r].time],
      [col('Current frame (1-based)'), (r) => data.events[r].time * data.timeline.rate + 1],
      [col('Source frame'), (r) => eventSourceFrame(data, data.events[r].time)],
    ];
    for (const [key, label] of [
      ['context', 'Context'],
      ['description', 'Description'],
      ['subject', 'Subject'],
    ] as const)
      if (data.events.some((e) => e[key]))
        fields.push([col(label, false), (r) => data.events[r][key]]);
    if (data.events.some((e) => e.sourceFrame !== undefined))
      fields.push([col('Original source frame (provenance)'), (r) => data.events[r].sourceFrame]);
    for (const [key, label] of [
      ['genericFlag', 'Generic flag'],
      ['iconId', 'Icon ID'],
    ] as const)
      if (data.events.some((e) => e[key] !== undefined))
        fields.push([col(label), (r) => data.events[r][key]]);
    datasets.push({
      id: 'events',
      name: 'Events',
      path: ['Events'],
      count: data.events.length,
      columns: fields.map((f) => f[0]),
      cell: (r, c) => fields[c][1](r),
      facts: [
        ['Time', 'Seconds relative to the current recording'],
        ['Frame', 'Continuous point-frame coordinate; seek rounds to the nearest available frame.'],
      ],
      seek: (r) => data.events[r].time,
    });
  }
  data.rigidBodies?.forEach((b, i) => {
    const path = ['Rigid Bodies', b.name];
    for (const [field, s, unit, labels] of [
      ['Position', b.position, 'mm', undefined],
      ['Rotation matrix', b.rotation, '1', matrix],
    ] as const) {
      if (!s) continue;
      const d = seriesDataset(`body:${i}:${field}`, field, path, s, unit, labels);
      d.facts.push(['Body', b.name], ['Markers', b.markers.join(', ') || 'None']);
      if (b.rotation)
        d.facts.push([
          'Orientation',
          'Row-major rotation matrix; dimensionless, no Euler conversion.',
        ]);
      datasets.push(d);
    }
  });
  data.signals?.forEach((s, i) => {
    const category = { EMG: 'EMG', IKResults: 'IK Results', IDResults: 'ID Results' }[s.group];
    if (!category || s.name.trim().toLowerCase() === 'time') return;
    datasets.push(
      seriesDataset(`signal:${i}`, s.name, [category], s.signal, metadataText(s.unit) ?? 'unknown'),
    );
  });
  for (const kind of ['ik', 'id'] as const) {
    const category = kind === 'ik' ? 'IK Results' : 'ID Results';
    if (datasets.some((d) => d.path[0] === category)) continue;
    const result = data.source.info?.modelResults?.[kind];
    result?.entries?.forEach((entry, i) => {
      const unit = modelUnit(data, kind, i);
      datasets.push({
        id: `${kind}:${i}`,
        name: entry.name,
        path: [category],
        count: result.samples ?? 0,
        columns: [col('Sample (0-based)'), col('Time [s]'), col(`Value [${unit}]`)],
        cell: () => undefined,
        facts: [
          ['Unit', unit],
          ...(entry.rate ? [['Nominal rate', `${entry.rate} Hz`] as [string, string]] : []),
          [
            'Clock',
            result.timeBasis === 'trial-aligned'
              ? 'Aligned with trajectory timeline; cropped with trial.'
              : independentModelMessage,
          ],
          ...(result.inDegrees !== undefined && kind === 'ik'
            ? [
                ['Angular declaration', result.inDegrees ? 'inDegrees=yes' : 'inDegrees=no'] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(entry.coordinateType && !entry.unit
            ? [
                [
                  'Unit basis',
                  `Standard OpenSim ${entry.coordinateType} coordinate convention; translations remain unknown without explicit units.`,
                ] as [string, string],
              ]
            : []),
        ],
        model: {
          kind,
          sourceIndex: entry.sourceIndex ?? i,
          unit,
          aligned: result.timeBasis === 'trial-aligned',
          range: result.sourceRange,
          timeOrigin: result.timeOrigin,
        },
      });
    });
  }
  const sections = fileInfoSections(data);
  // File Info's internal origin is zero-based; detailed source numbering is format-native.
  const first = sections
    .find((s) => s.title === 'File & Recording')
    ?.rows.find((r) => r.label === 'Source first frame');
  if (first) {
    first.label = `Source first frame (${data.source.format === 'C3D' ? 'C3D one-based' : 'H5 zero-based'})`;
    first.values = [String(eventSourceFrame(data, 0))];
  }
  const metadata = sections.map((s) => ({
    name:
      (
        {
          'File & Recording': 'File',
          'Subject & Trial': 'Subject',
          'Project & Provenance': 'Provenance',
        } as Record<string, string>
      )[s.title] ?? s.title,
    rows: s.rows,
  }));
  const provenance = metadata.find((s) => s.name === 'Provenance');
  if (provenance) {
    const rows = provenance.rows.filter((r) => ['Project', 'Project PI'].includes(r.label));
    if (rows.length) metadata.push({ name: 'Project', rows });
    provenance.rows = provenance.rows.filter((r) => !['Project', 'Project PI'].includes(r.label));
  }
  metadata.push({
    name: 'Coordinate system',
    rows: [
      {
        label: 'Scientific units',
        values: ['Position / COP / geometry / residual mm; force N; moment Nm; time s'],
      },
      {
        label: 'Axes',
        values: [
          data.source.info?.coordinateSystem ??
            'Lab XYZ; viewer Z-up. Source axis convention unspecified.',
        ],
      },
    ],
  });
  metadata.push({
    name: 'Schema',
    rows: [
      { label: 'Format', values: [data.source.format] },
      { label: 'H5 layout', values: data.source.h5Layout ? [data.source.h5Layout] : [] },
      { label: 'Event layout', values: data.source.eventSchema ? [data.source.eventSchema] : [] },
    ],
  });
  metadata
    .filter((s) => s.rows.length)
    .forEach((s) => {
      const rows = s.rows.filter((r) => r.values.length);
      datasets.push({
        id: `metadata:${s.name}`,
        name: s.name,
        path: ['Metadata'],
        count: rows.length,
        columns: [col('Field', false), col('Value', false)],
        cell: (r, c) => (c ? rows[r].values.join('\n') : rows[r].label),
        facts: [],
      });
    });
  return [
    ...datasets.filter((d) => d.path[0] === 'Metadata'),
    ...datasets.filter((d) => d.path[0] !== 'Metadata'),
  ];
}
export function filterDatasets(datasets: Dataset[], query: string) {
  const q = query.trim().toLowerCase();
  return q
    ? datasets.filter((d) => [...d.path, d.name].some((n) => n.toLowerCase().includes(q)))
    : datasets;
}
export function exactCell(value: Cell): string {
  return value === undefined
    ? '—'
    : typeof value === 'boolean'
      ? value
        ? 'Yes'
        : 'No'
      : Object.is(value, -0)
        ? '-0'
        : String(value);
}
export function displayCell(value: Cell): string {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
    ? Number(value.toPrecision(12)).toString()
    : exactCell(value);
}
export const ROW_HEIGHT = 32;
export function rowWindow(count: number, scrollTop: number, height: number) {
  const start = Math.min(
    Math.max(0, count - 1),
    Math.max(0, Math.floor((scrollTop - ROW_HEIGHT) / ROW_HEIGHT) - 5),
  );
  return { start, end: Math.min(count, start + Math.ceil(height / ROW_HEIGHT) + 12) };
}
export function copyRows(d: Dataset, start: number, end: number) {
  return [
    d.columns.map((c) => c.name).join('\t'),
    ...Array.from({ length: Math.max(0, end - start) }, (_, i) =>
      d.columns
        .map((_, c) => exactCell(d.cell(start + i, c)).replace(/[\t\r\n]+/g, ' '))
        .join('\t'),
    ),
  ].join('\n');
}

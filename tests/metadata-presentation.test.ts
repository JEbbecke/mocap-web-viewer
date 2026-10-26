import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { parseFileTimestamp, fileProperties } from '../src/motion/fileMetadata';
import {
  metadataTimestamp,
  metadataTimestampParts,
  sameTimestampInstant,
} from '../src/components/metadataDisplay';
import { fileInfoSections } from '../src/components/fileInfoSections';
import { FileInfo } from '../src/components/FileInfo';
import { explorerDatasets, copyRows } from '../src/explorer/datasets';

const fixture = () => {
  const data = parseC3D(physicalFixture(), 'recording.h5');
  data.source.format = 'H5';
  return data;
};
const embedded = (data: ReturnType<typeof fixture>) =>
  fileInfoSections(data)[3].rows.filter((r) => r.group === 'Embedded file metadata');

it.each([
  ['2026-10-08 14:01:31.197201', '08 Oct 2026, 14:01:31'],
  ['2026-10-08 12:01:31.197201+00:00', '08 Oct 2026, 12:01:31 UTC'],
  ['2026-10-08T14:01:31.197201+02:00', '08 Oct 2026, 14:01:31 +02:00'],
  ['2026-10-08', '08 Oct 2026'],
])('shortens %s without assigning or converting a timezone', (raw, expected) => {
  expect(metadataTimestamp(raw)).toBe(expected);
  const [date, time] = expected.split(', ');
  expect(metadataTimestampParts(raw)).toEqual({ date, time });
});

it('groups only provably equivalent offset-aware creation instants at full precision', () => {
  const local = parseFileTimestamp('2026-10-08T14:01:31.197201+02:00');
  const utc = parseFileTimestamp('2026-10-08T12:01:31.197201000Z');
  expect(sameTimestampInstant(local, utc)).toBe(true);
  expect(sameTimestampInstant(parseFileTimestamp('2026-10-08 14:01:31.197201'), utc)).toBe(false);
  expect(sameTimestampInstant(local, parseFileTimestamp('2026-10-08T12:01:31.197202Z'))).toBe(
    false,
  );
  expect(sameTimestampInstant(parseFileTimestamp('2026-10-08T12:01:31.197201-00:00'), utc)).toBe(
    false,
  );
  const data = fixture();
  data.source.info = {
    fileTimestamps: { created: local, createdUTC: utc, modified: parseFileTimestamp(undefined) },
  };
  const before = structuredClone(data.source.info);
  const rows = embedded(data);
  expect(rows.map((r) => r.label)).toEqual(['Created', 'Last modified']);
  expect(rows[0].values).toEqual([
    local.status === 'valid' ? local.raw : '',
    utc.status === 'valid' ? utc.raw : '',
  ]);
  expect(rows[0].displayValues).toEqual(['08 Oct 2026, 14:01:31 +02:00']);
  const html = renderToStaticMarkup(createElement(FileInfo, { data }));
  expect(html).toContain('2026-10-08T12:01:31.197201000Z');
  expect(html).toContain('aria-label="Created details" aria-expanded="false"');
  expect(html).toContain('class="metadata-details"');
  expect(html).toContain('Copy Embedded file metadata: Created (UTC timestamp)');
  expect(html).toContain('<span>08 Oct 2026</span><span>14:01:31 +02:00</span>');
  expect(data.source.info).toEqual(before);
});

it('keeps uncertain local/UTC creation fields and modification dates distinct', () => {
  const data = fixture();
  data.source.info = {
    fileTimestamps: {
      created: parseFileTimestamp('2026-10-02 11:36:33.697784'),
      createdUTC: parseFileTimestamp('2026-10-02 09:36:33.697796+00:00'),
      modified: parseFileTimestamp('2026-10-02 11:40:41.259805'),
    },
  };
  expect(embedded(data).map((r) => r.label)).toEqual([
    'Created (local/original)',
    'Created (UTC field)',
    'Last modified',
  ]);
  expect(embedded(data)[0].tooltip).toContain('Timezone not specified');
});

it('uses four sections, preserves subject/location and source-path concepts, and keeps exact copies', () => {
  const data = fixture();
  const path = 'C:\\original\\very-long-directory\\input.h5';
  data.source.info = {
    subject: { id: { values: ['Subject'] } },
    location: { latitude: { values: ['0'] } },
    provenance: {
      project: { values: ['Project'] },
      originalFiles: { values: [path, 'other.c3d'] },
      sourcePath: { values: [path] },
      createdLocal: { values: ['2026-10-08T14:01:31.197201'] },
    },
  };
  data.source.filesystem = fileProperties(new File(['123'], 'input.h5', { lastModified: 0 }));
  const sections = fileInfoSections(data);
  expect(sections.map((s) => s.title)).toEqual([
    'File & Recording',
    'Acquisition',
    'Data',
    'Dates & Provenance',
  ]);
  const rows = sections.flatMap((s) => s.rows);
  expect(rows.filter((r) => r.label === 'File name')).toHaveLength(1);
  expect(rows.filter((r) => r.label === 'File size')).toHaveLength(1);
  expect(
    rows.some((r) =>
      ['Date', 'File', 'Created local', 'Created UTC', 'Last updated', 'Metadata source'].includes(
        r.label,
      ),
    ),
  ).toBe(false);
  expect(sections[0].rows.find((r) => r.label === 'Subject ID')?.group).toBe('Subject & Trial');
  expect(sections[1].rows.find((r) => r.label === 'Latitude')?.values).toEqual(['0']);
  expect(rows.find((r) => r.label === 'Original files')).toMatchObject({
    values: [path, 'other.c3d'],
    displayValues: ['input.h5', 'other.c3d'],
  });
  expect(rows.find((r) => r.label === 'Source path')).toMatchObject({
    values: [path],
    displayValues: ['input.h5'],
    tooltip: path,
  });
  const table = explorerDatasets(data).find((d) => d.id === 'metadata:Dates & Provenance')!;
  expect(copyRows(table, 0, table.count)).toContain(path);
  expect(copyRows(table, 0, table.count)).toContain('2026-10-08T14:01:31.197201');
  expect(table.columns.map((c) => c.name)).toEqual(['Section', 'Field', 'Value']);
  expect(sections[3].notes?.['Filesystem metadata']).toContain('File API');
});

it('retains every zero-count data category and compact unavailable timestamps for C3D', () => {
  const data = fixture();
  data.source.format = 'C3D';
  data.source.info = {};
  data.markers.labels = [];
  data.analogs = [];
  data.events = [];
  data.forcePlatforms = [];
  const sections = fileInfoSections(data);
  expect(sections[2].rows).toHaveLength(8);
  expect(sections[2].rows.every((r) => r.values[0].startsWith('0'))).toBe(true);
  expect(embedded(data)).toMatchObject([
    { label: 'Created / Last modified', values: ['Not available'] },
  ]);
});

it('keeps long original-file lists compact with every exact path in full-width details', () => {
  const data = fixture();
  const paths = Array.from({ length: 4 }, (_, i) => `C:\\source\\recording-${i}.c3d`);
  data.source.info = { provenance: { originalFiles: { values: paths } } };
  const row = fileInfoSections(data)[3].rows.find((r) => r.label === 'Original files')!;
  expect(row.displayValues).toEqual(['recording-0.c3d + 3 more']);
  expect(row.values).toEqual(paths);
  const html = renderToStaticMarkup(createElement(FileInfo, { data }));
  for (const path of paths) expect(html).toContain(path);
  expect(html).toContain('aria-label="Original files details" aria-expanded="false"');
  expect(html).toContain('Copy Provenance: Original files 4');
  expect(html).not.toContain('aria-label="Created / Last modified details"');
  expect(html).not.toContain('Details +');
  expect(html).toContain('class="metadata-chevron"');
});

it.each(['C:\\source\\input.c3d', '/source/input.c3d', '\\\\server\\share\\input.c3d'])(
  'groups the same complete source path %s while preserving both fields',
  (path) => {
    const data = fixture();
    data.source.info = {
      provenance: { originalFiles: { values: [path] }, sourcePath: { values: [path] } },
    };
    const before = structuredClone(data.source.info);
    const rows = fileInfoSections(data)[3].rows.filter((row) => row.group === 'Provenance');
    expect(rows).toMatchObject([
      {
        label: 'Original source',
        values: [path, path],
        displayValues: ['input.c3d'],
        detailLabels: ['Original files', 'Source path'],
      },
    ]);
    const html = renderToStaticMarkup(createElement(FileInfo, { data }));
    expect(html).toContain('Copy Provenance: Original source (Original files)');
    expect(html).toContain('Copy Provenance: Original source (Source path)');
    const table = explorerDatasets(data).find(
      (dataset) => dataset.id === 'metadata:Dates & Provenance',
    )!;
    expect(table.cell(table.count - 1, 2)).toBe(`${path}\n${path}`);
    // TSV rows flatten embedded newlines; the exact selected cell remains unchanged.
    expect(copyRows(table, 0, table.count)).toContain(`${path} ${path}`);
    expect(data.source.info).toEqual(before);
  },
);

it.each([
  ['input.c3d', 'input.c3d'],
  ['relative/input.c3d', 'relative/input.c3d'],
  ['C:\\original\\input.c3d', 'C:\\converted\\input.c3d'],
  ['/original/input.c3d', '/converted/input.c3d'],
])('keeps ambiguous or different source identities separate: %s / %s', (original, source) => {
  const data = fixture();
  data.source.info = {
    provenance: { originalFiles: { values: [original] }, sourcePath: { values: [source] } },
  };
  expect(
    fileInfoSections(data)[3]
      .rows.filter((row) => row.group === 'Provenance')
      .map((row) => row.label),
  ).toEqual(['Original files', 'Source path']);
});

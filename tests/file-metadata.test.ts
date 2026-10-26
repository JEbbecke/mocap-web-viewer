import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import * as h5 from 'h5wasm/node';
import {
  fileProperties,
  fileSizeText,
  parseFileTimestamp,
  timestampText,
} from '../src/motion/fileMetadata';
import { h5RecordingInfo } from '../src/importers/h5/metadata';
import { parseC3D } from '../src/importers/c3d/importer';
import { c3dRecordingInfo } from '../src/importers/c3d/metadata';
import { readParameters } from '../src/importers/c3d/parameters';
import { c3dMetadataEntries } from '../src/motion/c3dMetadata';
import { fileInfoSections } from '../src/components/fileInfoSections';
import { explorerDatasets } from '../src/explorer/datasets';
import { cropMotionData } from '../src/motion/crop';
import { physicalFixture } from './helpers/c3d';

it.each([
  ['2026-10-02 11:36:33.697784', '2026-10-02 11:36:33.697784', 'unspecified'],
  ['2026-10-02 09:36:33.697796+00:00', '2026-10-02 09:36:33.697796+00:00', 'utc'],
  ['2026-01-02T03:04:05.123456789+05:30', '2026-01-02 03:04:05.123456789+05:30', 'offset'],
  ['2026-01-02T03:04:05-0430', '2026-01-02 03:04:05-04:30', 'offset'],
  ['2026-01-02T03:04:05Z', '2026-01-02 03:04:05Z', 'utc'],
  ['2024-02-29', '2024-02-29', 'unspecified'],
  ['2026-01-02T03:04', '2026-01-02 03:04', 'unspecified'],
])('retains the timestamp semantics and precision of %s', (raw, value, timezone) => {
  expect(parseFileTimestamp(raw, 'test')).toEqual({
    status: 'valid',
    raw,
    value,
    timezone,
    source: 'test',
  });
});

it.each([undefined, null, '', 'Unknown', 'N/A', [], [''], new Float64Array(0)])(
  'recognizes missing timestamps (%j)',
  (raw) => {
    expect(parseFileTimestamp(raw).status).toBe('missing');
    expect(timestampText(parseFileTimestamp(raw))).toBe('Not available');
  },
);
it.each([
  'invalid',
  '2026-02-29',
  '2026-04-31',
  '2026-13-01',
  '2026-01-02T25:00:00',
  '2026-01-02T03:60:00',
  '2026-01-02T03:04:05+24:00',
  '2026-01-02T03:04:05+02:60',
  123,
  {},
  ['a', 'b'],
])('distinguishes malformed timestamps (%j) from unavailable values', (raw) => {
  expect(parseFileTimestamp(raw).status).toBe('invalid');
  expect(timestampText(parseFileTimestamp(raw))).toBe('Invalid timestamp');
});

it('keeps original filesystem facts separate from file-internal timestamps', () => {
  const file = new File(['12345'], 'local.c3d', {
    lastModified: Date.parse('2026-10-21T07:08:09Z'),
  });
  expect(fileProperties(file)).toMatchObject({
    origin: 'local',
    name: 'local.c3d',
    sizeBytes: 5,
    createdAt: null,
    modifiedAt: { status: 'valid', value: '2026-10-21 07:08:09.000Z', source: 'File.lastModified' },
  });
  expect(fileProperties(file, 'bundled-demo').modifiedAt.status).toBe('missing');
  expect(fileProperties(new File([], 'zero.h5', { lastModified: 0 })).modifiedAt).toMatchObject({
    status: 'valid',
    value: '1970-01-01 00:00:00.000Z',
  });
});

it.each([
  [0, '0 B'],
  [999, '999 B'],
  [1000, '1 KB'],
  [1024, '1.02 KB'],
  [1734604, '1.73 MB'],
  [1000000000, '1 GB'],
  [undefined, 'Not available'],
] as const)('formats byte count %s as %s', (size, expected) =>
  expect(fileSizeText(size)).toBe(expected),
);

it('validates the authoritative H5 attributes without using other dates or loading numerical data', () => {
  const info = h5RecordingInfo({
    get: (path) =>
      path === 'MetaData/FileInfo'
        ? {
            attrs: {
              FileCreationLocal: { value: 'not a timestamp' },
              FileCreationUTC: { value: '2026-10-02 09:36:33.697796+00:00' },
              LastUpdate: { value: '' },
              DateModified: { value: '2026-01-01' }, // Undefined by the current schema.
            },
          }
        : undefined,
  });
  expect(info.fileTimestamps?.created.status).toBe('invalid');
  expect(info.fileTimestamps?.createdUTC).toMatchObject({ status: 'valid', timezone: 'utc' });
  expect(info.fileTimestamps?.modified.status).toBe('missing');
  expect(h5RecordingInfo({}).fileTimestamps?.created.status).toBe('missing');
  const data = parseC3D(physicalFixture(), 'invalid.h5');
  data.source.info = info;
  data.source.filesystem = fileProperties(new File([], 'invalid.h5', { lastModified: 0 }));
  const rows = fileInfoSections(data)
    .find((s) => s.title === 'Dates & Provenance')!
    .rows.filter((r) => r.group === 'Embedded file metadata');
  expect(rows[0].displayValues).toEqual(['Invalid timestamp']);
  expect(rows[0].tooltip).toContain('not a timestamp');
  expect(rows.find((row) => row.label === 'Last modified')!.values).toEqual(['Not available']);
});

it('accepts only established JE_METADATA v1 C3D timestamps and ignores ambiguous vendor dates', () => {
  const params = readParameters(new DataView(physicalFixture())).params;
  params.set('TRIAL:DATE', { dimensions: [], values: ['2026-01-01'] });
  expect(c3dRecordingInfo(params).fileTimestamps?.created.status).toBe('missing');
  for (const entry of c3dMetadataEntries({
    provenance: {
      createdLocal: { values: ['2026-01-02 03:04:05.123456'] },
      createdUTC: { values: ['2026-01-02 02:04:05.123456+00:00'] },
      lastUpdated: { values: ['2026-01-03T04:05:06+01:00'] },
    },
  }))
    params.set(`JE_METADATA:${entry.name}`, { dimensions: [], values: entry.chunks });
  expect(c3dRecordingInfo(params).fileTimestamps).toMatchObject({
    created: { status: 'valid', timezone: 'unspecified' },
    createdUTC: { status: 'valid', timezone: 'utc' },
    modified: { status: 'valid', timezone: 'offset', value: '2026-01-03 04:05:06+01:00' },
  });
  params.set('JE_METADATA:VERSION', { dimensions: [], values: ['2'] });
  expect(c3dRecordingInfo(params).fileTimestamps?.created.status).toBe('missing');
});

it('shares identical values and tooltips between File Info and Explorer, including through crops', () => {
  const data = parseC3D(physicalFixture(), 'local.c3d');
  data.source.filesystem = fileProperties(new File(['12345'], 'local.c3d', { lastModified: 0 }));
  const sections = fileInfoSections(data);
  for (const name of ['File & Recording', 'Dates & Provenance']) {
    const rows = sections.find((s) => s.title === name)!.rows;
    const table = explorerDatasets(data).find(
      (d) => d.id === `metadata:${name === 'File & Recording' ? 'File' : name}`,
    )!;
    const valueColumn = table.columns.length - 1;
    expect(table.count).toBe(rows.length);
    rows.forEach((row, i) => {
      expect(table.cell(i, valueColumn - 1)).toBe(row.label);
      expect(table.cell(i, valueColumn)).toBe(row.values.join('\n'));
      expect(table.cellTitle?.(i, valueColumn)).toBe(row.tooltip);
      expect(table.cellDisplay?.(i, valueColumn)).toBe(row.displayValues?.join('\n'));
    });
  }
  const embedded = sections
    .find((s) => s.title === 'Dates & Provenance')!
    .rows.filter((r) => r.group === 'Embedded file metadata');
  expect(embedded.map((r) => r.values)).toEqual([['Not available']]);
  const size = sections[0].rows.find((r) => r.label === 'File size')!;
  expect(size).toMatchObject({ values: ['5 B'], tooltip: '5 bytes' });
  const cut = cropMotionData(data, 1, 3);
  expect(cut.source.filesystem).toBe(data.source.filesystem);
  expect(fileInfoSections(cut)[3]).toEqual(sections[3]);
  expect(
    fileInfoSections(cut)[0].rows.filter((r) => ['File name', 'File size'].includes(r.label)),
  ).toEqual(sections[0].rows.filter((r) => ['File name', 'File size'].includes(r.label)));
});

it.skipIf(!existsSync('reference-data/authoritative_reference.h5'))(
  'matches the real H5 reference fields and precision',
  async () => {
    await h5.ready;
    const file = new h5.File('reference-data/authoritative_reference.h5', 'r');
    try {
      const info = h5RecordingInfo(file);
      const attrs = (file.get('MetaData/FileInfo') as h5.Group).attrs;
      for (const [field, key] of [
        ['created', 'FileCreationLocal'],
        ['createdUTC', 'FileCreationUTC'],
        ['modified', 'LastUpdate'],
      ] as const) {
        expect(info.fileTimestamps?.[field]).toEqual(
          parseFileTimestamp(attrs[key].value, `/MetaData/FileInfo@${key}`),
        );
        expect(info.fileTimestamps?.[field]?.status).toBe('valid');
      }
      expect(info.fileTimestamps?.created).toMatchObject({ timezone: 'unspecified' });
      expect(info.fileTimestamps?.modified).toMatchObject({ timezone: 'unspecified' });
    } finally {
      file.close();
    }
  },
);

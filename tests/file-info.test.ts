import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileInfo } from '../src/components/FileInfo';
import { fileInfoSections } from '../src/components/fileInfoSections';
import { metadataValues, originalFiles } from '../src/motion/metadata';
import { parseH5Tree, type H5Node } from '../src/importers/h5/schema';
import { parseC3D } from '../src/importers/c3d/importer';
import { c3dRecordingInfo } from '../src/importers/c3d/metadata';
import { readParameters } from '../src/importers/c3d/parameters';
import { extractPlatforms } from '../src/importers/c3d/forces';
import { cropMotionData } from '../src/motion/crop';
import { physicalFixture } from './helpers/c3d';
import type { MotionData } from '../src/motion/types';

function group(
  attributes: Record<string, unknown> = {},
  children: Record<string, H5Node> = {},
): H5Node {
  return {
    attrs: Object.fromEntries(Object.entries(attributes).map(([k, value]) => [k, { value }])),
    keys: () => Object.keys(children),
    get(path) {
      const [key, ...rest] = path.split('/');
      return rest.length ? children[key]?.get?.(rest.join('/')) : children[key];
    },
  };
}
const dataset = (shape: number[], value: number[] = []) => ({
  shape,
  value: value.length
    ? new Float64Array(value)
    : new Float64Array(shape.reduce((a, b) => a * b, 1)),
});
function h5Root(meta: Record<string, unknown> = {}, location: Record<string, unknown> = {}) {
  return group(
    {},
    {
      Trajectories: group(
        { SamplingFrequency: 120, StartFrame: 0, GlobalCoordinateSystem: 'Lab XYZ' },
        {
          Labeled: group(
            { Labels: ['Synthetic marker'], Unit: 'mm' },
            { Data: dataset([1, 4, 3]), Residuals: dataset([1, 3]) },
          ),
        },
      ),
      MetaData: group(
        {},
        {
          Project: group(
            Object.fromEntries(
              Object.entries(meta).filter(
                ([key]) =>
                  ![
                    'OriginalFiles',
                    'PathFile',
                    'FileCreationLocal',
                    'FileCreationUTC',
                    'LastUpdate',
                  ].includes(key),
              ),
            ),
          ),
          FileInfo: group(
            Object.fromEntries(
              Object.entries(meta).filter(([key]) =>
                [
                  'OriginalFiles',
                  'PathFile',
                  'FileCreationLocal',
                  'FileCreationUTC',
                  'LastUpdate',
                ].includes(key),
              ),
            ),
          ),
          Location: group(location),
        },
      ),
      Analog: group(
        { SamplingFrequency: 960, Labels: ['EMG-like analog label'], Units: ['V'] },
        { Data: dataset([1, 24]) },
      ),
      EMG: group(
        { SamplingFrequency: 960, Labels: ['EMG 1', 'EMG 2'], Units: ['V', 'V'] },
        { Data: dataset([2, 24]) },
      ),
      RigidBodies: group(
        {},
        {
          a: group({ Name: 'test_body', Unit: 'mm' }, { Position: dataset([3, 3]) }),
          b: group({ Name: 'test_body2', Unit: 'mm' }, { Position: dataset([3, 3]) }),
        },
      ),
      IKResults: group(
        { Labels: Array.from({ length: 28 }, (_, i) => `Synthetic IK ${i + 1}`) },
        {
          Data: {
            shape: [28, 95],
            get value(): never {
              throw new Error('IK data must not be loaded for File Info');
            },
          },
        },
      ),
      IDResults: group(
        { Labels: Array.from({ length: 28 }, (_, i) => `Synthetic ID ${i + 1}`) },
        {
          Data: {
            shape: [28, 95],
            get value(): never {
              throw new Error('ID data must not be loaded for File Info');
            },
          },
        },
      ),
    },
  );
}
const rows = (data: MotionData) =>
  Object.fromEntries(fileInfoSections(data).flatMap((s) => s.rows.map((r) => [r.label, r.values])));

describe('curated H5 metadata', () => {
  it('maps embedded facts, preserves raw source values and avoids loading model results', () => {
    const original = ['first.c3d', 'second.h5'];
    const root = h5Root(
      {
        SubjectID: 'Synthetic subject',
        Age: 0,
        Sex: 'N/A',
        BodyHeight: 175,
        BodyHeightUnit: 'cm',
        BodyMass: '70 kg',
        Condition: 'Baseline',
        Project: 'Synthetic project',
        ProjectPI: 'Researcher',
        OriginalFiles: original,
        PathFile: 'C:\\synthetic\\a very long folder\\recording.c3d',
        FileCreationLocal: '2026-01-02T03:04:05.123456',
        FileCreationUTC: '2026-01-02T02:04:05.123456Z',
        LastUpdate: '2026-01-03T04:05:06Z',
      },
      { Lat: 0, Lon: 6.1234 },
    );
    const data = parseH5Tree(root, 'synthetic.h5');
    const r = rows(data);
    expect(r['Date']).toEqual(['2026-01-02 03:04:05.123456']);
    expect(r['Source first frame']).toEqual(['0']);
    expect(r['Duration']).toEqual(['0.017 s']);
    expect(r['Age']).toEqual(['0']);
    expect(r['Sex']).toBeUndefined();
    expect(r['Body height']).toEqual(['175 cm']);
    expect(r['Body mass']).toEqual(['70 kg']);
    expect(r['Original files']).toEqual(original);
    expect(r['Latitude']).toEqual(['0']);
    expect(r['Longitude']).toEqual(['6.1234']);
    expect(r['Rigid bodies']).toEqual(['2 — test_body, test_body2']);
    expect(r['EMG channels']).toEqual(['2']);
    expect(r['Analog channels']).toEqual(['1']);
    expect(r['IK results']).toEqual(['28 variables']);
    expect(r['ID results']).toEqual(['28 variables']);
    expect(r['Coordinate system']).toEqual(['Lab XYZ']);
    expect(data.signals?.some((s) => s.group === 'IKResults' || s.group === 'IDResults')).toBe(
      false,
    );
    expect((root.get!('MetaData/FileInfo') as H5Node).attrs!.FileCreationLocal.value).toBe(
      '2026-01-02T03:04:05.123456',
    );
    expect((root.get!('MetaData/FileInfo') as H5Node).attrs!.OriginalFiles.value).toBe(original);
    expect(data.source.metadata.sourceTree).toBeDefined();
    expect(data.source.metadata.hierarchy).toBeDefined();
    const cut = cropMotionData(data, 1, 3);
    expect(rows(cut)['Frames']).toEqual(['2']);
    expect(rows(cut)['Date']).toEqual(r['Date']);
    expect(cut.source.info).toBe(data.source.info);
  });

  it('omits empty sections, uses UTC fallback, and never infers EMG from analog names', () => {
    const root = h5Root(
      {
        SubjectID: 'Unknown',
        Age: NaN,
        BodyHeight: [],
        BodyMass: {},
        Sex: ' n/a ',
        Condition: '',
        Project: null,
        FileCreationLocal: 'Unknown',
        FileCreationUTC: '2026-01-02T02:04:05Z',
      },
      { Lat: 'NaN', Lon: 'NA' },
    );
    const data = parseH5Tree(
      {
        get: (path) =>
          /^(EMG|IKResults|IDResults)(\/|$)/.test(path) ? undefined : root.get?.(path),
      },
      'missing.h5',
    );
    const sections = fileInfoSections(data);
    expect(sections.some((s) => s.title === 'Subject & Trial' || s.title === 'Location')).toBe(
      false,
    );
    const r = rows(data);
    expect(r['Date']).toEqual(['2026-01-02 02:04:05Z']);
    expect(r['EMG channels']).toBeUndefined();
    expect(r['IK results']).toBeUndefined();
    expect(r['ID results']).toBeUndefined();
    expect(r['Force platform type']).toBeUndefined();
  });
});

describe('C3D metadata and acquisition summaries', () => {
  it('reports source platform types without deriving dates or coordinates from screen axes', () => {
    const data = parseC3D(physicalFixture(), 'synthetic.c3d');
    const r = rows(data);
    expect(data.source.info?.platformTypes).toEqual([2]);
    expect(r['Force platform type']).toEqual(['Type 2']);
    expect(r['Analog / force rate']).toEqual(['2000 Hz']);
    expect(r['Date']).toBeUndefined();
    expect(r['Coordinate system']).toBeUndefined();
    expect(fileInfoSections(data).map((s) => s.title)).toEqual([
      'File & Recording',
      'Acquisition',
      'Data',
    ]);
    expect(r['Events']).toEqual(['4']);
  });
  it('honors explicit subject and manufacturer fields without guessing demographic units', () => {
    const p = readParameters(new DataView(physicalFixture())).params;
    for (const [key, values] of Object.entries({
      'SUBJECT:SUBJECT_ID': ['SYN-1'],
      'SUBJECT:AGE': [25],
      'SUBJECT:HEIGHT': [175],
      'SUBJECT:HEIGHT_UNITS': ['cm'],
      'SUBJECT:MASS': [70],
      'SUBJECT:WEIGHT': [700],
      'MANUFACTURER:COMPANY': ['Synthetic instruments'],
      'MANUFACTURER:SOFTWARE': ['Recorder'],
      'MANUFACTURER:VERSION_LABEL': ['1.2'],
      'TRIAL:DATE': [1, 2, 2026],
      'POINT:X_SCREEN': ['+X'],
    }))
      p.set(key, { dimensions: [], values });
    const info = c3dRecordingInfo(p);
    expect(info.subject?.id?.values).toEqual(['SYN-1']);
    expect(info.subject?.age).toEqual({ values: ['25'] });
    expect(info.subject?.height).toEqual({ values: ['175'], unit: 'cm' });
    expect(info.subject?.mass).toEqual({ values: ['70'] });
    expect(info.manufacturer).toBe('Synthetic instruments');
    expect(info.software).toBe('Recorder 1.2');
    expect(info.created).toBeUndefined();
    expect(info.coordinateSystem).toBeUndefined();
    p.delete('SUBJECT:MASS');
    expect(c3dRecordingInfo(p).subject?.mass).toBeUndefined();
    p.set('SUBJECTS:NAMES', { dimensions: [1, 2], values: ['A', 'B'] });
    expect(c3dRecordingInfo(p).subject).toEqual({ name: { values: ['A', 'B'] } });
  });
  it('ignores malformed and future JE_METADATA fields while retaining existing SUBJECT facts', () => {
    const p = readParameters(new DataView(physicalFixture())).params;
    const text = (key: string, value: string) =>
      p.set(key, { dimensions: [value.length, 1], values: [value] });
    text('SUBJECT:SUBJECTID', 'SYN-1');
    text('JE_METADATA:VERSION', '2');
    text('JE_METADATA:SUBJECT_ID', '{"values":["SYN-2"]}');
    expect(c3dRecordingInfo(p).subject?.id).toEqual({ values: ['SYN-1'] });
    text('JE_METADATA:VERSION', '1');
    expect(c3dRecordingInfo(p).subject?.id).toEqual({ values: ['SYN-2'] });
    text('JE_METADATA:SUBJECT_ID', '{"values":[123]}');
    text('JE_METADATA:SUBJECT_MASS', '{"values":["75"],"unit":123}');
    text('JE_METADATA:PROJECT', '{"values":');
    text('JE_METADATA:COORDINATES', '{"values":["XYZ"]}');
    const info = c3dRecordingInfo(p);
    expect(info.subject?.id).toEqual({ values: ['SYN-1'] });
    expect(info.subject?.mass).toBeUndefined();
    expect(info.provenance).toBeUndefined();
    expect(info.coordinateSystem).toBeUndefined();
  });
  it('reports different analog and per-platform force rates and aggregates declared types', () => {
    const data = parseC3D(physicalFixture(), 'rates.c3d');
    data.analogs.forEach((a) => (a.signal.rate = 960));
    const plate = data.forcePlatforms[0];
    data.forcePlatforms = [
      { ...plate, force: { ...plate.force, rate: 1200 } },
      { ...plate, force: { ...plate.force, rate: 2400 } },
    ];
    data.source.info!.platformTypes = [3, 3, 3, 3, 2];
    const r = rows(data);
    expect(r['Analog / force rate']).toBeUndefined();
    expect(r['Analog rate']).toEqual(['960 Hz']);
    expect(r['Force rate']).toEqual(['1200, 2400 Hz']);
    expect(r['Force platform types']).toEqual(['Type 2 × 1, Type 3 × 4']);
    data.analogs = [];
    expect(rows(data)['Analog rate']).toBeUndefined();
    data.forcePlatforms = [];
    expect(rows(data)['Force rate']).toBeUndefined();
    expect(rows(data)['Analog channels']).toEqual(['0']);
    expect(rows(data)['Force platforms']).toEqual(['0']);
  });
});

it('renders curated sections, expandable names, selectable paths and an event count without raw JSON/events', () => {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  data.rigidBodies = Array.from({ length: 5 }, (_, i) => ({
    name: `Body ${i}`,
    markers: [],
    position: { values: new Float64Array(3), components: 3, rate: 200, startTime: 0 },
  }));
  data.source.info!.provenance = {
    sourcePath: { values: ['C:\\very-long-folder\\<literal>\\synthetic.c3d'] },
    originalFiles: { values: ['one.c3d', 'two.c3d'] },
  };
  data.source.metadata.secret = 'Raw tree must stay internal';
  data.events[0].label = 'Do not list this event';
  const html = renderToStaticMarkup(createElement(FileInfo, { data }));
  expect(html).toContain('File &amp; Recording');
  expect(html).toContain('<dt>Events</dt><dd><span');
  expect(html).toContain('<details>');
  expect(html).toContain('5 — names');
  expect(html).toContain('&lt;literal&gt;');
  expect(html).toContain('title="C:');
  for (const text of [
    'Source metadata',
    'sourceTree',
    'hierarchy',
    'Raw tree must stay internal',
    'Do not list this event',
    'Subject &amp; Trial',
    '<pre>',
  ])
    expect(html).not.toContain(text);
  expect(data.source.metadata.secret).toBe('Raw tree must stay internal');
});

it('filters unavailable metadata without discarding zero or corrupting file lists', () => {
  expect(
    metadataValues([
      'Unknown',
      ' n/A ',
      'NA',
      '',
      null,
      undefined,
      NaN,
      [],
      {},
      '[]',
      '{}',
      0,
      0n,
      '0',
    ]),
  ).toEqual(['0', '0', '0']);
  expect(metadataValues(new Float64Array([0, NaN, 1]))).toEqual(['0', '1']);
  expect(originalFiles('["one.c3d", "two.h5"]')).toEqual({ values: ['one.c3d', 'two.h5'] });
  expect(originalFiles("['one.c3d', 'two, three.h5']")).toEqual({
    values: ['one.c3d', 'two, three.h5'],
  });
  expect(originalFiles('one, two.c3d')).toEqual({ values: ['one, two.c3d'] });
});

it('keeps calibrated QTM-style type-2 V channels warning-free with unchanged N/Nm/mm values', () => {
  const p = readParameters(new DataView(physicalFixture())).params;
  const raw = [10, 20, 500, 1000, 2000, 3000];
  const analogs = raw.map((v) => ({
    name: 'synthetic',
    unit: 'V',
    signal: { values: new Float64Array([v]), components: 1, rate: 2000, startTime: 0 },
  }));
  const warnings: string[] = [];
  const plate = extractPlatforms(p, analogs, 1, warnings)[0];
  expect(warnings).toEqual([]);
  expect([...plate.force.values]).toEqual([10, 20, 500]);
  expect([...plate.moment.values]).toEqual([0.2, 2.4, 3]);
  expect([...plate.cop.values]).toEqual([-4.8, 0.4, 0]);
  expect(plate.freeMoment!.values[2]).toBeCloseTo(3.1);
  expect(analogs.map((a) => a.signal.values[0])).toEqual(raw);
  p.set('FORCE_PLATFORM:TYPE', { dimensions: [1], values: [9] });
  expect(extractPlatforms(p, analogs, 1, warnings)).toEqual([]);
  expect(warnings.join()).toContain('type 9 is not supported');
});

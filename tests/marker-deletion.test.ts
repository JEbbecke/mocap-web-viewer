import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import type { MotionData } from '../src/motion/types';
import { MOTION_UNITS } from '../src/motion/units';
import { deleteMarkerCommand, markerDeletionIssue } from '../src/motion/markerDeletion';
import { markerIndex, markerSourceIds } from '../src/motion/markerIdentity';
import { resolveConnections } from '../src/motion/connections';
import { dataSections } from '../src/components/dataSections';
import { explorerDatasets } from '../src/explorer/datasets';
import { plotSeries } from '../src/plots/series';
import {
  applyCrop,
  commitEdit,
  deleteSessionMarker,
  redoEdit,
  renameSessionMarker,
  restoreOriginal,
  selectCrop,
  setData,
  undoEdit,
  useSession,
} from '../src/state/session';
import {
  deleteSelectedMarker,
  openSelectedMarkerMenu,
  selectMarker,
  selectedMarkerActions,
} from '../src/state/markerCommands';
import { handleApplicationShortcut } from '../src/state/shortcuts';
import { parseC3D } from '../src/importers/c3d/importer';
import { parseH5Tree } from '../src/importers/h5/schema';
import { exportC3D } from '../src/exporters/c3d';
import { exportSemanticC3D } from '../src/exporters/semanticC3D';
import { exportSemanticH5 } from '../src/exporters/semanticH5';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { editC3DParameters } from '../src/exporters/c3dParameters';
import { writeC3DLabels, writeC3DText } from '../src/exporters/c3dLabels';
import { physicalFixture } from './helpers/c3d';
import { readParameters, number, labels } from '../src/importers/c3d/parameters';
import { rotationFixture } from './helpers/rotationC3d';
import c3dFixtures from './fixtures/c3d.json';
import h5Fixture from './fixtures/current-h5.json';

const state = useSession.getState;
const current = () => state().data!;
function fixture(): MotionData {
  const frames = 5,
    count = 4;
  return {
    name: 'deletion fixture',
    units: MOTION_UNITS,
    source: {
      format: 'H5',
      originalPositionUnit: 'mm',
      metadata: {},
      h5Layout: 'institute-current',
      eventSchema: 'institute-current',
    },
    timeline: { frameCount: frames, rate: 100, firstFrame: 37, duration: (frames - 1) / 100 },
    markers: {
      labels: ['LASI', 'RASI', 'LKNE', 'RKNE'],
      positions: Float64Array.from({ length: frames * count * 3 }, (_, i) => i + 0.123456789),
      valid: Uint8Array.from({ length: frames * count }, (_, i) => (i % 3 ? 1 : 0)),
      residuals: Float64Array.from({ length: frames * count }, (_, i) => (i % 3 ? i / 10 : -1)),
      quality: {
        type: Int8Array.from({ length: frames * count }, (_, i) => i - 10),
        cameraCount: 2,
        cameraMasks: Uint8Array.from({ length: frames * count * 2 }, (_, i) => i % 2),
        virtual: new Uint8Array([0, 1, 0, 1]),
        cameraMasksKnown: new Uint8Array([1, 0, 1, 1]),
      },
    },
    analogs: [
      {
        name: 'EMG',
        unit: 'V',
        signal: { values: new Float64Array(10).fill(2), components: 1, startTime: 0, rate: 200 },
      },
    ],
    events: [{ label: 'Contact', context: 'Left', time: 0.02 }],
    forcePlatforms: [],
    rigidBodies: [
      {
        name: 'Body',
        markers: ['LASI', 'RASI', 'LKNE'],
        position: { values: new Float64Array(15), components: 3, rate: 100, startTime: 0 },
      },
    ],
    warnings: ['Preserved source warning'],
  };
}
beforeEach(() => {
  setData(fixture());
  useSession.setState({ viewerReady: true });
});

const keep = (
  values: ArrayLike<number>,
  count: number,
  frames: number,
  width: number,
  indices: number[],
) =>
  Array.from({ length: frames }, (_, f) =>
    indices.flatMap((m) =>
      Array.from({ length: width }, (_, a) => values[(f * count + m) * width + a]),
    ),
  ).flat();

function expectRetained(
  actual: MotionData,
  original: MotionData,
  indices: number[],
  start = 0,
  end = original.timeline.frameCount,
) {
  const frames = original.timeline.frameCount,
    count = original.markers.labels.length;
  for (const [key, width] of [
    ['positions', 3],
    ['valid', 1],
    ['residuals', 1],
  ] as const) {
    const values = original.markers[key];
    if (values) {
      const target = actual.markers[key]!;
      const expected = new (target.constructor as typeof Float64Array)(
        keep(values, count, frames, width, indices).slice(
          start * indices.length * width,
          end * indices.length * width,
        ),
      );
      expect(
        Buffer.from(target.buffer, target.byteOffset, target.byteLength).equals(
          Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
        ),
        `${key}: exact retained samples`,
      ).toBe(true);
    }
  }
  expect(actual.timeline.rate).toBe(original.timeline.rate);
  expect(actual.timeline.frameCount).toBe(end - start);
  expect(actual.timeline.firstFrame).toBe(original.timeline.firstFrame + start);
}

it('removes the complete trajectory, quality and memberships in one atomic reversible action', () => {
  const original = current();
  selectMarker(1);
  useSession.setState({
    hidden: new Set([1, 2]),
    plot: 'marker:1',
    explorerDataset: 'marker:1',
    explorerColumns: { datasetId: 'marker:1', columns: ['x'], anchor: 'x' },
  });
  openSelectedMarkerMenu(10, 10);
  expect(deleteSelectedMarker()).toBe(true);
  expect(state().history.past).toHaveLength(1);
  expect(state()).toMatchObject({
    selected: -1,
    markerMenu: null,
    plot: 'none',
    explorerDataset: '',
    explorerColumns: null,
    dirty: true,
  });
  expect([...state().hidden]).toEqual([1]);
  expect(markerSourceIds(current())).toEqual([0, 2, 3]);
  expectRetained(current(), original, [0, 2, 3]);
  expect(current().markers.labels).toEqual(['LASI', 'LKNE', 'RKNE']);
  expect(current().markers.quality!.type).toEqual(
    new Int8Array(keep(original.markers.quality!.type!, 4, 5, 1, [0, 2, 3])),
  );
  expect(current().markers.quality!.cameraMasks).toEqual(
    new Uint8Array(keep(original.markers.quality!.cameraMasks!, 4, 5, 2, [0, 2, 3])),
  );
  expect(current().markers.quality!.virtual).toEqual(new Uint8Array([0, 0, 1]));
  expect(current().markers.quality!.cameraMasksKnown).toEqual(new Uint8Array([1, 1, 1]));
  expect(current().rigidBodies![0].markers).toEqual(['LASI', 'LKNE']);
  for (const key of ['timeline', 'analogs', 'forcePlatforms', 'events', 'warnings'] as const)
    expect(current()[key]).toBe(original[key]);
  expect(current().rigidBodies![0].position).toBe(original.rigidBodies![0].position);
  undoEdit();
  expect(current().markers).toEqual(original.markers);
  expect(current().rigidBodies).toEqual(original.rigidBodies);
  expect(state()).toMatchObject({
    selected: 1,
    plot: 'marker:1',
    explorerDataset: 'marker:1',
    dirty: false,
  });
  expect([...state().hidden].sort()).toEqual([1, 2]);
  redoEdit();
  expect(current().markers.labels).toEqual(['LASI', 'LKNE', 'RKNE']);
  expect(state().selected).toBe(-1);
});

it('keeps Inspector, Explorer, plot and connection identities consistent across index shifts', () => {
  const original = current();
  const pairs = resolveConnections(original.markers.labels, 'plug-in-gait');
  useSession.setState({
    selected: 3,
    plot: 'marker:3',
    explorerDataset: 'marker:3',
    hidden: new Set([3]),
  });
  deleteSessionMarker(1);
  expect(state()).toMatchObject({ selected: 2, plot: 'marker:3', explorerDataset: 'marker:3' });
  expect([...state().hidden]).toEqual([2]);
  expect(dataSections(current())[0].entries.map((e) => e.id)).toEqual([
    'marker:0',
    'marker:2',
    'marker:3',
  ]);
  const dataset = explorerDatasets(current()).find((d) => d.id === 'marker:3')!;
  expect(dataset.name).toBe('RKNE');
  expect(dataset.cell(2, 4)).toBe(original.markers.positions[(2 * 4 + 3) * 3]);
  expect(plotSeries(current(), 'marker:3', -1)).toEqual(plotSeries(original, 'marker:3', 0));
  expect(plotSeries(current(), 'marker:1', -1).values[1]).toEqual(new Array(5).fill(null));
  const connections = resolveConnections(
    current().markers.connectionLabels ?? current().markers.labels,
    'plug-in-gait',
  );
  expect(
    connections.map(([a, b]) => [markerSourceIds(current())[a], markerSourceIds(current())[b]]),
  ).toEqual(pairs.filter((pair) => !pair.includes(1)));
  undoEdit();
  expect(state().selected).toBe(3);
});

it('uses stable identity for multiple mixed rename/delete operations and preserves original ordering', () => {
  const original = current();
  renameSessionMarker(1, 'Renamed');
  deleteSessionMarker(1);
  renameSessionMarker(1, 'Renamed remaining'); // source ID 2 now occupies position 1
  deleteSessionMarker(0);
  expect(markerSourceIds(current())).toEqual([2, 3]);
  undoEdit();
  undoEdit();
  undoEdit();
  expect(current().markers.labels).toEqual(['LASI', 'Renamed', 'LKNE', 'RKNE']);
  undoEdit();
  expect(current().markers).toEqual({
    ...original.markers,
    connectionLabels: original.markers.labels,
  });
  redoEdit();
  expect(current().markers.labels[1]).toBe('Renamed');
  redoEdit();
  expect(markerIndex(current(), 1)).toBe(-1);
  redoEdit();
  redoEdit();
  expect(current().markers.labels).toEqual(['Renamed remaining', 'RKNE']);
  expectRetained(current(), original, [2, 3]);
});

it('does not retarget or repeatedly delete another marker, and safely retains the last trajectory', () => {
  selectMarker(0);
  const press = (scope = '', repeat = false) => {
    let prevented = false;
    const handled = handleApplicationShortcut(
      {
        key: 'Delete',
        repeat,
        target: { closest: (selector: string) => (scope && selector.includes(scope) ? {} : null) },
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as KeyboardEvent,
      { viewerActive: true, closeExplorer: () => {} },
    );
    expect(prevented).toBe(handled);
    return handled;
  };
  for (const scope of [
    'input',
    'textarea',
    '[contenteditable]',
    'button',
    'dialog',
    '[role="menu"]',
    '[role="separator"]',
    '.data-explorer',
  ])
    expect(press(scope)).toBe(false);
  expect(press('', true)).toBe(false);
  expect(press()).toBe(true);
  expect(press()).toBe(false);
  selectMarker(0);
  expect(press('', true)).toBe(false);
  expect(press()).toBe(true);
  selectMarker(0);
  expect(press()).toBe(true);
  selectMarker(0);
  expect(press()).toBe(false);
  expect(current().markers.labels).toHaveLength(1);
  expect(selectedMarkerActions()).toMatchObject({
    delete: false,
    deleteReason: expect.stringContaining('at least one'),
  });
  expect(() => deleteSessionMarker(0)).toThrow('at least one');
});

it('guards malformed/unsupported data, retains source identities through crop and restores the original', () => {
  const original = current();
  original.source.markerDeletionIssue = 'Unsupported dependency';
  expect(deleteSelectedMarker()).toBe(false);
  expect(markerDeletionIssue(original, -1)).toContain('existing');
  delete original.source.markerDeletionIssue;
  expect(() =>
    deleteMarkerCommand(
      { ...original, markers: { ...original.markers, valid: new Uint8Array(0) } },
      0,
    ),
  ).toThrow('dimensions');
  deleteSessionMarker(1);
  selectCrop(1, 4);
  applyCrop();
  expect(markerSourceIds(current())).toEqual([0, 2, 3]);
  deleteSessionMarker(1);
  undoEdit();
  expectRetained(current(), original, [0, 2, 3], 1, 4);
  restoreOriginal();
  expect(current()).toBe(original);
});

describe('C3D marker selection serialization', () => {
  it.each(Object.keys(c3dFixtures))(
    '%s retains raw point/analog values, labels, descriptions, quality and temporal metadata',
    (variant) => {
      let source = Uint8Array.from(
        Buffer.from(c3dFixtures[variant as keyof typeof c3dFixtures], 'base64'),
      ).buffer;
      const editor = editC3DParameters(source, 'POINT');
      editor.parameter('DESCRIPTIONS', -1, [3, 2], new TextEncoder().encode('onetwo'));
      source = editor.finish();
      const original = parseC3D(source, 'source.c3d');
      setData(original);
      renameSessionMarker(1, 'Renamed kept');
      deleteSessionMarker(0);
      const data = current();
      const exported = exportC3D(
        source,
        0,
        original.timeline.frameCount,
        undefined,
        data.markers.labels,
        undefined,
        undefined,
        data.markers.sourceIndices,
      );
      const reopened = parseC3D(exported, 'reopened.c3d');
      expect(reopened.markers.labels).toEqual(['Renamed kept']);
      expectRetained(reopened, original, [1]);
      expect(reopened.analogs).toEqual(original.analogs);
      expect(reopened.events).toEqual(original.events);
      expect(reopened.forcePlatforms).toEqual(original.forcePlatforms);
      const p = readParameters(new DataView(exported));
      expect(number(p.params, 'POINT:USED', -1)).toBe(1);
      expect(new DataView(exported).getUint16(2, p.little)).toBe(1);
      expect(labels(p.params, 'POINT:DESCRIPTIONS')).toEqual(['two']);
      const oldP = readParameters(new DataView(source));
      const oldStart = (number(oldP.params, 'POINT:DATA_START', 0) - 1) * 512;
      const newStart = (number(p.params, 'POINT:DATA_START', 0) - 1) * 512;
      const width = number(p.params, 'POINT:SCALE', 0) < 0 ? 4 : 2;
      const analogBytes =
        (width * original.analogs.length * (original.analogs[0]?.signal.rate ?? 0)) /
        original.timeline.rate;
      for (let f = 0; f < original.timeline.frameCount; f++)
        expect(
          new Uint8Array(
            exported,
            newStart + f * (4 * width + analogBytes),
            4 * width + analogBytes,
          ),
        ).toEqual(
          new Uint8Array(
            source,
            oldStart + f * (8 * width + analogBytes) + 4 * width,
            4 * width + analogBytes,
          ),
        );
      undoEdit();
      expect(current().markers.labels).toEqual(['' + original.markers.labels[0], 'Renamed kept']);
      redoEdit();
      expect(current().markers.labels).toEqual(['Renamed kept']);
    },
  );

  it('combines deletion, crop, events and plate edits without changing remaining trajectories', () => {
    const original = fixture();
    const source = exportSemanticC3D(original);
    const imported = parseC3D(source, 'source.c3d');
    setData(imported);
    deleteSessionMarker(1);
    deleteSessionMarker(1);
    const actual = parseC3D(
      exportC3D(
        source,
        1,
        4,
        [{ label: 'Edited', context: '', time: 0 }],
        current().markers.labels,
        undefined,
        undefined,
        current().markers.sourceIndices,
      ),
      'cropped.c3d',
    );
    expectRetained(actual, imported, [0, 3], 1, 4);
    expect(actual.events[0].label).toBe('Edited');
    expect(() => exportC3D(source, 0, 5, undefined, [], undefined, undefined, [])).toThrow(
      'at least one',
    );
  });

  it('preserves rotation omission warnings through deletion, undo/redo and clean export', () => {
    const source = rotationFixture();
    const original = parseC3D(source, 'partial.c3d');
    setData(original);
    deleteSessionMarker(0);
    expect(current().source.partialImport).toBe(original.source.partialImport);
    expect(current().warnings).toBe(original.warnings);
    undoEdit();
    redoEdit();
    const reopened = parseC3D(
      exportC3D(
        source,
        0,
        3,
        undefined,
        current().markers.labels,
        undefined,
        undefined,
        current().markers.sourceIndices,
      ),
      'clean.c3d',
    );
    expectRetained(reopened, original, [1]);
    expect(reopened.source.partialImport).toBeUndefined();
  });
});

it('round trips H5 deletion/quality/memberships/metadata, with undo/redo and crop, preserving unrelated source trees', async () => {
  await h5.ready;
  const folder = resolve('.local/marker-deletion-tests');
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, 'synthetic.h5');
  writeFileSync(path, Buffer.from(h5Fixture.base64, 'base64'));
  const input = new h5.File(path, 'r');
  try {
    const original = parseH5Tree(input, 'source.h5');
    setData(original);
    renameSessionMarker(1, 'Kept renamed');
    deleteSessionMarker(0);
    for (let step = 0; step < 3; step++) {
      const data = current();
      const indices = data.markers.sourceIndices;
      const output = createH5Output(h5, input, resolve(folder, `deleted-${step}.h5`));
      try {
        writeCroppedH5(
          h5,
          input,
          output,
          0,
          original.timeline.frameCount,
          undefined,
          original,
          data.markers.labels,
          undefined,
          undefined,
          indices,
        );
        const actual = parseH5Tree(output, 'edited.h5');
        expectRetained(actual, original, step === 1 ? [0, 1] : [1]);
        expect(actual.markers.labels).toEqual(data.markers.labels);
        expect(actual.markers.quality).toEqual(data.markers.quality);
        expect(actual.rigidBodies).toEqual(data.rigidBodies);
        expect(actual.events).toEqual(original.events);
        expect(actual.analogs).toEqual(original.analogs);
        expect(actual.forcePlatforms).toEqual(original.forcePlatforms);
        expect(
          (output.get('Trajectories/Labeled') as h5.Group).attrs.NumLabeled?.value ??
            actual.markers.labels.length,
        ).toEqual(BigInt(data.markers.labels.length));
        for (const name of ['LABELS', 'DESCRIPTIONS']) {
          const group = output.get(`MetaData/C3DParameters/POINT/${name}`) as h5.Group | null;
          if (group)
            expect((group.attrs.value.value as string[]).length).toBe(data.markers.labels.length);
        }
      } finally {
        output.close();
      }
      if (step === 0) undoEdit();
      else redoEdit();
    }
    const output = createH5Output(h5, input, resolve(folder, 'cropped.h5'));
    try {
      writeCroppedH5(
        h5,
        input,
        output,
        1,
        3,
        undefined,
        original,
        current().markers.labels,
        undefined,
        undefined,
        current().markers.sourceIndices,
      );
      expectRetained(parseH5Tree(output, 'cropped.h5'), original, [1], 1, 3);
    } finally {
      output.close();
    }
  } finally {
    input.close();
  }
});

it('converts edited subsets to both formats without modifying the current arrays or clocks', async () => {
  const original = current();
  deleteSessionMarker(1);
  deleteSessionMarker(0);
  const data = current();
  const baseline = parseC3D(exportSemanticC3D(original), 'baseline.c3d');
  expectRetained(parseC3D(exportSemanticC3D(data), 'converted.c3d'), baseline, [2, 3]);
  const c3d = parseC3D(exportSemanticC3D(data), 'converted.c3d');
  const output = await exportSemanticH5(c3d);
  const path = resolve('.local/marker-deletion-converted.h5');
  writeFileSync(path, new Uint8Array(output));
  const input = new h5.File(path, 'r');
  try {
    expectRetained(parseH5Tree(input, 'converted.h5'), baseline, [2, 3]);
  } finally {
    input.close();
  }
  expect(current()).toBe(data);
});

it('preserves segmented C3D labels/descriptions, per-point numeric metadata and known references', () => {
  const data = fixture();
  data.markers = {
    labels: Array.from({ length: 260 }, (_, i) => `M${i}`),
    positions: new Float64Array(5 * 260 * 3).fill(12.5),
    valid: new Uint8Array(5 * 260).fill(1),
  };
  data.rigidBodies = [];
  let source = exportSemanticC3D(data);
  source = writeC3DText(
    source,
    data.markers.labels.map((_, i) => `Description ${i}`),
    'POINT',
    'DESCRIPTIONS',
  );
  source = writeC3DText(source, ['M0', 'M254', 'M259', 'external reference'], 'POINT', 'MARKERS');
  const indices = Array.from({ length: 260 }, (_, i) => i).filter(
    (i) => ![0, 254, 255].includes(i),
  );
  const editedLabels = indices.map((i) =>
    i === 259 ? 'Renamed retained' : data.markers.labels[i],
  );
  const original = parseC3D(source, 'segmented.c3d');
  const output = exportC3D(source, 0, 5, undefined, editedLabels, undefined, undefined, indices);
  const actual = parseC3D(output, 'selected.c3d');
  expectRetained(actual, original, indices);
  const p = readParameters(new DataView(output)).params;
  expect(labels(p, 'POINT:LABELS')).toEqual(editedLabels);
  expect(labels(p, 'POINT:DESCRIPTIONS')).toEqual(indices.map((i) => `Description ${i}`));
  expect(labels(p, 'POINT:MARKERS')).toEqual(['Renamed retained', 'external reference']);
  // Undoing deletion can leave a rename active, so full-column exports also update references.
  const renamed = writeC3DLabels(
    source,
    data.markers.labels.map((name, i) => (i === 259 ? 'Renamed retained' : name)),
  );
  expect(labels(readParameters(new DataView(renamed)).params, 'POINT:MARKERS')).toEqual([
    'M0',
    'M254',
    'Renamed retained',
    'external reference',
  ]);

  const small = Uint8Array.from(Buffer.from(c3dFixtures.intelFloat, 'base64')).buffer;
  const editor = editC3DParameters(small, 'POINT');
  const values = new Uint8Array(8);
  new DataView(values.buffer).setFloat32(0, 1.5, true);
  new DataView(values.buffer).setFloat32(4, 2.5, true);
  editor.parameter('CONFIDENCE', 4, [2], values);
  const selected = exportC3D(
    editor.finish(),
    0,
    3,
    undefined,
    undefined,
    undefined,
    undefined,
    [1],
  );
  expect(readParameters(new DataView(selected)).params.get('POINT:CONFIDENCE')!.values).toEqual([
    2.5,
  ]);
});

it.each([2, 3, 4] as const)(
  'retains TYPE-%s force calibration and every analog sample byte after point compaction',
  (type) => {
    let source = physicalFixture(type);
    const original = parseC3D(source, 'force.c3d');
    const editor = editC3DParameters(source, 'POINT');
    editor.parameter('USED', 2, [], new Uint8Array([2, 0]));
    source = writeC3DLabels(editor.finish(), ['A', 'B']);
    const p = readParameters(new DataView(source));
    const start = (number(p.params, 'POINT:DATA_START', 0) - 1) * 512;
    const analogBytes = original.analogs.length * 10 * 4;
    const frames = original.timeline.frameCount;
    const expanded = new Uint8Array(Math.ceil((start + frames * (32 + analogBytes)) / 512) * 512);
    expanded.set(new Uint8Array(source, 0, start));
    for (let f = 0; f < frames; f++) {
      const from = start + f * (16 + analogBytes),
        to = start + f * (32 + analogBytes);
      expanded.set(new Uint8Array(source, from, 16), to);
      expanded.set(new Uint8Array(source, from, 16 + analogBytes), to + 16);
    }
    new DataView(expanded.buffer).setUint16(2, 2, true);
    const exported = parseC3D(
      exportC3D(expanded.buffer, 0, frames, undefined, undefined, undefined, undefined, [1]),
      'selected.c3d',
    );
    expect(exported.analogs).toEqual(original.analogs);
    expect(exported.forcePlatforms).toEqual(original.forcePlatforms);
    expect(exported.events).toEqual(original.events);
    expect(exported.markers.positions).toEqual(original.markers.positions);
  },
);

it('rejects undocumented marker dependencies before creating a history entry', () => {
  let source = Uint8Array.from(Buffer.from(c3dFixtures.intelFloat, 'base64')).buffer;
  const names = parseC3D(source, 'source.c3d').markers.labels;
  source = writeC3DText(source, [names[0]], 'MODEL', 'MARKER_LINKS');
  setData(parseC3D(source, 'dependent.c3d'));
  expect(selectedMarkerActions().delete).toBe(false);
  expect(selectedMarkerActions().deleteReason).toContain('undocumented');
  expect(deleteSelectedMarker()).toBe(false);
  expect(state().history.past).toHaveLength(0);
  expect(() => exportC3D(source, 0, 3, undefined, undefined, undefined, undefined, [1])).toThrow(
    'dependencies',
  );
});

it('blocks noncontiguous C3D text metadata instead of silently dropping a segment', () => {
  const source = writeC3DText(
    Uint8Array.from(Buffer.from(c3dFixtures.intelFloat, 'base64')).buffer,
    ['unresolved description'],
    'POINT',
    'DESCRIPTIONS3',
  );
  setData(parseC3D(source, 'segmented.c3d'));
  expect(selectedMarkerActions().delete).toBe(false);
  expect(selectedMarkerActions().deleteReason).toContain('noncontiguous');
  expect(deleteSelectedMarker()).toBe(false);
  expect(state().history.past).toHaveLength(0);
  expect(() => exportC3D(source, 0, 3, undefined, undefined, undefined, undefined, [1])).toThrow(
    'noncontiguous',
  );
});

it('slices extra H5 marker metadata and empty camera axes without touching unrelated data', async () => {
  await h5.ready;
  const path = resolve('.local/marker-deletion-extra.h5');
  writeFileSync(path, Buffer.from(h5Fixture.base64, 'base64'));
  const input = new h5.File(path, 'a');
  try {
    const labeled = input.get('Trajectories/Labeled') as h5.Group;
    const original = parseH5Tree(input, 'extra.h5');
    labeled.create_attribute('Descriptions', ['first', 'second']);
    labeled.create_dataset({
      name: 'Confidence',
      shape: [2, original.timeline.frameCount],
      data: Float64Array.from({ length: 2 * original.timeline.frameCount }, (_, i) => i + 0.25),
    });
    const point = input.get('MetaData/C3DParameters/POINT') as h5.Group;
    point.create_group('CONFIDENCE').create_attribute('value', new Float64Array([0.5, 0.75]));
    point
      .create_group('MARKERS')
      .create_attribute('value', [...original.markers.labels, 'external reference']);
    input.flush();
    const motion = parseH5Tree(input, 'extra.h5');
    expect(motion.source.markerDeletionIssue).toBeUndefined();
    const output = createH5Output(h5, input, resolve('.local/marker-deletion-extra-output.h5'));
    try {
      writeCroppedH5(
        h5,
        input,
        output,
        0,
        motion.timeline.frameCount,
        undefined,
        motion,
        ['Renamed retained'],
        undefined,
        undefined,
        [1],
      );
      const actual = parseH5Tree(output, 'selected.h5');
      expectRetained(actual, motion, [1]);
      expect(actual.markers.labels).toEqual(['Renamed retained']);
      const target = output.get('Trajectories/Labeled') as h5.Group;
      expect(target.attrs.Descriptions.value).toEqual(['second']);
      expect((target.get('Confidence') as h5.Dataset).shape).toEqual([
        1,
        motion.timeline.frameCount,
      ]);
      expect((target.get('Confidence') as h5.Dataset).value).toEqual(
        ((labeled.get('Confidence') as h5.Dataset).value as Float64Array).slice(
          motion.timeline.frameCount,
        ),
      );
      expect(
        (output.get('MetaData/C3DParameters/POINT/CONFIDENCE') as h5.Group).attrs.value.value,
      ).toEqual(new Float64Array([0.75]));
      expect(
        (output.get('MetaData/C3DParameters/POINT/MARKERS') as h5.Group).attrs.value.value,
      ).toEqual(['Renamed retained', 'external reference']);
      for (const path of ['Analog/Data', 'Events/Time', 'ForcePlates/0/Force']) {
        const before = input.get(path) as h5.Dataset | null,
          after = output.get(path) as h5.Dataset | null;
        if (before) {
          expect(after!.value).toEqual(before.value);
          expect(after!.shape).toEqual(before.shape);
        }
      }
    } finally {
      output.close();
    }
    const renamed = createH5Output(h5, input, resolve('.local/marker-deletion-extra-renamed.h5'));
    try {
      writeCroppedH5(h5, input, renamed, 0, motion.timeline.frameCount, undefined, motion, [
        motion.markers.labels[0],
        'Renamed retained',
      ]);
      expect(
        (renamed.get('MetaData/C3DParameters/POINT/MARKERS') as h5.Group).attrs.value.value,
      ).toEqual([motion.markers.labels[0], 'Renamed retained', 'external reference']);
    } finally {
      renamed.close();
    }
    (input.get('MetaData/C3DParameters') as h5.Group)
      .create_group('MODEL')
      .create_group('MARKER_LINKS')
      .create_attribute('value', [motion.markers.labels[0]]);
    input.flush();
    setData(parseH5Tree(input, 'dependent.h5'));
    expect(selectedMarkerActions().deleteReason).toContain('undocumented marker dependencies');
    expect(deleteSelectedMarker()).toBe(false);
    labeled.create_group('Undocumented');
    input.flush();
    setData(parseH5Tree(input, 'unsupported.h5'));
    expect(selectedMarkerActions().delete).toBe(false);
    expect(selectedMarkerActions().deleteReason).toContain('marker axis');
  } finally {
    input.close();
  }

  const emptyPath = resolve('.local/marker-deletion-empty-camera.h5');
  const initial = parseC3D(exportSemanticC3D(fixture()), 'fresh.c3d');
  writeFileSync(emptyPath, new Uint8Array(await exportSemanticH5(initial)));
  const empty = new h5.File(emptyPath, 'a');
  try {
    (empty.get('Trajectories/Labeled') as h5.Group).create_dataset({
      name: 'CameraMasks',
      shape: [4, 0, 5],
      data: new Uint8Array(),
    });
    const motion = parseH5Tree(empty, 'empty.h5');
    const output = createH5Output(
      h5,
      empty,
      resolve('.local/marker-deletion-empty-camera-output.h5'),
    );
    try {
      writeCroppedH5(
        h5,
        empty,
        output,
        1,
        4,
        undefined,
        motion,
        undefined,
        undefined,
        undefined,
        [0, 2],
      );
      expect((output.get('Trajectories/Labeled/CameraMasks') as h5.Dataset).shape).toEqual([
        2, 0, 3,
      ]);
      expectRetained(parseH5Tree(output, 'empty-edited.h5'), motion, [0, 2], 1, 4);
    } finally {
      output.close();
    }
  } finally {
    empty.close();
  }
});

for (const name of ['QTM_Example.c3d', 'XSENSE_example.c3d']) {
  const path = resolve('reference-data', name);
  it.skipIf(!existsSync(path))(
    `round trips deletion from the read-only local ${name} reference`,
    () => {
      const bytes = readFileSync(path);
      const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const original = parseC3D(source, name);
      setData(original);
      deleteSessionMarker(1);
      const indices = current().markers.sourceIndices!;
      const output = exportC3D(
        source,
        0,
        original.timeline.frameCount,
        undefined,
        current().markers.labels,
        undefined,
        undefined,
        indices,
      );
      const actual = parseC3D(output, 'edited.c3d');
      expectRetained(actual, original, indices);
      expect(actual.analogs).toEqual(original.analogs);
      expect(actual.forcePlatforms).toEqual(original.forcePlatforms);
      expect(actual.events).toEqual(original.events);
      expect(readFileSync(path).equals(bytes)).toBe(true);
      expect(current().source.partialImport).toBe(original.source.partialImport);
      expect(current().warnings).toEqual(original.warnings);
    },
  );
}

import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { explorerDatasets, seriesDataset, type Dataset } from '../src/explorer/datasets';
import {
  headerCellSelection,
  selectHeaderColumn,
  type ColumnSelection,
} from '../src/explorer/selection';
import { columnPlotData, plotSeries } from '../src/plots/series';
import { readModelSeries } from '../src/plots/modelSeries';
import { cropMotionData } from '../src/motion/crop';
import { cropPreviewInterval } from '../src/plots/cropPreview';
import { SignalPlot } from '../src/plots/SignalPlot';
import { selectPlot, setData, useSession } from '../src/state/session';

const order = ['sample', 'time', 'x', 'y', 'z'];
const header = (
  previous: ColumnSelection | null,
  id: string,
  modifiers = {},
  dataset = 'marker:0',
) => selectHeaderColumn(previous, dataset, order, id, modifiers);
const graph = (d: Dataset, ids: string[]) =>
  columnPlotData(
    d.count,
    d.time,
    d.columns.filter((c) => ids.includes(c.id) && c.plot).map((c) => c.plot!),
  );

it('replaces, toggles, removes and orders header selections with predictable anchors', () => {
  let selected = header(null, 'time');
  expect(selected).toEqual({ datasetId: 'marker:0', columns: ['time'], anchor: 'time' });
  selected = header(selected, 'y', { toggle: true });
  expect(selected.columns).toEqual(['time', 'y']);
  expect(selected.anchor).toBe('y');
  selected = header(selected, 'time', { toggle: true });
  expect(selected.columns).toEqual(['y']);
  expect(selected.anchor).toBe('time');
  expect(header(selected, 'x').columns).toEqual(['x']);
  expect(header(header(null, 'x'), 'x', { toggle: true }).columns).toEqual([]);
});

it('extends in visible column order, reverses ranges, preserves the anchor and adds ranges', () => {
  let selected = header(null, 'time');
  selected = header(selected, 'z', { extend: true });
  expect(selected.columns).toEqual(['time', 'x', 'y', 'z']);
  expect(selected.anchor).toBe('time');
  expect(header(selected, 'sample', { extend: true }).columns).toEqual(['sample', 'time']);
  selected = header(header(null, 'sample'), 'x', { toggle: true });
  expect(header(selected, 'z', { toggle: true, extend: true }).columns).toEqual([
    'sample',
    'x',
    'y',
    'z',
  ]);
  expect(header(null, 'y', { extend: true }).columns).toEqual(['y']);
  expect(
    selectHeaderColumn(selected, 'marker:0', [...order].reverse(), 'z', { extend: true }).columns,
  ).toEqual(['z', 'y', 'x']);
});

it('scopes IDs to datasets and projects onto each page without changing stored selection', () => {
  const selected = header(null, 'x');
  expect(header(selected, 'z', { extend: true }, 'analog:0').columns).toEqual(['z']);
  expect(headerCellSelection(selected, 'analog:0', order, 200)).toBeNull();
  for (const count of [200, 5])
    expect(headerCellSelection(selected, 'marker:0', order, count)?.ranges).toEqual([
      { start: { row: 0, column: 2 }, end: { row: count - 1, column: 2 } },
    ]);
  expect(selected.columns).toEqual(['x']);
});

it('maps marker coordinates and analog values to shared units, clocks and invalid-sample gaps', () => {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  const datasets = explorerDatasets(data);
  const marker = datasets.find((d) => d.id === 'marker:0')!;
  const xyz = graph(marker, ['x', 'y', 'z'])!;
  expect(xyz).toEqual(plotSeries(data, 'marker:0', 0));
  expect(graph(marker, ['sample', 'time', 'valid'])).toBeNull();
  expect(graph(marker, ['x'])?.labels).toEqual(['X']);
  expect(graph(marker, ['x', 'z'])?.labels).toEqual(['X', 'Z']);
  expect(xyz.values[1][123]).toBeNull();
  const analog = datasets.find((d) => d.id === 'analog:0')!;
  const signal = graph(analog, ['component:0'])!;
  expect(signal.unit).toBe(data.analogs[0].unit);
  expect(signal.values).toEqual(plotSeries(data, 'analog:0', 0).values);
  expect(signal.values[0][1]).toBe(1 / data.analogs[0].signal.rate);
  expect(signal.values[0][1]).not.toBe(xyz.values[0][1]);
  for (const d of datasets.filter(
    (d) => d.id === 'events' || d.id.startsWith('metadata:') || d.id.endsWith(':Corners'),
  ))
    expect(
      graph(
        d,
        d.columns.map((c) => c.id),
      ),
    ).toBeNull();
  const renamed = {
    ...data,
    markers: { ...data.markers, labels: ['Renamed', ...data.markers.labels.slice(1)] },
  };
  expect(
    explorerDatasets(renamed)
      .find((d) => d.id === marker.id)
      ?.columns.map((c) => c.id),
  ).toEqual(marker.columns.map((c) => c.id));
});

it('uses complete large buffers and irregular physical timestamps, independently of table rows', () => {
  const n = 1005;
  const d = seriesDataset(
    's',
    'Synthetic',
    ['Analog'],
    {
      components: 2,
      rate: 1000,
      startTime: 9,
      values: Float64Array.from({ length: n * 2 }, (_, i) => i),
      times: Float64Array.from({ length: n }, (_, i) => 7 + (i * i) / 10000),
    },
    'V',
    ['A [V]', 'B [V]'],
  );
  const full = graph(d, ['time', 'sample', 'component:0', 'component:1'])!;
  expect(full.labels).toEqual(['A', 'B']);
  expect(full.unit).toBe('V');
  expect(full.values[0]).toHaveLength(n);
  expect(full.values[0].at(-1)).toBe(7 + (1004 * 1004) / 10000);
  expect(full.values[2].at(-1)).toBe(2009);
  expect(graph({ ...d, time: undefined }, ['component:0'])).toBeNull();
  expect(
    graph(
      seriesDataset(
        'static',
        'Geometry',
        [],
        { components: 1, rate: 0, startTime: 0, values: new Float64Array([42]) },
        'mm',
        undefined,
        true,
      ),
      ['component:0'],
    ),
  ).toBeNull();
});

it('shares full lazy IK/ID reads, aligned crop descriptors and independent physical clocks', () => {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  data.source.info = {
    modelResults: {
      ik: {
        entries: [{ name: 'angle', sourceIndex: 1, unit: 'deg' }],
        samples: 405,
        timeBasis: 'trial-aligned',
        sourceRange: { start: 100, end: 305 },
        timeOrigin: 8,
      },
      id: { entries: [{ name: 'torque', sourceIndex: 1, unit: 'Nm' }], samples: 405 },
    },
  };
  const times = Float64Array.from({ length: 405 }, (_, i) => 7 + i / 100);
  const group = {
    get: (name: string) =>
      name === 'Time'
        ? { shape: [405], slice: ([[a, b]]: [number, number][]) => times.slice(a, b) }
        : name === 'Data'
          ? {
              shape: [2, 405],
              slice: ([[c], [a, b]]: [number, number][]) =>
                Float64Array.from({ length: b - a }, (_, i) => c * 1000 + a + i),
            }
          : undefined,
  };
  for (const id of ['ik:0', 'id:0']) {
    const d = explorerDatasets(data).find((d) => d.id === id)!;
    const model = d.model!;
    const s = readModelSeries(group, model);
    expect(s.values.length).toBe(model.aligned ? 205 : 405);
    expect(s.times?.[0]).toBe(model.aligned ? 0 : 7);
    expect(s.times?.at(-1)).toBe(model.aligned ? 7 + 304 / 100 - 8 : 7 + 404 / 100);
    expect(d.columns.find((c) => c.id === 'value')?.plot?.unit).toBe(model.unit);
    expect(d.columns.filter((c) => c.plot).map((c) => c.id)).toEqual(['value']);
    expect(cropPreviewInterval(data, { start: 1, end: 10 }, model.aligned)).toEqual(
      model.aligned ? expect.any(Object) : null,
    );
  }
});

it('retains separate Viewer/Explorer choices and leaves scientific/edit state unchanged', () => {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  setData(data);
  selectPlot('analog:0');
  const before = useSession.getState();
  useSession.setState({ explorerDataset: 'marker:0', explorerColumns: header(null, 'x') });
  const props = { data, collapsed: false, onToggle: () => {} };
  const explorer = renderToStaticMarkup(createElement(SignalPlot, { ...props, explorer: true }));
  expect(explorer).toContain('plot-column-label');
  expect(explorer).toContain('Reset zoom');
  expect(explorer).not.toContain('Signal to plot');
  expect(renderToStaticMarkup(createElement(SignalPlot, props))).toContain('Signal to plot');
  expect(useSession.getState().plot).toBe('analog:0');
  expect(useSession.getState().explorerColumns?.columns).toEqual(['x']);
  for (const key of ['data', 'originalData', 'history', 'dirty', 'cropSelection'] as const)
    expect(useSession.getState()[key]).toBe(before[key]);
  expect(
    graph(
      explorerDatasets(cropMotionData(data, 5, 10)).find((d) => d.id === 'marker:0')!,
      ['x'],
    )?.values[0],
  ).toHaveLength(5);
  setData(data);
  expect(useSession.getState().explorerColumns).toBeNull();
  expect(useSession.getState().explorerDataset).toBe('');
});

import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { modelPlotDescriptors, readModelSeries } from '../src/plots/modelSeries';
import { sampleTime } from '../src/explorer/datasets';
import { dataSections } from '../src/components/dataSections';
import { DataBrowser } from '../src/components/DataBrowser';
import { SignalPlot } from '../src/plots/SignalPlot';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { cropMotionData } from '../src/motion/crop';
import { setData, selectPlot, togglePlot, useSession } from '../src/state/session';
import { plotSeries } from '../src/plots/series';

function fixture() {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  data.source.info = {
    modelResults: {
      ik: {
        entries: [
          { name: 'time', sourceIndex: 0 },
          { name: 'knee_angle_r', unit: 'rad', sourceIndex: 1 },
        ].slice(1),
        samples: 405,
      },
      id: {
        entries: ['flexion', 'adduction', 'rotation'].map((name, i) => ({
          name,
          unit: 'N·mm',
          sourceIndex: i + 1,
        })),
        samples: 405,
      },
    },
  };
  return data;
}
function group(rate: number, explicit = true, origin = 7) {
  const n = 405;
  const times = Float64Array.from({ length: n }, (_, i) => origin + i / rate);
  return {
    attrs: {
      Labels: { value: ['time', 'flexion', 'adduction', 'rotation'] },
      SamplingFrequency: { value: rate },
    },
    get: (name: string) =>
      name === 'Time' && explicit
        ? { shape: [n], slice: ([[a, b]]: [number, number][]) => times.slice(a, b) }
        : name === 'Data'
          ? {
              shape: [4, n],
              slice: ([[c], [a, b]]: [number, number][]) =>
                c === 0
                  ? times.slice(a, b)
                  : Float64Array.from({ length: b - a }, (_, i) => c * 1000 + a + i),
            }
          : undefined,
  };
}

it('exposes scalar IK and separately named ID columns, units and stable source row identities', () => {
  const data = fixture();
  expect(modelPlotDescriptors(data)).toMatchObject([
    {
      id: 'ik:0',
      kind: 'ik',
      sourceIndex: 1,
      name: 'knee_angle_r',
      label: 'IK · knee_angle_r',
      unit: 'rad',
    },
    ...['flexion', 'adduction', 'rotation'].map((name, i) => ({
      id: `id:${i}`,
      kind: 'id',
      sourceIndex: i + 1,
      name,
      label: `ID · ${name}`,
      unit: 'N·mm',
    })),
  ]);
  for (const kind of ['ik', 'id'] as const) {
    const entries = dataSections(data).find(
      (s) => s.name === `${kind.toUpperCase()} results`,
    )!.entries;
    expect(entries.every((e) => e.plot === e.id)).toBe(true);
    const series = readModelSeries(group(kind === 'ik' ? 120 : 800), { kind, sourceIndex: 1 });
    expect(series.components).toBe(1);
    expect(series.values[404]).toBe(1404);
    expect(sampleTime(series, 404)).toBe(7 + 404 / (kind === 'ik' ? 120 : 800));
    // The existing crop policy keeps independent source-backed model data unchanged.
    const cropped = cropMotionData(data, 1, 2);
    expect(modelPlotDescriptors(cropped)).toEqual(modelPlotDescriptors(data));
    expect(sampleTime(series, 0)).toBe(7);
  }
});

it('uses explicit clocks before time rows, time rows before rates, and never marker indices', () => {
  const g = group(120);
  // A conflicting embedded time row must not override the explicit Time dataset.
  const originalGet = g.get;
  g.get = (name) => (name === 'Data' ? group(60, false, 99).get(name) : originalGet(name));
  const explicit = readModelSeries(g, { kind: 'ik', sourceIndex: 2 });
  const row = readModelSeries(group(800, false), { kind: 'id', sourceIndex: 3 });
  expect(sampleTime(explicit, 1)).toBe(7 + 1 / 120);
  expect(sampleTime(row, 1)).toBe(7 + 1 / 800);
  const regular = group(60, false);
  regular.attrs.Labels.value = ['one', 'two', 'three', 'four'];
  const series = readModelSeries(regular, { kind: 'ik', sourceIndex: 1 });
  expect(sampleTime(series, 1)).toBe(1 / 60);
  const data = fixture();
  expect(plotSeries(data, 'analog:0', 0).values[0][1]).toBe(1 / data.analogs[0].signal.rate);
  expect(data.timeline.rate).not.toBe(120);
  expect(data.timeline.rate).not.toBe(800);
});

it('reports missing and invalid clocks, including across page boundaries', () => {
  const g = group(120, false);
  g.attrs.Labels.value = ['one', 'two', 'three', 'four'];
  g.attrs.SamplingFrequency.value = NaN;
  expect(() => readModelSeries(g, { kind: 'id', sourceIndex: 1 })).toThrow('no physical time');
  const broken = group(120);
  const get = broken.get;
  broken.get = (name) =>
    name === 'Time'
      ? {
          shape: [405],
          slice: ([[a, b]]) => Float64Array.from({ length: b - a }, (_, i) => i / 120),
        }
      : get(name);
  expect(() => readModelSeries(broken, { kind: 'ik', sourceIndex: 1 })).toThrow(
    'strictly increasing',
  );
});

it('reuses the established unit policy without converting model values', () => {
  const data = fixture();
  data.source.info!.modelResults!.ik = {
    inDegrees: false,
    entries: [
      { name: 'knee_angle_r', coordinateType: 'rotation' },
      { name: 'pelvis_tx', coordinateType: 'translation' },
      { name: 'custom', unit: 'm' },
    ],
  };
  expect(
    modelPlotDescriptors(data)
      .filter((d) => d.kind === 'ik')
      .map((d) => d.unit),
  ).toEqual(['rad', 'unknown', 'm']);
  delete data.source.info!.modelResults!.id!.entries![0].unit;
  expect(modelPlotDescriptors(data).find((d) => d.id === 'id:0')!.unit).toBe('unknown');
  expect(readModelSeries(group(120), { kind: 'ik', sourceIndex: 1 }).values[0]).toBe(1000);
});

it('omits absent/empty categories and renders common IK/ID selection controls', () => {
  const data = fixture();
  setData(data);
  useSession.setState({ search: 'knee_angle' });
  const sidebar = renderToStaticMarkup(createElement(DataBrowser, { data }));
  expect(sidebar).toContain('IK results');
  expect(sidebar).toContain('ID results');
  const plot = renderToStaticMarkup(
    createElement(SignalPlot, { data, collapsed: false, onToggle: () => {} }),
  );
  expect(plot).toContain('label="IK Results"');
  expect(plot).toContain('label="ID Results"');
  expect(plot).toContain('ID · adduction');
  data.source.info = { modelResults: { ik: { entries: [] } } };
  expect(modelPlotDescriptors(data)).toMatchObject([]);
  expect(dataSections(data).some((s) => /results/.test(s.name))).toBe(false);
});

it('selects, switches between model/existing signals and deselects without scientific edits', () => {
  const data = fixture();
  setData(data);
  const before = useSession.getState();
  for (const selection of ['ik:0', 'id:2', 'analog:0']) {
    selectPlot(selection);
    expect(useSession.getState().plot).toBe(selection);
    togglePlot(selection);
    expect(useSession.getState().plot).toBe('none');
  }
  const after = useSession.getState();
  expect(after.data).toBe(data);
  expect(after.dirty).toBe(before.dirty);
  expect(after.history).toBe(before.history);
  expect(after.cropSelection).toBe(before.cropSelection);
  expect(after.originalData).toBe(before.originalData);
});

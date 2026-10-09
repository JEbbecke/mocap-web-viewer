import { expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import { modelTrialAligned, modelTimeTolerance } from '../src/motion/modelTiming';
import { parseH5Tree } from '../src/importers/h5/schema';
import { cropMotionData } from '../src/motion/crop';
import { readModelSeries, modelPlotDescriptors } from '../src/plots/modelSeries';
import { readModelPage } from '../src/explorer/modelPage';
import { readModelText } from '../src/explorer/modelCopy';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { explorerDatasets } from '../src/explorer/datasets';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { SignalSelector } from '../src/plots/SignalSelector';

const trial = { count: 10, rate: 100, startTime: 7, firstFrame: 700 };
const times = Float64Array.from({ length: 10 }, (_, i) => 7 + i / 100);
function clockGroup(clock: Float64Array = times, rate?: number, frames?: number) {
  return {
    attrs: {
      ...(rate === undefined ? {} : { SamplingFrequency: { value: rate } }),
      ...(frames === undefined
        ? {}
        : { StartFrame: { value: frames }, EndFrame: { value: frames + clock.length - 1 } }),
    },
    get: (name: string) =>
      name === 'Time'
        ? { shape: [clock.length], value: clock }
        : name === 'Data'
          ? { shape: [1, clock.length] }
          : undefined,
  };
}

it('proves aligned physical clocks and tolerates only numerical reconstruction noise', () => {
  expect(modelTrialAligned(clockGroup(), trial)).toBe(true);
  expect(
    modelTrialAligned(
      clockGroup(
        Float64Array.from(times, (_, i) => (700 + i) / 100),
        100,
        700,
      ),
      trial,
    ),
  ).toBe(true);
  expect(
    modelTrialAligned(
      clockGroup(Float64Array.from(times, (t) => t + modelTimeTolerance(100) / 2)),
      trial,
    ),
  ).toBe(true);
  expect(modelTrialAligned(clockGroup(times, 100, 701), trial)).toBe(false);
  const group = clockGroup(times, 100, 700);
  expect(
    modelTrialAligned({ ...group, attrs: { ...group.attrs, EndFrame: { value: 710 } } }, trial),
  ).toBe(false);
  expect(
    modelTrialAligned({ ...group, attrs: { ...group.attrs, FrameStep: { value: 2 } } }, trial),
  ).toBe(false);
});

it('rejects shifted, irregular, mismatched count/rate and unknown clocks', () => {
  for (const clock of [
    Float64Array.from(times, (t) => t + 0.01),
    Float64Array.from(times, (t) => t + 0.002),
    times.slice(0, 9),
    Float64Array.from({ length: 20 }, (_, i) => 7 + (i * 0.09) / 19),
  ]) {
    expect(modelTrialAligned(clockGroup(clock), trial)).toBe(false);
  }
  const irregular = times.slice();
  irregular[4] += 0.001;
  expect(modelTrialAligned(clockGroup(irregular), trial)).toBe(false);
  expect(modelTrialAligned(clockGroup(times, 120), trial)).toBe(false);
  expect(
    modelTrialAligned({ get: (name) => (name === 'Data' ? { shape: [1, 10] } : undefined) }, trial),
  ).toBe(false);
});

const folder = resolve('.local/model-timing-tests');
mkdirSync(folder, { recursive: true });
async function fixture(
  mode: 'explicit' | 'row' | 'rate',
  independentID = false,
  implicitZero = false,
) {
  await h5.ready;
  const file = new h5.File(resolve(folder, `${mode}-${independentID}-${implicitZero}.h5`), 'w');
  file.create_group('MetaData').create_group('Project');
  const trajectory = file.create_group('Trajectories');
  trajectory.create_attribute('SamplingFrequency', 100);
  trajectory.create_attribute('StartFrame', implicitZero ? 0 : 700);
  trajectory.create_attribute('EndFrame', implicitZero ? 9 : 709);
  const labeled = trajectory.create_group('Labeled');
  labeled.create_attribute('Labels', ['Synthetic']);
  labeled.create_attribute('Unit', 'mm');
  labeled.create_dataset({ name: 'Data', data: new Float64Array(40).fill(1), shape: [1, 4, 10] });
  const markerTimes = implicitZero ? Float64Array.from(times, (_, i) => i / 100) : times;
  labeled.create_dataset({ name: 'Time', data: markerTimes });
  for (const kind of ['ik', 'id'] as const) {
    const group = file.create_group(kind === 'ik' ? 'IKResults' : 'IDResults');
    const columns = mode === 'row' ? 3 : 2;
    const clock =
      independentID && kind === 'id' ? Float64Array.from(times, (t) => t + 0.01) : markerTimes;
    const values = Float64Array.from({ length: columns * 10 }, (_, i) =>
      mode === 'row' && i < 10 ? clock[i] : i,
    );
    group.create_attribute(
      'Labels',
      mode === 'row' ? ['time', 'flexion', 'adduction'] : ['flexion', 'adduction'],
    );
    group.create_attribute(
      'Units',
      mode === 'row'
        ? ['s', kind === 'ik' ? 'deg' : 'Nm', kind === 'ik' ? 'deg' : 'Nm']
        : [kind === 'ik' ? 'deg' : 'Nm', kind === 'ik' ? 'deg' : 'Nm'],
    );
    group.create_attribute('NumSamples', 10);
    group.create_attribute('SamplingFrequency', 100);
    if (!implicitZero) {
      group.create_attribute('StartFrame', 700);
      group.create_attribute('EndFrame', 709);
    }
    group.create_dataset({ name: 'Data', data: values, shape: [columns, 10] });
    if (mode === 'explicit') group.create_dataset({ name: 'Time', data: clock });
  }
  return file;
}

for (const mode of ['explicit', 'row', 'rate'] as const) {
  it(`crops/reimports aligned IK and ID with ${mode} clocks, preserving raw columns and metadata`, async () => {
    const source = await fixture(mode);
    try {
      const data = parseH5Tree(source, 'synthetic.h5');
      expect(data.source.info!.modelResults!.ik!.timeBasis).toBe('trial-aligned');
      expect(data.source.info!.modelResults!.id!.timeBasis).toBe('trial-aligned');
      for (const [start, end] of [
        [2, 10],
        [0, 7],
        [2, 7],
        [4, 5],
      ]) {
        const cropped = cropMotionData(data, start, end);
        const output = createH5Output(h5, source, resolve(folder, `${mode}-${start}-${end}.h5`));
        try {
          writeCroppedH5(h5, source, output, start, end);
          const reimported = parseH5Tree(output, 'cropped.h5');
          for (const kind of ['ik', 'id'] as const) {
            const descriptor = modelPlotDescriptors(cropped).find((d) => d.kind === kind)!;
            const request = {
              kind,
              sourceIndex: descriptor.sourceIndex,
              range: descriptor.range,
              timeOrigin: descriptor.timeOrigin,
            };
            const group = source.get(kind === 'ik' ? 'IKResults' : 'IDResults') as h5.Group;
            const series = readModelSeries(group, request);
            expect(series.values.length).toBe(end - start);
            expect(series.times![0]).toBeCloseTo(0, 12);
            expect(series.times!.at(-1)).toBeCloseTo((end - start - 1) / 100, 12);
            const result = reimported.source.info!.modelResults![kind]!;
            expect(result.timeBasis).toBe('trial-aligned');
            expect(result.samples).toBe(end - start);
            expect(result.entries).toEqual(data.source.info!.modelResults![kind]!.entries);
            const exportedGroup = output.get(kind === 'ik' ? 'IKResults' : 'IDResults') as h5.Group;
            const roundtrip = readModelSeries(exportedGroup, {
              kind,
              sourceIndex: descriptor.sourceIndex,
              range: result.sourceRange,
              timeOrigin: result.timeOrigin,
            });
            expect(roundtrip.values).toEqual(series.values);
            expect(roundtrip.times).toEqual(series.times);
            expect(exportedGroup.attrs.StartFrame.value).toBe(700 + start);
            expect(exportedGroup.attrs.EndFrame.value).toBe(700 + end - 1);
            expect(exportedGroup.attrs.NumSamples.value).toBe(end - start);
            // Every retained column, including an embedded time row, is sliced.
            const raw = group.get('Data') as h5.Dataset;
            expect((exportedGroup.get('Data') as h5.Dataset).value).toEqual(
              raw.slice([
                [0, raw.shape![0]],
                [start, end],
              ]),
            );
            const page = readModelPage(group, { ...request, offset: 0 });
            expect(page.total).toBe(end - start);
            expect(page.sourceOffset).toBe(start);
            expect(
              readModelText(group, { ...request, offset: 0 }, [
                'Sample',
                'Source',
                'Time',
                'Value',
              ]).split('\n'),
            ).toHaveLength(end - start + 1);
          }
          const twice = cropMotionData(cropped, 0, 1);
          expect(twice.source.info!.modelResults!.ik!.sourceRange).toEqual({
            start,
            end: start + 1,
          });
        } finally {
          output.close();
        }
      }
    } finally {
      source.close();
    }
  });
}

it('classifies IK and ID separately, retaining independent data through crop/export', async () => {
  const source = await fixture('explicit', true);
  const output = createH5Output(h5, source, resolve(folder, 'mixed-crop.h5'));
  try {
    const data = parseH5Tree(source, 'mixed.h5');
    expect(data.source.info!.modelResults!.ik!.timeBasis).toBe('trial-aligned');
    expect(data.source.info!.modelResults!.id!.timeBasis).toBe('independent');
    const cropped = cropMotionData(data, 2, 7);
    expect(cropped.source.info!.modelResults!.id).toBe(data.source.info!.modelResults!.id);
    const ik = explorerDatasets(cropped).find((d) => d.id === 'ik:0')!;
    const id = explorerDatasets(cropped).find((d) => d.id === 'id:0')!;
    expect(ik.count).toBe(5);
    expect(ik.model!.aligned).toBe(true);
    expect(id.count).toBe(10);
    expect(id.model!.aligned).toBe(false);
    writeCroppedH5(h5, source, output, 2, 7);
    expect((output.get('IDResults/Data') as h5.Dataset).value).toEqual(
      (source.get('IDResults/Data') as h5.Dataset).value,
    );
    expect((output.get('IDResults/Time') as h5.Dataset).value).toEqual(
      (source.get('IDResults/Time') as h5.Dataset).value,
    );
    expect((output.get('IDResults') as h5.Group).attrs.NumSamples.value).toBe(10);
  } finally {
    output.close();
    source.close();
  }
});

it('uses a compact single-line selector with a full-label tooltip', () => {
  const html = renderToStaticMarkup(
    createElement(
      SignalSelector,
      { label: 'Signal', value: 'id:0', onChange: () => {}, children: undefined },
      createElement(
        'optgroup',
        { label: 'ID Results' },
        createElement('option', { value: 'id:0' }, 'ID · long_model_variable · Nm'),
      ),
    ),
  );
  expect(html).toContain('class="signal-selector-trigger"');
  expect(html).toContain('title="ID · long_model_variable · Nm"');
});

it('preserves the physical crop origin for rate-only clocks without frame metadata', async () => {
  const source = await fixture('rate', false, true);
  const output = createH5Output(h5, source, resolve(folder, 'implicit-zero-cropped.h5'));
  try {
    const data = parseH5Tree(source, 'implicit.h5');
    expect(data.source.info!.modelResults!.ik!.timeBasis).toBe('trial-aligned');
    writeCroppedH5(h5, source, output, 2, 6);
    expect((output.get('IKResults/Time') as h5.Dataset).value).toEqual(
      Float64Array.from([0.02, 0.03, 0.04, 0.05]),
    );
    const reimported = parseH5Tree(output, 'cropped.h5');
    expect(reimported.source.info!.modelResults!.ik!.timeBasis).toBe('trial-aligned');
    expect(reimported.source.info!.modelResults!.id!.timeBasis).toBe('trial-aligned');
    expect(reimported.source.info!.modelResults!.ik!.samples).toBe(4);
  } finally {
    output.close();
    source.close();
  }
});

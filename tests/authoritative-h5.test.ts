import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as h5 from 'h5wasm/node';
import fixture from './fixtures/institute-h5.json';
import booleanSeeds from '../src/exporters/h5-boolean-seeds.json';
import { parseH5Tree } from '../src/importers/h5/schema';
import { writeCroppedH5, createH5Output } from '../src/exporters/h5';
import { cropMotionData } from '../src/motion/crop';
import {
  addEvent,
  updateEvent,
  deleteEvent,
  eventEditingAvailable,
  timelineEvents,
} from '../src/motion/events';
import { sample } from '../src/motion/math';

const folder = resolve('.local/h5-validation');
mkdirSync(folder, { recursive: true });
const synthetic = resolve(folder, 'synthetic.h5');
writeFileSync(synthetic, Buffer.from(fixture.base64, 'base64'));
const reference = resolve('reference-data/authoritative_reference.h5');
const ds = (f: h5.Group, path: string) => f.get(path) as h5.Dataset;

function compareTree(a: h5.Group, b: h5.Group, ignore: (path: string) => boolean = () => false) {
  expect(b.keys(), a.path).toEqual(a.keys());
  function attributes(x: h5.Group | h5.Dataset, y: h5.Group | h5.Dataset) {
    expect(Object.keys(y.attrs)).toEqual(Object.keys(x.attrs));
    for (const [key, v] of Object.entries(x.attrs)) {
      expect(y.attrs[key].dtype, `${x.path}@${key}`).toEqual(v.dtype);
      expect(y.attrs[key].shape).toEqual(v.shape);
      expect(y.attrs[key].value).toEqual(v.value);
    }
  }
  attributes(a, b);
  for (const key of a.keys()) {
    const x = a.get(key)!,
      y = b.get(key)!;
    if (ignore((x as h5.Dataset).path)) continue;
    if (x instanceof h5.Group) compareTree(x, y as h5.Group, ignore);
    else if (x instanceof h5.Dataset) {
      const z = y as h5.Dataset;
      expect(z.shape, x.path).toEqual(x.shape);
      expect(z.dtype, x.path).toEqual(x.dtype);
      expect(z.metadata.enum_type, x.path).toEqual(x.metadata.enum_type);
      expect(z.value, x.path).toEqual(x.value);
      attributes(x, z);
    }
  }
}

describe.each([
  ['synthetic', synthetic],
  ['authoritative', reference],
])('%s complete H5 lifecycle', (label, path) => {
  it.skipIf(!existsSync(path))(
    'imports all domains, edits events, crops and reopens without unrelated value loss',
    async () => {
      await h5.ready;
      const before = readFileSync(path),
        input = new h5.File(path, 'r');
      try {
        const motion = parseH5Tree(input, 'local.h5');
        expect(eventEditingAvailable(motion)).toBe(true);
        expect(motion.source.timeOrigin).toBeCloseTo(
          motion.timeline.firstFrame / motion.timeline.rate,
          10,
        );
        expect(motion.markers.positions).toBeInstanceOf(Float64Array);
        expect(motion.markers.quality?.cameraCount).toBeGreaterThan(0);
        expect(motion.forcePlatforms).not.toHaveLength(0);
        expect(motion.forcePlatforms[0].freeMoment?.components).toBe(3);
        expect(motion.forcePlatforms[0].corners).toBeDefined();
        expect(motion.rigidBodies).not.toHaveLength(0);
        expect(new Set(motion.signals?.map((s) => s.group))).toEqual(
          new Set(['EMG', 'RigidBodies']),
        );
        expect(motion.warnings.filter((w) => /IKResults|IDResults/.test(w))).toEqual([]);
        expect(motion.source.metadata.sourceTree).toBeDefined();
        expect(timelineEvents(motion).length).toBeGreaterThan(0);
        const frameCount = motion.timeline.frameCount,
          markerCount = motion.markers.labels.length;
        const rawPoints = ds(input, 'Trajectories/Labeled/Data').value as Float64Array;
        let markerError = 0;
        for (let f = 0; f < frameCount; f++)
          for (let m = 0; m < markerCount; m++)
            for (let a = 0; a < 3; a++) {
              const expected = rawPoints[(m * 4 + a) * frameCount + f] * 0.001;
              const actual = motion.markers.positions[(f * markerCount + m) * 3 + a];
              if (Number.isNaN(expected)) expect(actual).toBeNaN();
              else markerError = Math.max(markerError, Math.abs(actual - expected));
            }
        expect(markerError).toBe(0);
        motion.forcePlatforms.forEach((plate, p) => {
          for (const [field, signal, scale] of [
            ['Force', plate.force, 1],
            ['Moment', plate.moment, 0.001],
            ['COP', plate.cop, 0.001],
            ['Tz', plate.freeMoment!, 0.001],
          ] as const) {
            const raw = ds(input, `ForcePlates/${p}/${field}`).value as Float64Array,
              n = raw.length / 3;
            let error = 0;
            for (let f = 0; f < n; f++)
              for (let a = 0; a < 3; a++)
                error = Math.max(
                  error,
                  Math.abs(signal.values[f * 3 + a] - raw[a * n + f] * scale),
                );
            expect(error, field).toBe(0);
            // Explicit timestamps synchronize each marker sample to eight/two force samples.
            const ratio = signal.rate / motion.timeline.rate;
            for (let f = 0; f < frameCount; f++)
              for (let a = 0; a < 3; a++)
                expect(sample(signal, f / motion.timeline.rate, a)).toBeCloseTo(
                  raw[a * n + f * ratio] * scale,
                  8,
                );
          }
        });
        if (label === 'synthetic') {
          expect(motion.markers.valid[2]).toBe(1); // unknown residual is not invalid
          expect(motion.markers.valid[5]).toBe(0);
          expect(motion.events[1].description).toBe(' keep spaces ');
        }

        const noOp = createH5Output(h5, input, resolve(folder, `${label}-reconstructed.h5`));
        try {
          writeCroppedH5(h5, input, noOp, 0, motion.timeline.frameCount);
          compareTree(input, noOp);
        } finally {
          noOp.close();
        }

        const changed = updateEvent(motion, 0, {
          ...motion.events[0],
          label: 'Edited synthetic label',
          description: 'Edited description',
          time: 0.3,
        });
        const edited = createH5Output(h5, input, resolve(folder, `${label}-edited.h5`));
        try {
          writeCroppedH5(h5, input, edited, 0, motion.timeline.frameCount, changed.events);
          compareTree(input, edited, (path) => path.startsWith('/Events/'));
          const reopened = parseH5Tree(edited, 'edited.h5');
          expect(
            reopened.events.find((e) => e.label === 'Edited synthetic label')?.time,
          ).toBeCloseTo(0.3, 12);
          expect(reopened.events).toHaveLength(motion.events.length);
        } finally {
          edited.close();
        }

        const start = 1,
          end = Math.min(6, motion.timeline.frameCount);
        const expected = cropMotionData(motion, start, end);
        const cropped = createH5Output(h5, input, resolve(folder, `${label}-cropped.h5`));
        try {
          writeCroppedH5(h5, input, cropped, start, end);
          const reopened = parseH5Tree(cropped, 'cropped.h5');
          expect(reopened.timeline).toEqual(expected.timeline);
          expect(reopened.markers).toEqual(expected.markers);
          expect(reopened.analogs[0].signal.values).toEqual(expected.analogs[0].signal.values);
          expect(reopened.forcePlatforms[0].force.values).toEqual(
            expected.forcePlatforms[0].force.values,
          );
          expect(reopened.forcePlatforms[0].freeMoment?.values).toEqual(
            expected.forcePlatforms[0].freeMoment?.values,
          );
          expect(reopened.rigidBodies?.[0].position.values).toEqual(
            expected.rigidBodies?.[0].position.values,
          );
          expect(reopened.events.map((e) => e.label)).toEqual(expected.events.map((e) => e.label));
          reopened.events.forEach((e, i) =>
            expect(e.time).toBeCloseTo(expected.events[i].time, 12),
          );
          expect(ds(cropped, 'Trajectories/Labeled/Time').value).toEqual(
            ds(input, 'Trajectories/Labeled/Time').slice([[start, end]]),
          );
          expect(ds(cropped, 'ForcePlates/0/Origin').value).toEqual(
            ds(input, 'ForcePlates/0/Origin').value,
          );
          expect(ds(cropped, 'RigidBodies/0/Markers').value).toEqual(
            ds(input, 'RigidBodies/0/Markers').value,
          );
          compareTree(input.get('MetaData') as h5.Group, cropped.get('MetaData') as h5.Group);
          for (const group of ['IKResults', 'IDResults']) {
            expect(reopened.signals!.filter((s) => s.group === group)).toEqual([]);
            const sourceTimes = ds(input, `${group}/Time`).value as Float64Array;
            const wanted = sourceTimes.filter(
              (t) =>
                t >= motion.source.timeOrigin! + start / motion.timeline.rate - 1e-9 &&
                t < motion.source.timeOrigin! + end / motion.timeline.rate - 1e-9,
            );
            expect(ds(cropped, `${group}/Time`).value).toEqual(wanted);
          }
        } finally {
          cropped.close();
        }

        const added = addEvent(deleteEvent(changed, 0), {
          label: 'Added',
          context: '',
          description: 'New',
          time: 0.2,
        });
        const finalData = cropMotionData(added, 0, Math.min(6, motion.timeline.frameCount));
        const final = createH5Output(h5, input, resolve(folder, `${label}-edit-crop.h5`));
        try {
          writeCroppedH5(h5, input, final, 0, finalData.timeline.frameCount, finalData.events);
          const reopened = parseH5Tree(final, 'final.h5');
          expect(reopened.events.map((e) => e.label)).toEqual(finalData.events.map((e) => e.label));
        } finally {
          final.close();
        }
        // Retain real source events through repeated crops, then edit in cropped time.
        const first = cropMotionData(motion, 1, motion.timeline.frameCount);
        const window = cropMotionData(
          first,
          Math.floor(first.timeline.frameCount / 4),
          Math.ceil((first.timeline.frameCount * 3) / 4),
        );
        expect(window.events.length).toBeGreaterThan(0);
        const windowEdit = updateEvent(window, 0, {
          ...window.events[0],
          description: 'Edited after repeated crop',
        });
        const windowOutput = createH5Output(h5, input, resolve(folder, `${label}-event-window.h5`));
        try {
          writeCroppedH5(
            h5,
            input,
            windowOutput,
            windowEdit.source.crop!.start,
            windowEdit.source.crop!.end,
            windowEdit.events,
          );
          const reopened = parseH5Tree(windowOutput, 'window.h5');
          expect(reopened.events.map((e) => e.label)).toEqual(
            windowEdit.events.map((e) => e.label),
          );
          reopened.events.forEach((e, i) =>
            expect(e.time).toBeCloseTo(windowEdit.events[i].time, 12),
          );
          expect(reopened.events[0].description).toBe('Edited after repeated crop');
          const rawFrames = ds(input, 'Events/Frame').value as BigInt64Array;
          expect(ds(windowOutput, 'Events/Frame').value).toEqual(
            BigInt64Array.from(windowEdit.events.map((e) => rawFrames[e.sourceIndex!])),
          );
        } finally {
          windowOutput.close();
        }
        expect(readFileSync(path)).toEqual(before);
      } finally {
        input.close();
      }
    },
  );
});

it('interpolates and crops irregular clocks using physical time', () => {
  const s = {
    values: new Float64Array([0, 10, 20]),
    times: new Float64Array([0.1, 0.3, 0.8]),
    components: 1,
    startTime: 0.1,
    rate: 4,
  };
  expect(sample(s, 0.2)).toBeCloseTo(5);
  expect(sample(s, 0.55)).toBeCloseTo(15);
  expect(sample(s, 0)).toBeNaN();
});

it('preserves every optional combination of boolean fields without adding absent datasets', async () => {
  await h5.ready;
  for (const [bits, encoded] of Object.entries(booleanSeeds)) {
    const path = resolve(folder, `seed-${bits}.h5`);
    writeFileSync(path, Buffer.from(encoded, 'base64'));
    const input = new h5.File(path, 'r'),
      output = createH5Output(h5, input, resolve(folder, `seed-${bits}-out.h5`));
    try {
      compareTree(input, output);
    } finally {
      output.close();
      input.close();
    }
  }
});

it('supports missing optional groups and preserves opaque content in edited exports', async () => {
  await h5.ready;
  const path = resolve(folder, 'optional.h5');
  writeFileSync(path, readFileSync(synthetic));
  const input = new h5.File(path, 'a');
  try {
    const hidden = [
      'Events',
      'Analog',
      'EMG',
      'IKResults',
      'IDResults',
      'RigidBodies',
      'ForcePlates',
      'Trajectories/Labeled/Residuals',
      'Trajectories/Labeled/CameraMasks',
    ];
    const minimal = parseH5Tree(
      {
        get: (path) =>
          hidden.some((p) => path === p || path.startsWith(p + '/')) ? null : input.get(path),
      },
      'minimal.h5',
    );
    expect(minimal.events).toEqual([]);
    expect(minimal.analogs).toEqual([]);
    expect(minimal.forcePlatforms).toEqual([]);
    expect(minimal.signals).toEqual([]);
    const custom = input.get('CustomFields') as h5.Group;
    custom.create_dataset({
      name: 'UnknownScientificArray',
      shape: [2],
      data: new Float64Array([1.1234567890123, Number.NaN]),
    });
    custom.create_attribute('Unicode', 'αβγ');
    const scalar = custom.create_dataset({ name: 'Scalar', shape: [], data: 42, dtype: '<h' });
    scalar.create_attribute('Unit', 'opaque');
    const motion = parseH5Tree(input, 'opaque.h5');
    const changed = updateEvent(motion, 1, { ...motion.events[1], description: 'Updated' });
    const output = createH5Output(h5, input, resolve(folder, 'unknown-edited.h5'));
    try {
      writeCroppedH5(h5, input, output, 0, motion.timeline.frameCount, changed.events);
      compareTree(custom, output.get('CustomFields') as h5.Group);
    } finally {
      output.close();
    }
    const rejected = createH5Output(h5, input, resolve(folder, 'unknown-crop.h5'));
    try {
      expect(() => writeCroppedH5(h5, input, rejected, 1, 5)).toThrow('timing is undocumented');
    } finally {
      rejected.close();
    }
    expect(() =>
      parseH5Tree(
        {
          get: (path) => (path === 'Trajectories/Labeled' ? { get: () => null } : input.get(path)),
        },
        'invalid.h5',
      ),
    ).toThrow('missing Data');
  } finally {
    input.close();
  }
});

it('retains unknown event columns through edits/deletion and refuses fabricated metadata on add', async () => {
  await h5.ready;
  const path = resolve(folder, 'event-extra.h5');
  writeFileSync(path, readFileSync(synthetic));
  const input = new h5.File(path, 'a');
  try {
    const group = input.get('Events') as h5.Group;
    group.create_dataset({ name: 'VendorCode', data: new Int16Array([10, 20, 30]), shape: [3] });
    const motion = parseH5Tree(input, 'events.h5');
    const changed = deleteEvent(motion, 0);
    const output = createH5Output(h5, input, resolve(folder, 'event-extra-edited.h5'));
    try {
      writeCroppedH5(h5, input, output, 0, motion.timeline.frameCount, changed.events);
      expect(ds(output, 'Events/VendorCode').value).toEqual(new Int16Array([20, 30]));
    } finally {
      output.close();
    }
    const rejected = createH5Output(h5, input, resolve(folder, 'event-extra-rejected.h5'));
    try {
      expect(() =>
        writeCroppedH5(
          h5,
          input,
          rejected,
          0,
          motion.timeline.frameCount,
          addEvent(motion, { label: 'New', context: '', time: 0.1 }).events,
        ),
      ).toThrow('cannot invent metadata');
    } finally {
      rejected.close();
    }
  } finally {
    input.close();
  }
});

import { expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as h5 from 'h5wasm/node';
import fixture from './fixtures/current-h5.json';
import { parseH5Tree } from '../src/importers/h5/schema';
import { createH5Output, writeCroppedH5 } from '../src/exporters/h5';
import { cropMotionData } from '../src/motion/crop';
import { sample } from '../src/motion/math';
import {
  eventContextAvailable,
  eventEditingAvailable,
  addEvent,
  deleteEvent,
  updateEvent,
} from '../src/motion/events';
import {
  setData,
  renameSessionMarker,
  editSessionEvent,
  undoEdit,
  redoEdit,
  useSession,
} from '../src/state/session';
import { fileInfoSections } from '../src/components/fileInfoSections';
import { dataSections } from '../src/components/dataSections';
import type { MotionData } from '../src/motion/types';

const folder = resolve('.local/h5-validation');
mkdirSync(folder, { recursive: true });
const synthetic = resolve(folder, 'current-synthetic.h5');
writeFileSync(synthetic, Buffer.from(fixture.base64, 'base64'));
const reference = resolve('reference-data/authoritative_reference.h5');
const dataset = (file: h5.Group, path: string) => file.get(path) as h5.Dataset;

/** Only booleans/path descriptions reach assertions: private contents never enter failure logs. */
function compare(
  source: h5.Group | h5.Dataset,
  output: h5.Group | h5.Dataset,
  expected?: (entity: h5.Group | h5.Dataset, key?: string) => unknown,
) {
  expect(
    isDeepStrictEqual(Object.keys(source.attrs), Object.keys(output.attrs)),
    `${source.path}: attribute keys`,
  ).toBe(true);
  for (const [key, attr] of Object.entries(source.attrs)) {
    const other = output.attrs[key];
    const descriptor = (metadata: h5.Attribute['metadata']) => ({
      ...metadata,
      // VLEN string padding is unused; h5wasm writes SPACEPAD instead of NULLTERM.
      ...(metadata.vlen ? { strpad: undefined } : {}),
    });
    expect(
      isDeepStrictEqual(descriptor(attr.metadata), descriptor(other.metadata)),
      `${source.path}@${key}: dtype/shape`,
    ).toBe(true);
    const wanted = expected?.(source, key) ?? attr.value;
    expect(isDeepStrictEqual(wanted, other.value), `${source.path}@${key}: values`).toBe(true);
  }
  if (source instanceof h5.Group && output instanceof h5.Group) {
    expect(isDeepStrictEqual(source.keys(), output.keys()), `${source.path}: child paths`).toBe(
      true,
    );
    for (const key of source.keys())
      compare(
        source.get(key) as h5.Group | h5.Dataset,
        output.get(key) as h5.Group | h5.Dataset,
        expected,
      );
  } else if (source instanceof h5.Dataset && output instanceof h5.Dataset) {
    const wanted = expected?.(source) ?? source.value;
    expect(source.dtype === output.dtype, `${source.path}: dtype`).toBe(true);
    expect(isDeepStrictEqual(source.shape, output.shape), `${source.path}: shape`).toBe(true);
    expect(
      isDeepStrictEqual(source.metadata.enum_type, output.metadata.enum_type),
      `${source.path}: enum`,
    ).toBe(true);
    expect(isDeepStrictEqual(wanted, output.value), `${source.path}: shape/values`).toBe(true);
  } else throw new Error(`${source.path}: object kind changed.`);
}

async function withSynthetic(action: (file: h5.File, motion: MotionData) => void) {
  await h5.ready;
  const file = new h5.File(synthetic, 'r');
  try {
    action(file, parseH5Tree(file, 'synthetic.h5'));
  } finally {
    file.close();
  }
}
function output(
  input: h5.File,
  motion: MotionData,
  suffix: string,
  start = 0,
  end = motion.timeline.frameCount,
  events?: MotionData['events'],
  labels?: string[],
) {
  const file = createH5Output(h5, input, resolve(folder, `${suffix}.h5`));
  try {
    writeCroppedH5(h5, input, file, start, end, events, motion, labels);
  } catch (error) {
    file.close();
    throw error;
  }
  return file;
}

it('imports nested metadata, expanded events and semantic EMG without duplicated signal arrays', async () => {
  await withSynthetic((file, motion) => {
    expect(motion.source.h5Layout).toBe('institute-current');
    expect(eventEditingAvailable(motion)).toBe(true);
    expect(eventContextAvailable(motion)).toBe(true);
    expect(motion.timeline).toEqual({ frameCount: 8, rate: 4, firstFrame: 8, duration: 1.75 });
    expect(motion.markers.quality?.cameraCount).toBe(0);
    expect(motion.markers.valid[2]).toBe(1);
    expect(motion.markers.valid[5]).toBe(0);
    expect(motion.events[1]).toMatchObject({
      context: 'Right',
      subject: 'Synthetic',
      sourceFrame: 9,
      genericFlag: 1,
      iconId: 3,
    });
    const emg = motion.signals!.find((s) => s.group === 'EMG')!;
    expect(emg.analogIndex).toBe(0);
    expect(emg.signal).toBe(motion.analogs[0].signal);
    const info = Object.fromEntries(
      fileInfoSections(motion).flatMap((s) => s.rows.map((r) => [r.label, r.values])),
    );
    expect(info['Subject ID']).toEqual(['SYNTHETIC']);
    expect(info['Date']).toEqual(['2026-01-01 12:00:00']);
    expect(info['Project']).toEqual(['Synthetic']);
    expect(motion.source.info?.modelResults?.ik).toMatchObject({
      samples: 4,
      inDegrees: true,
      timeBasis: 'independent',
    });
    expect(motion.source.info?.modelResults?.ik?.entries?.[0].unit).toBeUndefined();
    expect(dataSections(motion).map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'Markers',
        'Analog channels',
        'Force platforms',
        'Events',
        'Rigid bodies',
        'EMG channels',
        'IK results',
        'ID results',
      ]),
    );
    const noOp = output(file, motion, 'current-reconstructed');
    try {
      compare(file, noOp);
    } finally {
      noOp.close();
    }
  });
});

it('round trips marker history, membership and provenance label aliases without changing scientific samples', async () => {
  await withSynthetic((file, motion) => {
    setData(motion);
    renameSessionMarker(0, 'Renamed synthetic marker');
    for (const expectedLabel of ['Renamed synthetic marker', 'A', 'Renamed synthetic marker']) {
      const changed = useSession.getState().data!;
      const exported = output(
        file,
        motion,
        'current-renamed',
        0,
        8,
        undefined,
        changed.markers.labels,
      );
      try {
        const reopened = parseH5Tree(exported, 'renamed.h5');
        expect(reopened.markers.labels[0]).toBe(expectedLabel);
        expect(reopened.rigidBodies![0].markers[0]).toBe(expectedLabel);
        expect(changed.rigidBodies![0].markers[0]).toBe(expectedLabel);
        compare(file, exported, (entity, key) => {
          if (
            (entity.path === '/Trajectories/Labeled' && key === 'Labels') ||
            (entity.path === '/MetaData/C3DParameters/POINT/LABELS' && key === 'value')
          )
            return [expectedLabel, 'B'];
          if (entity.path === '/RigidBodies/0/Markers' && key === undefined)
            return [expectedLabel, 'B'];
        });
      } finally {
        exported.close();
      }
      if (expectedLabel === 'A') redoEdit();
      else undoEdit();
    }
  });
});

it('round trips event context/subject edits, add/delete and undo/redo with original flags', async () => {
  await withSynthetic((file, motion) => {
    setData(motion);
    editSessionEvent('update', 1, {
      label: 'Edited',
      time: 0.3,
      context: 'Left',
      subject: 'New synthetic subject',
      description: 'Unicode: Ä',
    });
    const edited = useSession.getState().data!;
    expect(edited.events.find((e) => e.label === 'Edited')).toMatchObject({
      genericFlag: 1,
      iconId: 3,
    });
    undoEdit();
    expect(useSession.getState().data!.events).toEqual(motion.events);
    expect(useSession.getState().dirty).toBe(false);
    redoEdit();
    const added = addEvent(useSession.getState().data!, {
      label: 'Added',
      context: 'General',
      subject: '',
      time: 0.4,
    });
    const changed = deleteEvent(
      added,
      added.events.findIndex((e) => e.label === 'Late'),
    );
    const exported = output(file, motion, 'current-events', 0, 8, changed.events);
    try {
      const reopened = parseH5Tree(exported, 'events.h5');
      expect(reopened.events.map((e) => e.label)).toEqual(changed.events.map((e) => e.label));
      expect(reopened.events.find((e) => e.label === 'Edited')).toMatchObject({
        context: 'Left',
        subject: 'New synthetic subject',
        genericFlag: 1,
        iconId: 3,
        sourceFrame: 9,
      });
      expect(reopened.events.find((e) => e.label === 'Added')).toMatchObject({
        genericFlag: 0,
        iconId: 0,
      });
      compare(file.get('MetaData') as h5.Group, exported.get('MetaData') as h5.Group);
      compare(file.get('Trajectories') as h5.Group, exported.get('Trajectories') as h5.Group);
    } finally {
      exported.close();
    }
  });
});

it('crops each clock and frame origin; keeps static provenance and independent model results', async () => {
  await withSynthetic((file, motion) => {
    const wanted = cropMotionData(motion, 1, 6),
      exported = output(file, motion, 'current-cropped', 1, 6);
    try {
      const reopened = parseH5Tree(exported, 'cropped.h5');
      expect(reopened.timeline).toEqual(wanted.timeline);
      expect(reopened.markers).toEqual(wanted.markers);
      expect(reopened.analogs).toEqual(wanted.analogs);
      expect(reopened.forcePlatforms[0].force).toEqual(wanted.forcePlatforms[0].force);
      expect(reopened.rigidBodies![0].position).toEqual(wanted.rigidBodies![0].position);
      expect(reopened.signals!.find((s) => s.group === 'EMG')!.signal).toBe(
        reopened.analogs[0].signal,
      );
      expect(wanted.signals!.find((s) => s.group === 'EMG')!.signal).toBe(wanted.analogs[0].signal);
      for (const path of ['Analog', 'EMG', 'ForcePlates/0']) {
        const attrs = (exported.get(path) as h5.Group).attrs;
        expect(attrs.NumSamples.value).toBe(10n);
        expect(attrs.StartFrame.value).toBe(18n);
        expect(attrs.EndFrame.value).toBe(27n);
      }
      const body = exported.get('RigidBodies/0') as h5.Group;
      expect(body.attrs.StartFrame.value).toBe(1n);
      expect(body.attrs.EndFrame.value).toBe(5n);
      for (const path of ['MetaData', 'IKResults', 'IDResults'])
        compare(file.get(path) as h5.Group, exported.get(path) as h5.Group);
      expect(dataset(exported, 'Events/GenericFlag').value).toEqual(new BigInt64Array([0n, 1n]));
    } finally {
      exported.close();
    }
  });
});

it('rejects malformed required data and explicit future versions, while missing optional groups remain valid', async () => {
  await withSynthetic((file) => {
    for (const path of ['Events', 'RigidBodies', 'ForcePlates/0']) {
      const versioned = {
        get: (key: string) =>
          key === path
            ? {
                ...(file.get(path) as h5.Group),
                attrs: { SchemaVersion: { value: 99 } },
              }
            : file.get(key),
      };
      // ForcePlates child lookup uses its parent; supply an explicit parent wrapper.
      if (path === 'ForcePlates/0')
        versioned.get = (key: string) =>
          key === 'ForcePlates'
            ? ({
                keys: () => ['0'],
                get: () => ({ attrs: { SchemaVersion: { value: 99 } } }),
              } as never)
            : file.get(key);
      expect(() => parseH5Tree(versioned, 'invalid.h5')).toThrow('unsupported SchemaVersion');
    }
    const minimal = {
      get: (key: string) =>
        /^(Analog|EMG|Events|RigidBodies|ForcePlates|IKResults|IDResults)(\/|$)/.test(key)
          ? null
          : file.get(key),
    };
    const parsed = parseH5Tree(minimal, 'minimal.h5');
    expect(parsed.events).toEqual([]);
    expect(parsed.forcePlatforms).toEqual([]);
    expect(parsed.analogs).toEqual([]);
  });
});

it('snaps explicit-clock arithmetic noise on both sides of exact signal samples', () => {
  const signal = {
    values: new Float64Array([0, 1e8, 2]),
    times: new Float64Array([0, 0.005 + 1e-15, 0.01]),
    rate: 200,
    components: 1,
    startTime: 0,
  };
  expect(sample(signal, 0.005)).toBe(1e8);
  expect(sample(signal, 0.005 + 2e-15)).toBe(1e8);
  expect(sample(signal, 0.0025)).toBeCloseTo(5e7, 4);
});

it('adds events to an optional absent collection using the current eight-column layout', async () => {
  await h5.ready;
  const file = new h5.File(resolve(folder, 'current-minimal.h5'), 'w');
  try {
    file.create_group('MetaData').create_group('Project');
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 4);
    trajectories.create_attribute('StartFrame', 8);
    const labeled = trajectories.create_group('Labeled');
    labeled.create_attribute('Labels', ['A']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({ name: 'Data', data: new Float64Array(16), shape: [1, 4, 4] });
    const motion = parseH5Tree(file, 'minimal.h5');
    expect(motion.source.timeOrigin).toBe(2);
    const events = addEvent(motion, {
      label: 'New',
      context: 'Left',
      subject: '',
      time: 0.25,
    }).events;
    const exported = output(file, motion, 'current-minimal-events', 0, 4, events);
    try {
      expect((exported.get('Events') as h5.Group).keys()).toEqual([
        'Context',
        'Description',
        'Frame',
        'GenericFlag',
        'IconID',
        'Name',
        'Subject',
        'Time',
      ]);
      const reopened = parseH5Tree(exported, 'reopened.h5');
      expect(reopened.events[0]).toMatchObject({
        label: 'New',
        time: 0.25,
        context: 'Left',
        sourceFrame: 9,
        genericFlag: 0,
        iconId: 0,
      });
    } finally {
      exported.close();
    }
  } finally {
    file.close();
  }
});

it('fails with path-specific errors for current count, event and channel corruption', async () => {
  await h5.ready;
  const path = resolve(folder, 'current-invalid.h5');
  writeFileSync(path, Buffer.from(fixture.base64, 'base64'));
  const file = new h5.File(path, 'a');
  try {
    const analog = file.get('Analog') as h5.Group;
    analog.delete_attribute('NumSamples');
    analog.create_attribute('NumSamples', 999, [], '<q');
    expect(() => parseH5Tree(file, 'invalid.h5')).toThrow('Analog@NumSamples');
    analog.delete_attribute('NumSamples');
    analog.create_attribute('NumSamples', 16, [], '<q');
    analog.delete_attribute('Channels');
    analog.create_attribute('Channels', new BigInt64Array([0n, 1n]));
    expect(() => parseH5Tree(file, 'invalid.h5')).toThrow('Analog/Channels');
    analog.delete_attribute('Channels');
    analog.create_attribute('Channels', new BigInt64Array([0n]));
    const events = file.get('Events') as h5.Group;
    const malformed = {
      get: (key: string) =>
        key === 'Events'
          ? {
              attrs: events.attrs,
              keys: () => events.keys(),
              get: (name: string) =>
                name === 'Context' ? { shape: [2], value: ['Left', 'Right'] } : events.get(name),
            }
          : file.get(key),
    };
    expect(() => parseH5Tree(malformed, 'invalid.h5')).toThrow('matching one-dimensional rows');
  } finally {
    file.close();
  }
});

it('rejects obsolete collection versions, geometry, event columns and flat metadata', async () => {
  await withSynthetic((file) => {
    for (const [path, version] of [
      ['Events', 1],
      ['RigidBodies', 1],
      ['ForcePlates/0', 2],
    ] as const) {
      const original = file.get(path) as h5.Group;
      const obsolete = {
        get: (key: string) => {
          if (key === path)
            return {
              attrs: { ...original.attrs, SchemaVersion: { value: version } },
              get: original.get.bind(original),
            };
          if (path === 'ForcePlates/0' && key === 'ForcePlates')
            return { keys: () => ['0'], get: () => obsolete.get(path) };
          return file.get(key);
        },
      };
      expect(() => parseH5Tree(obsolete, 'obsolete.h5')).toThrow('Unsupported institute H5 schema');
    }
    const plate = file.get('ForcePlates/0') as h5.Group;
    for (const field of ['Location', 'Offset']) {
      const obsolete = {
        get: (path: string) =>
          path === 'ForcePlates'
            ? {
                keys: () => ['0'],
                get: () => ({
                  attrs: plate.attrs,
                  get: (key: string) => (key === field ? {} : plate.get(key)),
                }),
              }
            : file.get(path),
      };
      expect(() => parseH5Tree(obsolete, 'obsolete.h5')).toThrow(
        'obsolete Location/Offset geometry',
      );
    }
    for (const [field, shape] of [
      ['Force', [16, 3]],
      ['Tz', [16]],
    ] as const) {
      const obsolete = {
        get: (path: string) =>
          path === 'ForcePlates'
            ? {
                keys: () => ['0'],
                get: () => ({
                  attrs: plate.attrs,
                  get: (key: string) => (key === field ? { shape } : plate.get(key)),
                }),
              }
            : file.get(path),
      };
      expect(() => parseH5Tree(obsolete, 'obsolete.h5')).toThrow('expected [3,samples]');
    }
    const events = file.get('Events') as h5.Group;
    const oldEvents = {
      get: (path: string) =>
        path === 'Events'
          ? {
              keys: () => ['Name', 'Description', 'Frame', 'Time'],
              get: (key: string) =>
                ['Context', 'Subject', 'GenericFlag', 'IconID'].includes(key)
                  ? null
                  : events.get(key),
            }
          : file.get(path),
    };
    expect(() => parseH5Tree(oldEvents, 'obsolete.h5')).toThrow('Missing Context');
    const flat = {
      get: (path: string) =>
        ['MetaData/Project', 'MetaData/FileInfo'].includes(path) ? null : file.get(path),
    };
    expect(() => parseH5Tree(flat, 'obsolete.h5')).toThrow('current nested MetaData');
  });
});

it('normalizes current spatial/force/moment units independently and exports original values and units', async () => {
  await h5.ready;
  const path = resolve(folder, 'current-units.h5');
  writeFileSync(path, Buffer.from(fixture.base64, 'base64'));
  const file = new h5.File(path, 'a');
  try {
    const labeled = file.get('Trajectories/Labeled') as h5.Group;
    const plate = file.get('ForcePlates/0') as h5.Group;
    for (const [group, key, value] of [
      [labeled, 'Unit', 'm'],
      [plate, 'unit_position', 'cm'],
      [plate, 'unit_force', 'kN'],
      [plate, 'unit_moment', 'Nm'],
    ] as const) {
      group.delete_attribute(key);
      group.create_attribute(key, value);
    }
    const motion = parseH5Tree(file, 'units.h5');
    expect(motion.markers.positions[0]).toBe(0.123456789 * 1000);
    expect(motion.forcePlatforms[0].force.values[0]).toBe(250);
    expect(motion.forcePlatforms[0].moment.values[0]).toBe(0.25);
    expect(motion.forcePlatforms[0].cop.values[0]).toBe(2.5);
    expect(motion.forcePlatforms[0].freeMoment!.values[0]).toBe(0.25);
    const exported = output(file, motion, 'current-units-out');
    try {
      compare(file, exported);
      const reopened = parseH5Tree(exported, 'units.h5');
      expect(reopened.markers.positions).toEqual(motion.markers.positions);
      expect(reopened.forcePlatforms).toEqual(motion.forcePlatforms);
    } finally {
      exported.close();
    }
  } finally {
    file.close();
  }
});

it('crops fractional rate ratios from stream frame metadata and keeps body frame origins independent', async () => {
  await h5.ready;
  const file = new h5.File(resolve(folder, 'current-without-time.h5'), 'w');
  try {
    file.create_group('MetaData').create_group('Project');
    const trajectories = file.create_group('Trajectories');
    trajectories.create_attribute('SamplingFrequency', 4);
    trajectories.create_attribute('StartFrame', 8);
    const labeled = trajectories.create_group('Labeled');
    labeled.create_attribute('Labels', ['A']);
    labeled.create_attribute('Unit', 'mm');
    labeled.create_dataset({ name: 'Data', data: new Float64Array(16), shape: [1, 4, 4] });
    const analog = file.create_group('Analog');
    for (const [key, value] of Object.entries({
      SamplingFrequency: 6,
      StartFrame: 12,
      EndFrame: 17,
      NumSamples: 6,
    }))
      analog.create_attribute(key, value);
    analog.create_attribute('Labels', ['Channel']);
    analog.create_attribute('Units', ['V']);
    analog.create_dataset({
      name: 'Data',
      data: new Float64Array([0, 1, 2, 3, 4, 5]),
      shape: [1, 6],
    });
    const body = file.create_group('RigidBodies').create_group('0');
    for (const [key, value] of Object.entries({ StartFrame: 0, EndFrame: 3, NumSamples: 4 }))
      body.create_attribute(key, value);
    body.create_attribute('Unit', 'mm');
    body.create_dataset({
      name: 'Position',
      data: Float64Array.from({ length: 12 }, (_, i) => i),
      shape: [3, 4],
    });
    const motion = parseH5Tree(file, 'clocks.h5'),
      wanted = cropMotionData(motion, 1, 3);
    const exported = output(file, motion, 'current-without-time-cropped', 1, 3);
    try {
      const reopened = parseH5Tree(exported, 'cropped.h5');
      expect(reopened.analogs[0].signal.values).toEqual(new Float64Array([2, 3, 4]));
      expect(reopened.analogs[0].signal.startTime).toBeCloseTo(
        wanted.analogs[0].signal.startTime,
        12,
      );
      expect((exported.get('Analog') as h5.Group).attrs.StartFrame.value).toBe(14);
      expect((exported.get('Analog') as h5.Group).attrs.EndFrame.value).toBe(16);
      expect((exported.get('RigidBodies/0') as h5.Group).attrs.StartFrame.value).toBe(1);
      expect(reopened.rigidBodies![0].position.values).toEqual(
        wanted.rigidBodies![0].position.values,
      );
    } finally {
      exported.close();
    }
  } finally {
    file.close();
  }
});

it.skipIf(!existsSync(reference))(
  'checks the current authoritative file read-only without logging private values',
  async () => {
    await h5.ready;
    const before = readFileSync(reference),
      file = new h5.File(reference, 'r');
    try {
      const motion = parseH5Tree(file, 'local.h5');
      expect(motion.source.h5Layout === 'institute-current').toBe(true);
      expect(eventEditingAvailable(motion) && eventContextAvailable(motion)).toBe(true);
      expect(motion.events.length === dataset(file, 'Events/Time').shape![0]).toBe(true);
      expect(!!motion.source.info?.subject).toBe(true);
      expect(!!motion.source.info?.provenance?.createdUTC).toBe(true);
      expect(
        motion
          .signals!.filter((s) => s.group === 'EMG')
          .every(
            (s) => s.analogIndex !== undefined && s.signal === motion.analogs[s.analogIndex].signal,
          ),
      ).toBe(true);
      expect(
        motion.forcePlatforms.length === (file.get('ForcePlates') as h5.Group).keys().length,
      ).toBe(true);
      expect(readFileSync(reference).equals(before)).toBe(true);
      if (process.env.JE_VALIDATE_REFERENCE !== '1') return;
      const rebuilt = output(file, motion, 'authoritative-reconstructed');
      try {
        compare(file, rebuilt);
      } finally {
        rebuilt.close();
      }
      const labels = [...motion.markers.labels];
      labels[0] = 'Renamed synthetic marker';
      const changed = updateEvent(motion, 0, {
        label: 'Edited synthetic label',
        description: 'Edited description',
        context: 'Synthetic context',
        subject: 'Synthetic subject',
        time: 0.1,
      });
      const variants = [
        ['renamed', undefined, labels],
        ['edited', changed.events],
        [
          'added',
          addEvent(motion, {
            label: 'Added synthetic label',
            description: '',
            context: '',
            subject: '',
            time: 0.125,
          }).events,
        ],
        ['deleted', deleteEvent(motion, 0).events],
      ] as const;
      for (const [suffix, events, names] of variants) {
        const exported = output(
          file,
          motion,
          `authoritative-${suffix}`,
          0,
          motion.timeline.frameCount,
          events ? [...events] : undefined,
          names ? [...names] : undefined,
        );
        try {
          const reopened = parseH5Tree(exported, 'local.h5');
          expect(isDeepStrictEqual(reopened.markers.positions, motion.markers.positions)).toBe(
            true,
          );
          expect(isDeepStrictEqual(reopened.markers.residuals, motion.markers.residuals)).toBe(
            true,
          );
          expect(isDeepStrictEqual(reopened.timeline, motion.timeline)).toBe(true);
        } finally {
          exported.close();
        }
      }
      const start = 1,
        end = motion.timeline.frameCount - 1;
      const cropped = output(file, motion, 'authoritative-cropped', start, end);
      try {
        const reopened = parseH5Tree(cropped, 'local.h5'),
          wanted = cropMotionData(motion, start, end);
        for (const key of ['labels', 'positions', 'valid', 'residuals', 'quality'] as const)
          expect(
            isDeepStrictEqual(reopened.markers[key], wanted.markers[key]),
            `cropped markers/${key}`,
          ).toBe(true);
        expect(isDeepStrictEqual(reopened.timeline, wanted.timeline)).toBe(true);
        reopened.analogs.forEach((channel, i) => {
          expect(isDeepStrictEqual(channel.signal.values, wanted.analogs[i].signal.values)).toBe(
            true,
          );
          expect(
            channel.signal.times!.every(
              (t, j) => Math.abs(t - wanted.analogs[i].signal.times![j]) < 1e-12,
            ),
          ).toBe(true);
        });
        for (const path of ['MetaData', 'IKResults', 'IDResults'])
          compare(file.get(path) as h5.Group, cropped.get(path) as h5.Group);
      } finally {
        cropped.close();
      }
    } finally {
      file.close();
    }
  },
);

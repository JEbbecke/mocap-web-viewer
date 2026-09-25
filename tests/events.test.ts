import { expect, it } from 'vitest';
import {
  addEvent,
  updateEvent,
  deleteEvent,
  timelineEvents,
  eventSourceFrame,
} from '../src/motion/events';
import { cropMotionData } from '../src/motion/crop';
import { parseC3D } from '../src/importers/c3d/importer';
import { readParameters } from '../src/importers/c3d/parameters';
import { exportC3D } from '../src/exporters/c3d';
import {
  setData,
  useSession,
  editSessionEvent,
  restoreOriginal,
  selectCrop,
  applyCrop,
} from '../src/state/session';
import fixtures from './fixtures/c3d.json';

const buffer = (s: string) => Uint8Array.from(Buffer.from(s, 'base64')).buffer;
const fields = {
  label: 'Arbitrary event',
  context: 'Right',
  description: 'Contact description',
  subject: 'Synthetic',
  time: 0.015123456789,
};
for (const [variant, encoded] of Object.entries(fixtures)) {
  it(`${variant}: add, edit, delete and repeated export preserve scientific samples and metadata`, () => {
    const source = buffer(encoded),
      snapshot = source.slice(0);
    const original = parseC3D(source, variant);
    const added = addEvent(original, fields);
    const roundtrip = (data: typeof original) =>
      parseC3D(exportC3D(source, 0, 3, data.events), variant);
    const reopened = roundtrip(added);
    expect(reopened.markers).toEqual(original.markers);
    expect(reopened.analogs).toEqual(original.analogs);
    const found = reopened.events.find((e) => e.label === fields.label)!;
    expect(found).toMatchObject({
      label: fields.label,
      context: fields.context,
      description: fields.description,
      subject: fields.subject,
    });
    expect(found.time).toBeCloseTo(fields.time, 6);
    const edited = updateEvent(
      added,
      added.events.findIndex((e) => e.label === fields.label),
      { ...fields, label: 'Long renamed label', time: 0 },
    );
    expect(roundtrip(edited).events[0].label).toBe('Long renamed label');
    let deleted = edited;
    while (deleted.events.length) deleted = deleteEvent(deleted, 0);
    expect(roundtrip(deleted).events).toEqual([]);
    expect(original.events.length).toBeGreaterThan(0);
    expect(source).toEqual(snapshot);
    const before = readParameters(new DataView(source)).params;
    const after = readParameters(new DataView(exportC3D(source, 0, 3, added.events))).params;
    for (const [key, p] of before)
      if (!key.startsWith('EVENT:') && key !== 'POINT:DATA_START')
        expect(after.get(key)?.values).toEqual(p.values);
  });
}
it('maps the shared timeline axis, source frames and stable equal-time ordering', () => {
  const data = parseC3D(buffer(fixtures.intelFloat), 'trial');
  const changed = addEvent(
    addEvent({ ...data, events: [] }, { ...fields, label: 'A', time: 0.01 }),
    { ...fields, label: 'B', time: 0.01 },
  );
  expect(changed.events.map((e) => e.label)).toEqual(['A', 'B']);
  expect(timelineEvents(changed)[0].percent).toBeCloseTo(100 / 3);
  expect(eventSourceFrame(data, 0)).toBe(data.timeline.firstFrame + 1);
  expect(eventSourceFrame(data, 0.01)).toBe(data.timeline.firstFrame + 2);
  expect(() => addEvent(data, { ...fields, time: NaN })).toThrow();
  expect(() => addEvent(data, { ...fields, time: 0.03 })).toThrow();
  expect(() => addEvent(data, { ...fields, label: ' ' })).toThrow();
  expect(() => addEvent({ ...data, source: { ...data.source, format: 'H5' } }, fields)).toThrow(
    'H5',
  );
});
it('edits then crops, rebases once, retains source origin and exports the retained event', () => {
  const source = buffer(fixtures.intelFloat),
    original = parseC3D(source, 'trial');
  const added = addEvent({ ...original, events: [] }, { ...fields, time: 0.02 });
  const cropped = cropMotionData(cropMotionData(added, 1, 3), 1, 2);
  expect(cropped.events[0].time).toBe(0);
  const reopened = parseC3D(exportC3D(source, 2, 3, cropped.events), 'cut');
  expect(reopened.events[0].time).toBeCloseTo(0, 6);
  expect(reopened.timeline).toEqual(cropped.timeline);
  expect(cropMotionData(added, 0, 2).events).toHaveLength(0);
});
it('restores the imported dataset after edits and crops and clears the saved state', () => {
  const original = parseC3D(buffer(fixtures.intelFloat), 'trial');
  setData(original);
  useSession.setState({ saved: true });
  editSessionEvent('add', -1, fields);
  expect(useSession.getState().saved).toBe(false);
  expect(useSession.getState().originalData).toBe(original);
  selectCrop(1, 3);
  applyCrop();
  restoreOriginal();
  expect(useSession.getState().data).toBe(original);
});
it('grows the parameter section for dense events without changing samples', () => {
  const source = buffer(fixtures.intelFloat),
    original = parseC3D(source, 'trial');
  const events = Array.from({ length: 100 }, (_, i) => ({
    ...fields,
    label: `Event ${i} ${'x'.repeat(80)}`,
  }));
  const output = exportC3D(source, 0, 3, events);
  const reopened = parseC3D(output, 'dense');
  expect(reopened.events).toHaveLength(100);
  expect(reopened.markers).toEqual(original.markers);
  expect(reopened.analogs).toEqual(original.analogs);
});

it('preserves opaque event rows and refuses to invent values for new rows', () => {
  const source = buffer(fixtures.intelFloat);
  const bytes = new Uint8Array(source);
  const name = Buffer.from('CONTEXTS');
  const at = Buffer.from(bytes).indexOf(name);
  expect(at).toBeGreaterThan(0);
  bytes.set(new TextEncoder().encode('VENDORXX'), at);
  const original = parseC3D(source, 'opaque');
  const edited = updateEvent(original, 0, { ...fields, time: 0 });
  const output = exportC3D(source, 0, 3, edited.events);
  expect(readParameters(new DataView(output)).params.get('EVENT:VENDORXX')?.values).toEqual([
    'Left',
  ]);
  const added = addEvent(edited, fields);
  expect(() => exportC3D(source, 0, 3, added.events)).toThrow('Cannot invent metadata');
});

it('promotes header-only events to full parameter labels, with no stale deleted fallback', () => {
  const source = buffer(fixtures.intelFloat),
    bytes = new Uint8Array(source);
  const at = Buffer.from(bytes).indexOf(Buffer.from('EVENT'));
  bytes.set(new TextEncoder().encode('OTHER'), at);
  const view = new DataView(source);
  const original = parseC3D(source, 'header');
  view.setUint16(298, 12345, true);
  view.setUint16(300, 1, true);
  view.setFloat32(304, original.timeline.firstFrame / original.timeline.rate + 0.01, true);
  bytes.set(new TextEncoder().encode('TEST'), 396);
  const imported = parseC3D(source, 'header');
  expect(imported.events[0].label).toBe('TEST');
  const edited = updateEvent(imported, 0, { ...fields, time: 0.01 });
  const exported = exportC3D(source, 0, 3, edited.events);
  expect(parseC3D(exported, 'edited').events[0].label).toBe(fields.label);
  expect(parseC3D(exportC3D(source, 0, 3, []), 'deleted').events).toHaveLength(0);
});

it('uses the recording rate for frame mapping and crop after editing', () => {
  const original = parseC3D(buffer(fixtures.intelFloat), 'rate');
  const data = {
    ...original,
    timeline: { rate: 200, firstFrame: 428, frameCount: 2000, duration: 9.995 },
    events: [],
  };
  let edited = addEvent(data, { ...fields, label: 'A', time: 2 });
  edited = addEvent(edited, { ...fields, label: 'B', time: 5 });
  edited = addEvent(edited, { ...fields, label: 'C', time: 8 });
  const cut = cropMotionData(edited, 800, 1400);
  expect(cut.events.map((e) => [e.label, e.time])).toEqual([['B', 1]]);
  expect(eventSourceFrame(cut, 1)).toBe(1429);
});

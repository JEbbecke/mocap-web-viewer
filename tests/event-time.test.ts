import { expect, it } from 'vitest';
import { eventTimeValue, formatEventTime } from '../src/components/eventTime';
import { eventSourceFrame } from '../src/motion/events';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { editSessionEvent, redoEdit, setData, undoEdit, useSession } from '../src/state/session';

it.each([
  [0.9900000000000002, 100, '0.990'],
  [0.19999999999999996, 100, '0.200'],
  [0.875, 100, '0.875'],
  [1.2, 100, '1.200'],
  [0, 100, '0.000'],
  [0.00001, 100000, '0.00001'],
  [0.00002, 100000, '0.00002'],
  [0.0000625, 16000, '0.0000625'],
  [0.25123456789, 100, '0.25123456789'],
  [0.99000001, 100, '0.99000001'],
  [1e-20, 100, '1e-20'],
])('presents %s at %s Hz as %s without discarding meaningful precision', (value, rate, text) => {
  expect(formatEventTime(value, rate)).toBe(text);
  expect(eventTimeValue(text, { value, text })).toBe(value);
});

it('preserves the raw timestamp and source mapping through an unchanged save and history', () => {
  const original = parseC3D(physicalFixture(), 'exact.c3d');
  const event = { ...original.events[0], time: 0.9900000000000002 };
  const data = {
    ...original,
    timeline: { firstFrame: 428, rate: 100000, frameCount: 200000, duration: 1.99999 },
    events: [event],
  };
  const text = formatEventTime(event.time, data.timeline.rate);
  const time = eventTimeValue(text, { value: event.time, text });
  const sourceFrame = eventSourceFrame(data, event.time);
  setData(data);
  editSessionEvent('update', 0, { ...event, time });
  const saved = useSession.getState().data!;
  expect(saved.events[0]).toEqual(event);
  expect(saved.events[0].time).toBe(event.time);
  expect(eventSourceFrame(saved, saved.events[0].time)).toBe(sourceFrame);
  expect(saved.markers).toBe(data.markers);
  expect(saved.analogs).toBe(data.analogs);
  undoEdit();
  expect(useSession.getState().data!.events[0]).toBe(event);
  redoEdit();
  expect(useSession.getState().data!.events[0].time).toBe(event.time);
});

it('parses explicit time/source-frame edits without formatting during typing or snapping to samples', () => {
  const original = { value: 0.9900000000000002, text: '0.990' };
  expect(eventTimeValue('0.99123456789', original)).toBe(0.99123456789);
  expect(eventTimeValue('0.99', original)).toBe(0.99);
  expect(eventTimeValue('1e-6', original)).toBe(1e-6);
  expect(Number.isNaN(eventTimeValue('invalid', original))).toBe(true);
});

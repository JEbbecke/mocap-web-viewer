import type { MotionData, MotionEvent } from './types';

export type EventFields = Pick<
  MotionEvent,
  'label' | 'context' | 'time' | 'description' | 'subject'
>;
export function eventEditingAvailable(data: MotionData) {
  return data.source.format !== 'H5' || data.source.eventSchema === 'institute-v1';
}
export function eventContextAvailable(data: MotionData) {
  return data.source.eventSchema !== 'institute-v1';
}
export function validateEvent(data: MotionData, event: EventFields) {
  if (!eventEditingAvailable(data))
    throw new Error('H5 event editing requires an established institute event schema.');
  if (!event.label.trim()) throw new Error('Enter an event label.');
  if (data.source.eventSchema === 'institute-v1' && (event.context || event.subject))
    throw new Error('This event format has no context or subject field. Use Description.');
  if (
    !Number.isFinite(event.time) ||
    event.time < 0 ||
    event.time >= data.timeline.frameCount / data.timeline.rate
  )
    throw new Error('Event time must be within the recording (before the end boundary).');
  for (const value of [event.label, event.context, event.description ?? '', event.subject ?? ''])
    if (new TextEncoder().encode(value).length > 255 || value.includes('\0'))
      throw new Error('Event text must contain at most 255 UTF-8 bytes and no null characters.');
}
function changed(data: MotionData, events: MotionEvent[]): MotionData {
  if (!eventEditingAvailable(data)) throw new Error('H5 event editing is unsupported.');
  return {
    ...data,
    source: { ...data.source, eventsEdited: true },
    events: events.sort((a, b) => a.time - b.time),
  };
}
export function addEvent(data: MotionData, fields: EventFields) {
  validateEvent(data, fields);
  if (data.source.format === 'C3D' && data.events.length >= 255)
    throw new Error('Editing supports at most 255 C3D events.');
  return changed(data, [...data.events, { ...fields }]);
}
export function updateEvent(data: MotionData, index: number, fields: EventFields) {
  if (!data.events[index]) throw new Error('Event no longer exists.');
  validateEvent(data, fields);
  return changed(
    data,
    data.events.map((e, i) => (i === index ? { ...e, ...fields } : e)),
  );
}
export function deleteEvent(data: MotionData, index: number) {
  if (!data.events[index]) throw new Error('Event no longer exists.');
  return changed(
    data,
    data.events.filter((_, i) => i !== index),
  );
}
/** Same half-open time axis as playback and crop boundaries; indices retain array identity. */
export function timelineEvents(data: MotionData) {
  return data.events
    .map((event, index) => ({
      event,
      index,
      percent: (100 * event.time * data.timeline.rate) / data.timeline.frameCount,
    }))
    .filter(({ percent }) => Number.isFinite(percent) && percent >= 0 && percent < 100)
    .sort((a, b) => a.event.time - b.event.time);
}
export function eventSourceFrame(data: MotionData, time: number) {
  return (
    data.timeline.firstFrame + (data.source.format === 'C3D' ? 1 : 0) + time * data.timeline.rate
  );
}

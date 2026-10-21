import { useLayoutEffect, useRef, useState } from 'react';
import { TimelineSlider } from './TimelineSlider';
import type { MotionData } from '../motion/types';
import {
  eventEditingAvailable,
  eventContextAvailable,
  eventSourceFrame,
  timelineEvents,
} from '../motion/events';
import { editSessionEvent, openSessionEvent, useSession } from '../state/session';

export function EventControls({ data }: { data: MotionData }) {
  const selected = useSession((s) => s.eventEditor?.index ?? null);
  const busy = useSession((s) => s.busy);
  const available = eventEditingAvailable(data);
  return (
    <>
      <div className="event-toolbar" role="group" aria-label="Event controls">
        <button
          title="Add event"
          disabled={!available || busy}
          onClick={() => openSessionEvent('new')}
        >
          Add Event
        </button>
        <select
          aria-label="Select event"
          title="Select event to edit"
          disabled={!data.events.length || busy}
          value={typeof selected === 'number' ? selected : ''}
          onChange={(e) => {
            if (e.target.value !== '') openSessionEvent(Number(e.target.value));
          }}
        >
          <option value="">Events ({data.events.length})</option>
          {data.events.map((event, index) => (
            <option key={index} value={index}>
              {event.label} · {event.time.toFixed(3)} s
            </option>
          ))}
        </select>
      </div>
      {!available && (
        <span className="event-unavailable">
          Event editing unavailable for this file's event schema.
        </span>
      )}
    </>
  );
}

export function EventEditor({ data }: { data: MotionData }) {
  const request = useSession((s) => s.eventEditor);
  const selected = request?.index ?? null;
  const select = (_: null) => useSession.setState({ eventEditor: null });
  const [label, setLabel] = useState(''),
    [context, setContext] = useState('');
  const [description, setDescription] = useState(''),
    [subject, setSubject] = useState('');
  const [time, setTime] = useState('0'),
    [error, setError] = useState('');
  const [deleteRequest, setDeleteRequest] = useState<typeof request>(null);
  const confirmDelete = !!request && deleteRequest === request;
  const keepEventButton = useRef<HTMLButtonElement>(null);
  const busy = useSession((s) => s.busy);
  useLayoutEffect(() => {
    if (confirmDelete) keepEventButton.current?.focus({ preventScroll: true });
  }, [confirmDelete]);
  // Populate the shared request before the editor paints or receives typing.
  useLayoutEffect(() => {
    if (!request) return;
    const index = request.index;
    const event =
      index === 'new'
        ? { label: '', context: '', time: useSession.getState().frame / data.timeline.rate }
        : data.events[index];
    setLabel(event.label);
    setContext(event.context);
    setTime(String(event.time));
    setDescription('description' in event ? (event.description ?? '') : '');
    setSubject('subject' in event ? (event.subject ?? '') : '');
    setError('');
    setDeleteRequest(null);
  }, [request, data]);
  if (selected === null) return null;
  const selectedEvent = selected === 'new' ? null : data.events[selected];
  return (
    <form
      className="event-editor"
      aria-label={selected === 'new' ? 'Add event' : 'Edit event'}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmDelete) return;
        try {
          if (!time.trim()) throw new Error('Enter an event time.');
          editSessionEvent(
            selected === 'new' ? 'add' : 'update',
            selected === 'new' ? -1 : selected,
            { label, context, description, subject, time: Number(time) },
          );
          select(null);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label>
        Event label
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} required />
      </label>
      <label>
        Time (s)
        <input
          type="number"
          step="any"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </label>
      <label>
        Source frame
        <input
          type="number"
          step="any"
          value={Number.isFinite(Number(time)) ? eventSourceFrame(data, Number(time)) : ''}
          onChange={(e) =>
            setTime(
              e.target.value === ''
                ? ''
                : String((Number(e.target.value) - eventSourceFrame(data, 0)) / data.timeline.rate),
            )
          }
        />
      </label>
      {eventContextAvailable(data) && (
        <label>
          Context
          <input value={context} onChange={(e) => setContext(e.target.value)} />
        </label>
      )}
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {eventContextAvailable(data) && (
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
      )}
      <div className="event-editor-actions" role="group" aria-label="Event actions">
        {confirmDelete && selectedEvent ? (
          <>
            <span className="event-delete-prompt" role="status" title={selectedEvent.label}>
              Delete “{selectedEvent.label}”?
            </span>
            <button
              type="button"
              className="event-delete-confirm"
              disabled={busy}
              title="Delete selected event"
              onClick={() => {
                // The pending request must still name this editor's event.
                if (
                  useSession.getState().eventEditor !== deleteRequest ||
                  selected === 'new' ||
                  useSession.getState().data?.events[selected] !== selectedEvent
                )
                  return;
                try {
                  editSessionEvent('delete', selected);
                  select(null);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Confirm delete event
            </button>
            <button
              type="button"
              title="Cancel event deletion"
              ref={keepEventButton}
              onClick={() => setDeleteRequest(null)}
            >
              Keep event
            </button>
          </>
        ) : (
          <>
            <button type="submit" disabled={busy} title="Save event changes">
              Save event
            </button>
            <button type="button" title="Cancel event changes" onClick={() => select(null)}>
              Cancel
            </button>
            {selected !== 'new' && (
              <button
                type="button"
                disabled={busy}
                title="Delete selected event"
                onClick={() => setDeleteRequest(request)}
              >
                Delete event
              </button>
            )}
          </>
        )}
      </div>
      {error && <span role="alert">{error}</span>}
    </form>
  );
}

/** Marker lanes and the slider retain the same shared percentage axis. */
export function TimelineEvents({ data }: { data: MotionData }) {
  const selected = useSession((s) => s.eventEditor?.index ?? null);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = scroll.current!;
    strip.scrollTop = strip.scrollHeight - strip.clientHeight;
  }, [data.events]);
  const entries = timelineEvents(data);
  // Greedy lanes keep close markers separate; the track scrolls vertically for dense trials.
  const lanes: number[] = [];
  const markers = entries.map((entry) => {
    let lane = lanes.findIndex((end) => entry.percent >= end);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = entry.percent + 2;
    return { ...entry, lane };
  });
  return (
    <div className="event-workspace">
      <div className="event-scroll" aria-label="Timeline events" ref={scroll}>
        <div className="event-markers" style={{ height: Math.max(1, lanes.length) * 12 }}>
          {markers.map(({ event, index, percent, lane }) => (
            <button
              key={index}
              className={`${selected === index ? 'selected-event' : ''} event-context-${event.context.trim().toLowerCase() === 'left' ? 'left' : ['right', 'rigth'].includes(event.context.trim().toLowerCase()) ? 'right' : 'other'}`}
              style={{ left: `${percent}%`, bottom: lane * 12 }}
              title={`${event.context} ${event.label} · ${event.time} s`}
              aria-label={`Edit event ${event.label}`}
              aria-pressed={selected === index}
              onClick={() => openSessionEvent(index)}
            >
              <span className="event-pin" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <TimelineSlider data={data} />
    </div>
  );
}

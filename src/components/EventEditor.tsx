import { useLayoutEffect, useState } from 'react';
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
    <div className="event-toolbar">
      <button disabled={!available || busy} onClick={() => openSessionEvent('new')}>
        Add Event
      </button>
      {data.events.length > 0 && (
        <select
          aria-label="Select event"
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
      )}
      {!available && <span>Event editing unavailable for this file's event schema.</span>}
    </div>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = useSession((s) => s.busy);
  const open = openSessionEvent;
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
    setConfirmDelete(false);
  }, [request, data]);
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
      <div className="event-scroll" aria-label="Timeline events">
        <div className="event-markers" style={{ height: Math.max(1, lanes.length) * 12 }}>
          {markers.map(({ event, index, percent, lane }) => (
            <button
              key={index}
              className={`${selected === index ? 'selected-event' : ''} event-context-${event.context.trim().toLowerCase() === 'left' ? 'left' : ['right', 'rigth'].includes(event.context.trim().toLowerCase()) ? 'right' : 'other'}`}
              style={{ left: `${percent}%`, top: lane * 12 }}
              title={`${event.context} ${event.label} · ${event.time} s`}
              aria-label={`Edit event ${event.label}`}
              aria-pressed={selected === index}
              onClick={() => open(index)}
            >
              <span className="event-pin" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <TimelineSlider data={data} />
      {selected !== null && (
        <form
          className="event-editor"
          onSubmit={(e) => {
            e.preventDefault();
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
                    : String(
                        (Number(e.target.value) - eventSourceFrame(data, 0)) / data.timeline.rate,
                      ),
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
          <button type="submit" disabled={busy}>
            Save event
          </button>
          <button type="button" onClick={() => select(null)}>
            Cancel
          </button>
          {selected !== 'new' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                try {
                  editSessionEvent('delete', selected);
                  select(null);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              {confirmDelete ? 'Confirm delete event' : 'Delete event'}
            </button>
          )}
          {error && <span role="alert">{error}</span>}
        </form>
      )}
    </div>
  );
}

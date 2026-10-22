import { useLayoutEffect, useRef, useState } from 'react';
import type { MotionData } from '../motion/types';
import { eventEditingAvailable, eventContextAvailable, eventSourceFrame } from '../motion/events';
import { editSessionEvent, openSessionEvent, useSession } from '../state/session';
import { eventTimeValue, formatEventTime } from './eventTime';
export { TimelineEvents } from './TimelineEvents';

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
  const [label, setLabel] = useState(''),
    [context, setContext] = useState('');
  const [description, setDescription] = useState(''),
    [subject, setSubject] = useState('');
  const [time, setTime] = useState('0');
  const originalTime = useRef({ value: 0, text: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingRequest, setPendingRequest] = useState<typeof request>(null);
  const [deleteRequest, setDeleteRequest] = useState<typeof request>(null);
  const confirmDelete = !!request && deleteRequest === request;
  const form = useRef<HTMLFormElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const keepEventButton = useRef<HTMLButtonElement>(null);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const activeDraft = useRef<{
    request: NonNullable<typeof request>;
    data: MotionData;
    values: string[];
  } | null>(null);
  const busy = useSession((s) => s.busy);
  useLayoutEffect(() => {
    if (confirmDelete) keepEventButton.current?.focus({ preventScroll: true });
  }, [confirmDelete]);
  useLayoutEffect(() => {
    if (pendingRequest) keepEditingButton.current?.focus({ preventScroll: true });
  }, [pendingRequest]);
  // Populate the shared request before the editor paints or receives typing.
  useLayoutEffect(() => {
    if (!request) {
      activeDraft.current = null;
      setPendingRequest(null);
      if (restoreFocus.current) {
        const target = returnFocus.current;
        (target?.isConnected && target.checkVisibility() && !target.matches(':disabled')
          ? target
          : document.querySelector<HTMLElement>('.event-toolbar > button')
        )?.focus({ preventScroll: true });
        restoreFocus.current = false;
      }
      return;
    }
    const active = activeDraft.current;
    if (active?.request === request && active.data === data) return;
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement && !form.current?.contains(trigger))
      returnFocus.current =
        trigger !== document.body
          ? trigger
          : document.querySelector<HTMLElement>(
              request.index === 'new' ? '.event-toolbar > button' : '.event-toolbar > select',
            );
    if (
      active &&
      active.data === data &&
      [label, context, description, subject, time].some((value, i) => value !== active.values[i])
    ) {
      setDeleteRequest(null);
      setPendingRequest(request);
      useSession.setState({ eventEditor: active.request });
      return;
    }
    const index = request.index;
    const event =
      index === 'new'
        ? { label: '', context: '', time: useSession.getState().frame / data.timeline.rate }
        : data.events[index];
    setLabel(event.label);
    setContext(event.context);
    const formattedTime = formatEventTime(event.time, data.timeline.rate);
    originalTime.current = { value: event.time, text: formattedTime };
    setTime(formattedTime);
    setDescription('description' in event ? (event.description ?? '') : '');
    setSubject('subject' in event ? (event.subject ?? '') : '');
    activeDraft.current = {
      request,
      data,
      values: [
        event.label,
        event.context,
        'description' in event ? (event.description ?? '') : '',
        'subject' in event ? (event.subject ?? '') : '',
        formattedTime,
      ],
    };
    setErrors({});
    setPendingRequest(null);
    setDeleteRequest(null);
    if (index === 'new') labelInput.current?.focus({ preventScroll: true });
    // Draft values deliberately do not repopulate fields during typing or playback.
  }, [request, data]);
  if (selected === null) return null;
  const numericTime = eventTimeValue(time, originalTime.current);
  const selectedEvent = selected === 'new' ? null : data.events[selected];
  const close = () => {
    restoreFocus.current = true;
    useSession.setState({ eventEditor: null });
  };
  const feedback = (name: string) =>
    errors[name] && (
      <span className="event-field-error" id={`event-${name}-error`} role="alert">
        {errors[name]}
      </span>
    );
  const validation = (name: string) => ({
    name,
    id: `event-${name}`,
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `event-${name}-error` : undefined,
  });
  return (
    <form
      ref={form}
      className="event-editor"
      aria-label={selected === 'new' ? 'Add event' : 'Edit event'}
      onInvalid={(e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        setErrors((current) => ({ ...current, [input.name]: input.validationMessage }));
      }}
      onChangeCapture={(e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        setErrors((current) => {
          const next = { ...current };
          delete next[input.name === 'sourceFrame' ? 'time' : input.name];
          delete next.form;
          return next;
        });
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmDelete || pendingRequest) return;
        try {
          if (!time.trim()) throw new Error('Enter an event time.');
          editSessionEvent(
            selected === 'new' ? 'add' : 'update',
            selected === 'new' ? -1 : selected,
            { label, context, description, subject, time: numericTime },
          );
          close();
        } catch (err) {
          const message = (err as Error).message;
          const invalid: Record<string, string> = {};
          if (!label.trim()) invalid.label = message;
          else if (message.includes('time')) invalid.time = message;
          else if (message.startsWith('Event text')) {
            for (const [name, value] of Object.entries({ label, context, description, subject }))
              if (new TextEncoder().encode(value).length > 255 || value.includes('\0'))
                invalid[name] = message;
          } else invalid.form = message;
          setErrors(invalid);
          form.current
            ?.querySelector<HTMLInputElement>(`[name="${Object.keys(invalid)[0]}"]`)
            ?.focus({ preventScroll: true });
        }
      }}
    >
      <div className="event-editor-fields">
        <div className="event-editor-identity">
          <div className="event-field">
            <label htmlFor="event-label">Event label</label>
            <input
              ref={labelInput}
              type="text"
              {...validation('label')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
            {feedback('label')}
          </div>
          <div className="event-field">
            <label htmlFor="event-time">Time (s)</label>
            <input
              type="number"
              step="any"
              {...validation('time')}
              title={`Exact event time: ${numericTime} s`}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
            {feedback('time')}
          </div>
          <div className="event-field">
            <label htmlFor="event-sourceFrame">Source frame</label>
            <input
              type="number"
              step="any"
              name="sourceFrame"
              id="event-sourceFrame"
              title={`Source frame (recording starts at ${eventSourceFrame(data, 0)})`}
              aria-invalid={errors.time ? true : undefined}
              aria-describedby={errors.time ? 'event-time-error' : undefined}
              value={Number.isFinite(numericTime) ? eventSourceFrame(data, numericTime) : ''}
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
          </div>
        </div>
        <div className="event-editor-metadata">
          {eventContextAvailable(data) && (
            <div className="event-field">
              <label htmlFor="event-context">Context</label>
              <input
                type="text"
                {...validation('context')}
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
              {feedback('context')}
            </div>
          )}
          <div className="event-field">
            <label htmlFor="event-description">Description</label>
            <input
              type="text"
              {...validation('description')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {feedback('description')}
          </div>
          {eventContextAvailable(data) && (
            <div className="event-field">
              <label htmlFor="event-subject">Subject</label>
              <input
                type="text"
                {...validation('subject')}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              {feedback('subject')}
            </div>
          )}
        </div>
      </div>
      <div
        className="event-editor-actions"
        data-confirming={confirmDelete || !!pendingRequest}
        role="group"
        aria-label="Event actions"
      >
        {pendingRequest ? (
          <>
            <span className="event-delete-prompt" role="status">
              Unsaved changes
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                activeDraft.current = null;
                useSession.setState({ eventEditor: pendingRequest });
              }}
            >
              Discard changes
            </button>
            <button
              type="button"
              ref={keepEditingButton}
              onClick={() => {
                setPendingRequest(null);
                labelInput.current?.focus({ preventScroll: true });
              }}
            >
              Keep editing
            </button>
          </>
        ) : confirmDelete && selectedEvent ? (
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
                  close();
                } catch (err) {
                  setErrors({ form: (err as Error).message });
                }
              }}
            >
              Confirm delete event
            </button>
            <button
              type="button"
              title="Cancel event deletion"
              ref={keepEventButton}
              onClick={() => {
                setDeleteRequest(null);
                labelInput.current?.focus({ preventScroll: true });
              }}
            >
              Keep event
            </button>
          </>
        ) : (
          <>
            <button className="event-save" type="submit" disabled={busy} title="Save event changes">
              Save event
            </button>
            <button type="button" title="Cancel event changes" onClick={close}>
              Cancel
            </button>
            {selected !== 'new' && (
              <button
                type="button"
                className="event-delete"
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
      {feedback('form')}
    </form>
  );
}

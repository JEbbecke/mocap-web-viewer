import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MotionData } from '../motion/types';
import { timelineEvents } from '../motion/events';
import { openSessionEvent, useSession } from '../state/session';
import { TimelineSlider } from './TimelineSlider';
import {
  layoutEventMarkers,
  EVENT_MARKER_LAYOUT,
  eventContextClass,
  type EventMarkerGroup,
} from './eventClusters';
import { formatEventTime } from './eventTime';

function clusterDescription(group: EventMarkerGroup, rate: number) {
  const first = group.entries[0].event.time,
    last = group.entries.at(-1)!.event.time;
  return `${group.entries.length} events ${first === last ? `at ${formatEventTime(first, rate)}` : `from ${formatEventTime(first, rate)} to ${formatEventTime(last, rate)}`} seconds`;
}

function EventClusterPopup({
  id,
  group,
  rate,
  anchor,
  onClose,
  onSelect,
}: {
  id: string;
  group: EventMarkerGroup;
  rate: number;
  anchor: HTMLButtonElement;
  onClose: (restoreFocus: boolean) => void;
  onSelect: (index: number) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 320 });
  useLayoutEffect(() => {
    const panel = popup.current!;
    const place = () => {
      const marker = anchor.getBoundingClientRect();
      if (!anchor.isConnected || marker.bottom < 0 || marker.top > innerHeight) {
        onClose(false);
        return;
      }
      const bounds = panel.getBoundingClientRect();
      const above = Math.max(0, marker.top - 14),
        below = Math.max(0, innerHeight - marker.bottom - 14);
      const up = above >= Math.min(panel.scrollHeight, 320) || above >= below;
      const maxHeight = Math.min(320, up ? above : below);
      const height = Math.min(panel.scrollHeight, maxHeight);
      const next = {
        left: Math.max(
          8,
          Math.min(innerWidth - bounds.width - 8, marker.x + marker.width / 2 - bounds.width / 2),
        ),
        top: up ? Math.max(8, marker.top - height - 6) : marker.bottom + 6,
        maxHeight,
      };
      setPosition((old) =>
        old.left === next.left && old.top === next.top && old.maxHeight === next.maxHeight
          ? old
          : next,
      );
    };
    const outside = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node))
        onClose(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    };
    place();
    panel.querySelector<HTMLButtonElement>('[data-event-index]')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
    // The open group is a snapshot; data, mode or track-width changes dismiss it in the parent.
  }, []);
  return createPortal(
    <div
      ref={popup}
      id={id}
      role="dialog"
      aria-label={clusterDescription(group, rate)}
      className="event-cluster-popup"
      style={position}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const rows = [...popup.current!.querySelectorAll<HTMLButtonElement>('[data-event-index]')];
        const current = rows.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        rows[next]?.focus();
      }}
    >
      <div className="event-cluster-heading">
        <span>{group.entries.length} events</span>
        <button type="button" aria-label="Close event list" onClick={() => onClose(true)}>
          ×
        </button>
      </div>
      {group.entries.map(({ event, index }) => (
        <button
          type="button"
          key={index}
          data-event-index={index}
          className={`event-cluster-row ${eventContextClass(event.context)}`}
          aria-label={`Edit event ${event.label}, ${formatEventTime(event.time, rate)} seconds${event.context ? `, ${event.context}` : ''}, event ${index + 1}`}
          title={`${event.context} ${event.label} · ${event.time} s`}
          onClick={() => onSelect(index)}
        >
          <span className="event-cluster-color" aria-hidden="true" />
          <span className="event-cluster-label">
            {event.label}
            {event.context && <small>{event.context}</small>}
          </span>
          <span className="event-cluster-time">{formatEventTime(event.time, rate)} s</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Both modes retain the slider's exact shared percentage axis and marker area. */
export const TimelineEvents = memo(function TimelineEvents({ data }: { data: MotionData }) {
  const request = useSession((s) => s.eventEditor);
  const busy = useSession((s) => s.busy);
  const compact = useSession((s) => s.display.compactEventMarkers);
  const selected = request?.index ?? null;
  const axis = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const id = useId();
  const entries = useMemo(() => timelineEvents(data), [data.events, data.timeline]);
  const groups = useMemo(
    () => layoutEventMarkers(entries, width, compact ? 'compact' : 'context-aware'),
    [entries, width, compact],
  );
  const [open, setOpen] = useState<{
    group: EventMarkerGroup;
    anchor: HTMLButtonElement;
    events: MotionData['events'];
    width: number;
    request: typeof request;
    compact: boolean;
  } | null>(null);
  const close = (restore: boolean) => {
    setOpen(null);
    if (restore) {
      const fallback =
        axis.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
        document.querySelector<HTMLSelectElement>('.event-toolbar > select');
      (open?.anchor.isConnected ? open.anchor : fallback)?.focus({ preventScroll: true });
    }
  };
  useLayoutEffect(() => {
    const track = axis.current!;
    const measure = () => setWidth(Math.round(track.getBoundingClientRect().width * 100) / 100);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (
      open &&
      (open.events !== data.events ||
        open.width !== width ||
        open.request !== request ||
        open.compact !== compact ||
        busy)
    )
      close(open.width !== width && document.activeElement === document.body);
  }, [data.events, width, request, busy, compact, open]);
  const active =
    open &&
    open.events === data.events &&
    open.width === width &&
    open.request === request &&
    open.compact === compact &&
    !busy
      ? open
      : null;
  return (
    <div className="event-workspace">
      <div className="event-scroll" aria-label="Timeline events">
        <div
          className="event-markers"
          ref={axis}
          data-mode={compact ? 'compact' : 'context-aware'}
          style={{ height: EVENT_MARKER_LAYOUT.areaHeightPx }}
        >
          {groups.map((group) => {
            const { entries: members } = group;
            const first = members[0];
            const cluster = members.length > 1;
            const pressed = members.some((entry) => entry.index === selected);
            const expanded = active?.group === group;
            return (
              <button
                key={first.index}
                type="button"
                disabled={busy}
                className={`${pressed ? 'selected-event' : ''} ${cluster ? 'event-cluster' : eventContextClass(first.event.context)}`}
                style={{
                  left: `${group.percent}%`,
                  bottom: compact ? 0 : (1 - group.lane) * EVENT_MARKER_LAYOUT.laneSpacingPx,
                  width: cluster ? group.width : EVENT_MARKER_LAYOUT.markerHitWidthPx,
                }}
                data-event-lane={group.lane}
                data-event-index={cluster ? undefined : first.index}
                data-event-count={members.length}
                title={
                  cluster
                    ? clusterDescription(group, data.timeline.rate)
                    : `${first.event.context} ${first.event.label} · ${first.event.time} s`
                }
                aria-label={
                  cluster
                    ? clusterDescription(group, data.timeline.rate)
                    : `Edit event ${first.event.label}`
                }
                aria-pressed={pressed}
                aria-haspopup={cluster ? 'dialog' : undefined}
                aria-expanded={cluster ? expanded : undefined}
                aria-controls={expanded ? id : undefined}
                onClick={(event) => {
                  if (!cluster) openSessionEvent(first.index);
                  else if (expanded) close(true);
                  else
                    setOpen({
                      group,
                      anchor: event.currentTarget,
                      events: data.events,
                      width,
                      request,
                      compact,
                    });
                }}
              >
                {cluster ? members.length : <span className="event-pin" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
      <TimelineSlider data={data} />
      {active && (
        <EventClusterPopup
          key={active.group.entries[0].index}
          id={id}
          group={active.group}
          rate={data.timeline.rate}
          anchor={active.anchor}
          onClose={close}
          onSelect={(index) => {
            close(true);
            openSessionEvent(index);
          }}
        />
      )}
    </div>
  );
});

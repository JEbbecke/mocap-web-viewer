import { afterEach, expect, it } from 'vitest';
import {
  layoutEventMarkers,
  eventContext,
  eventContextClass,
  eventMarkerWidth,
  EVENT_MARKER_LAYOUT,
  type TimelineEventEntry,
  type EventMarkerMode,
} from '../src/components/eventClusters';
import { timelineEvents, eventSourceFrame } from '../src/motion/events';
import { cropMotionData } from '../src/motion/crop';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { useSession, setData, openSessionEvent, selectCrop } from '../src/state/session';
import { displayOptions } from '../src/components/displayOptions';
import { exportC3D } from '../src/exporters/c3d';

const entries = (...percent: number[]): TimelineEventEntry[] =>
  percent.map((value, index) => ({
    index,
    percent: value,
    event: {
      label: `Event ${index}`,
      context: 'Left',
      time: value / 100,
      description: `Description ${index}`,
      subject: 'Synthetic',
    },
  }));
const contexts = (values: string[], percent = values.map(() => 50)) =>
  entries(...percent).map((entry, i) => ({
    ...entry,
    event: { ...entry.event, context: values[i] },
  }));
const members = (
  input: TimelineEventEntry[],
  width = 1000,
  mode: EventMarkerMode = 'context-aware',
) => layoutEventMarkers(input, width, mode).map((g) => g.entries.map((e) => e.index));
const noCollisions = (input: TimelineEventEntry[], width: number, mode: EventMarkerMode) => {
  const groups = layoutEventMarkers(input, width, mode);
  for (const lane of [0, 1]) {
    const row = groups.filter((g) => g.lane === lane);
    for (let i = 1; i < row.length; i++)
      expect(
        ((row[i].percent - row[i - 1].percent) * width) / 100 -
          (row[i].width + row[i - 1].width) / 2,
      ).toBeGreaterThanOrEqual(EVENT_MARKER_LAYOUT.markerGapPx - 1e-8);
  }
  expect(groups.flatMap((g) => g.entries.map((e) => e.index)).sort((a, b) => a - b)).toEqual(
    input.map((e) => e.index).sort((a, b) => a - b),
  );
  return groups;
};
afterEach(() => useSession.setState(useSession.getInitialState(), true));

it('keeps empty, single and separated markers at their exact percentages', () => {
  expect(layoutEventMarkers([], 1000)).toEqual([]);
  const input = entries(0, 20, 50, 99.99);
  const groups = layoutEventMarkers(input, 1000);
  expect(groups.map((g) => g.percent)).toEqual([0, 20, 50, 99.99]);
  expect(groups.map((g) => g.width)).toEqual([10, 10, 10, 10]);
  expect(groups[2].entries[0]).toBe(input[2]);
});
it('fixes Left above Right and normalizes only established contexts', () => {
  const groups = layoutEventMarkers(
    contexts(['Left', ' right ', 'Rigth', 'LEFT'], [10, 30, 50, 70]),
    1000,
  );
  expect(groups.map((g) => g.lane)).toEqual([0, 1, 1, 0]);
});
it('keeps coincident Left and Right individually visible on two lanes', () => {
  const groups = layoutEventMarkers(contexts(['Left', 'Right']), 1000);
  expect(groups.map((g) => [g.entries[0].index, g.lane, g.percent])).toEqual([
    [0, 0, 50],
    [1, 1, 50],
  ]);
});
it.each(['Left', 'Right'])('clusters coincident %s events within their strict lane', (context) => {
  const groups = layoutEventMarkers(contexts([context, context]), 1000);
  expect(groups).toHaveLength(1);
  expect(groups[0].lane).toBe(context === 'Left' ? 0 : 1);
  expect(groups[0].entries.map((e) => e.index)).toEqual([0, 1]);
});
it('places General into a free lane without hiding a Left or Right', () => {
  for (const [context, lane] of [
    ['Left', 1],
    ['Right', 0],
  ] as const) {
    const groups = layoutEventMarkers(contexts([context, 'General']), 1000);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.entries[0].index === 1)!.lane).toBe(lane);
  }
});
it('uses future occupied regions, then maximum clearance and deterministic upper ties', () => {
  const groups = layoutEventMarkers(contexts(['General', 'Left', 'Right'], [50, 50.5, 55]), 1000);
  expect(groups.find((g) => g.entries.some((e) => e.index === 0))!.lane).toBe(1);
  expect(groups).toHaveLength(3);
  expect(layoutEventMarkers(contexts(['General']), 1000)[0].lane).toBe(0);
  const spaced = layoutEventMarkers(contexts(['Left', 'General', 'Right'], [40, 50, 52]), 1000);
  expect(spaced.find((g) => g.entries[0].index === 1)!.lane).toBe(0);
});
it('locally mixes General with Left for a three-context tie, leaving Right individual', () => {
  const groups = layoutEventMarkers(contexts(['Left', 'Right', 'General']), 1000);
  expect(groups.map((g) => [g.lane, g.entries.map((e) => e.index)])).toEqual([
    [0, [0, 2]],
    [1, [1]],
  ]);
});
it('prefers adding General to an existing cluster over hiding another context individual', () => {
  const groups = layoutEventMarkers(contexts(['Left', 'Left', 'Right', 'General']), 1000);
  expect(groups.map((g) => [g.lane, g.entries.map((e) => e.index)])).toEqual([
    [0, [0, 1, 3]],
    [1, [2]],
  ]);
});
it('never moves Left/Right to the other lane or creates a third lane', () => {
  const input = contexts(
    Array.from({ length: 300 }, (_, i) => ['Left', 'Right', 'Other'][i % 3]),
    Array.from({ length: 300 }, (_, i) => (i * 37) % 100),
  );
  const groups = noCollisions(input, 400, 'context-aware');
  for (const g of groups)
    for (const e of g.entries) {
      if (eventContext(e.event.context) === 'left') expect(g.lane).toBe(0);
      if (eventContext(e.event.context) === 'right') expect(g.lane).toBe(1);
      expect([0, 1]).toContain(g.lane);
    }
});
it('uses exactly one compact lane for all contexts', () => {
  const groups = layoutEventMarkers(
    contexts(['Left', 'Right', 'General'], [10, 30, 50]),
    1000,
    'compact',
  );
  expect(groups.map((g) => g.lane)).toEqual([0, 0, 0]);
  expect(groups).toHaveLength(3);
  expect(members(contexts(['Left', 'Right', 'General']), 1000, 'compact')).toEqual([[0, 1, 2]]);
});
it('uses visible 10px glyphs plus 1px, rather than the old 20px or 12px hit area', () => {
  expect(members(entries(50, 51.1), 1000, 'compact')).toEqual([[0], [1]]);
  expect(members(entries(50, 51.0999), 1000, 'compact')).toEqual([[0, 1]]);
  expect(members(entries(50, 51.2), 1000, 'compact')).toEqual([[0], [1]]);
  expect(members(entries(50, 50.8), 1000, 'compact')).toEqual([[0, 1]]);
  expect(
    layoutEventMarkers(entries(50, 51.1), 1000, 'compact', {
      ...EVENT_MARKER_LAYOUT,
      markerGapPx: 2,
    }),
  ).toHaveLength(1);
});
it.each(['context-aware', 'compact'] as const)(
  'splits and merges from actual track width in %s mode',
  (mode) => {
    const input = entries(30, 34, 75);
    expect(members(input, 1000, mode)).toEqual([[0], [1], [2]]);
    expect(members(input, 200, mode)).toEqual([[0, 1], [2]]);
    expect(members(input, 1000, mode)).toEqual([[0], [1], [2]]);
  },
);
it('retains same-time and same-label identities in deterministic order', () => {
  const input = entries(50, 50, 50, 50.1);
  input.forEach((e) => (e.event.label = 'Same'));
  const shuffled = [input[2], input[3], input[1], input[0]];
  const group = layoutEventMarkers(shuffled, 1000)[0];
  expect(group.entries).toEqual(input);
  input.forEach((entry, i) => expect(group.entries[i]).toBe(entry));
  expect(shuffled.map((e) => e.index)).toEqual([2, 3, 1, 0]);
});
it('accounts for real count-badge widths and preserves noncolliding neighbors', () => {
  const input = entries(...Array(30).fill(50), 51.5, 54);
  expect(members(input)).toEqual([Array.from({ length: 31 }, (_, i) => i), [31]]);
  expect(eventMarkerWidth(2)).toBe(20);
  expect(eventMarkerWidth(10000)).toBe(42);
  noCollisions(entries(...Array(100).fill(50), ...Array(100).fill(52)), 1000, 'compact');
});
it.each(['context-aware', 'compact'] as const)(
  'keeps edge badges inside the existing gutters in %s mode',
  (mode) => {
    const groups = noCollisions(
      entries(0, 0, 0.2, 8, 20, 50, 50.01, 80, 99.8, 99.9, 99.9),
      300,
      mode,
    );
    for (const g of groups) {
      expect(g.percent * 3 - g.width / 2).toBeGreaterThanOrEqual(-6);
      expect(g.percent * 3 + g.width / 2).toBeLessThanOrEqual(306);
    }
  },
);
it.each(['context-aware', 'compact'] as const)(
  'does not transitively merge a 40-event sequence in %s mode',
  (mode) => {
    // First 39 events are only 14px apart: the previous proximity rule merged all 39.
    const input = contexts(
      Array.from({ length: 40 }, (_, i) => ['Left', 'Right', 'General'][i % 3]),
      [...Array.from({ length: 39 }, (_, i) => 6 + i * 1.4), 98],
    );
    for (const width of [1000, 1640]) {
      const groups = noCollisions(input, width, mode);
      expect(groups).toHaveLength(40);
      expect(groups.every((g) => g.entries.length === 1)).toBe(true);
    }
  },
);
it('bounds clusters locally even in a chain of actually overlapping triangles', () => {
  const input = entries(...Array.from({ length: 40 }, (_, i) => 10 + i * 0.9));
  const groups = noCollisions(input, 1000, 'compact');
  expect(groups.length).toBeGreaterThan(8);
  expect(Math.max(...groups.map((g) => g.entries.length))).toBeLessThanOrEqual(4);
});
it.each(['context-aware', 'compact'] as const)(
  'keeps 10,000 dense events intact and locally grouped in %s mode',
  (mode) => {
    const input = contexts(
      Array.from({ length: 10000 }, (_, i) => ['Left', 'Right', 'Other'][i % 3]),
      Array.from({ length: 10000 }, (_, i) => i / 101),
    );
    input[0].event.time = 0.9900000000000002;
    const snapshot = structuredClone(input);
    const groups = noCollisions(
      Object.freeze(input) as unknown as TimelineEventEntry[],
      2000,
      mode,
    );
    expect(groups.length).toBeGreaterThan(20);
    expect(Math.max(...groups.map((g) => g.entries.length))).toBeLessThan(1000);
    for (const g of groups) for (const e of g.entries) expect(e).toBe(input[e.index]);
    expect(input).toEqual(snapshot);
  },
);
it.each(['context-aware', 'compact'] as const)(
  'retains crop visibility and nonzero source frames in %s mode',
  (mode) => {
    const original = parseC3D(physicalFixture(), 'cluster.c3d');
    const data = {
      ...original,
      events: [
        { ...original.events[0], context: 'Left', time: 0.01 },
        { ...original.events[0], context: 'Left', label: 'Second', time: 0.0101 },
        { ...original.events[0], label: 'Before', time: -0.01 },
        {
          ...original.events[0],
          label: 'End boundary',
          time: original.timeline.frameCount / original.timeline.rate,
        },
      ],
    };
    expect(timelineEvents(data).map((e) => e.index)).toEqual([0, 1]);
    expect(layoutEventMarkers(timelineEvents(data), 300, mode)).toHaveLength(1);
    const source = eventSourceFrame(data, data.events[0].time);
    const cropped = cropMotionData(
      data,
      data.events[0].time * data.timeline.rate,
      original.timeline.frameCount,
    );
    const group = layoutEventMarkers(timelineEvents(cropped), 300, mode)[0];
    expect(group.entries.map((e) => e.event.label)).toEqual([data.events[0].label, 'Second']);
    expect(eventSourceFrame(cropped, group.entries[0].event.time)).toBe(source);
    expect(data.events[0].time).toBe(0.01);
  },
);
it('retains individual server-rendered markers until measurement', () => {
  expect(members(entries(50, 50), 0)).toEqual([[0], [1]]);
});
it.each([
  ['Left', 'left'],
  [' left ', 'left'],
  ['RIGHT', 'right'],
  ['Rigth', 'right'],
  ['Other', 'other'],
  ['', 'other'],
  ['Leftward', 'other'],
  ['Right toe off', 'other'],
])('preserves context classification without changing %s', (context, color) => {
  expect(eventContextClass(context)).toBe(`event-context-${color}`);
});
it('defaults the Display preference off and keeps it outside scientific state and exports', () => {
  const data = parseC3D(physicalFixture(), 'display.c3d');
  setData(data);
  expect(useSession.getState().display.compactEventMarkers).toBe(false);
  expect(displayOptions(data)).toContainEqual(['compactEventMarkers', 'Compact event markers']);
  openSessionEvent(0);
  selectCrop(1, data.timeline.frameCount);
  const before = useSession.getState(),
    snapshot = structuredClone(data);
  const exported = () => {
    const current = useSession.getState().data!;
    return exportC3D(
      physicalFixture(),
      0,
      current.timeline.frameCount,
      current.events,
      current.markers.labels,
    );
  };
  const bytes = exported();
  for (const checked of [true, false, true]) {
    useSession.setState((s) => ({ display: { ...s.display, compactEventMarkers: checked } }));
    const after = useSession.getState();
    for (const key of [
      'data',
      'eventEditor',
      'frame',
      'playing',
      'cropSelection',
      'history',
      'dirty',
    ] as const)
      expect(after[key]).toBe(before[key]);
  }
  expect(data).toEqual(snapshot);
  expect(exported()).toEqual(bytes);
  setData(data);
  expect(useSession.getState().display.compactEventMarkers).toBe(true);
  expect(useSession.getInitialState().display.compactEventMarkers).toBe(false);
});

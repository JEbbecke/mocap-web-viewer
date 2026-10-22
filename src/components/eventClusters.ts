import type { timelineEvents } from '../motion/events';

export type TimelineEventEntry = ReturnType<typeof timelineEvents>[number];
export type EventMarkerMode = 'context-aware' | 'compact';
export type EventMarkerGroup = {
  entries: TimelineEventEntry[];
  /** Display position only; a cluster never creates a new event timestamp. */
  percent: number;
  width: number;
  /** Zero is the upper (Left) lane; one is the lower (Right) lane. */
  lane: number;
};

export const EVENT_MARKER_LAYOUT = {
  markerWidthPx: 10,
  markerGapPx: 1,
  markerHitWidthPx: 12,
  laneSpacingPx: 12,
  areaHeightPx: 24,
  axisGutterPx: 6,
  badgeMinWidthPx: 20,
  badgePaddingPx: 12,
  badgeDigitWidthPx: 6,
} as const;
export type EventMarkerLayoutConfig = { [K in keyof typeof EVENT_MARKER_LAYOUT]: number };

export const eventMarkerWidth = (
  count: number,
  config: EventMarkerLayoutConfig = EVENT_MARKER_LAYOUT,
) =>
  count === 1
    ? config.markerWidthPx
    : Math.max(
        config.badgeMinWidthPx,
        config.badgePaddingPx + String(count).length * config.badgeDigitWidthPx,
      );

/** Preserve the historical "Rigth" spelling, without matching arbitrary substrings. */
export function eventContext(context: string): 'left' | 'right' | 'other' {
  const value = context.trim().toLowerCase();
  return value === 'left' ? 'left' : ['right', 'rigth'].includes(value) ? 'right' : 'other';
}
export const eventContextClass = (context: string) => `event-context-${eventContext(context)}`;

type Member = { entry: TimelineEventEntry; next?: Member };
type Placed = {
  head: Member;
  tail: Member;
  count: number;
  min: number;
  max: number;
  center: number;
  width: number;
};
const compare = (a: TimelineEventEntry, b: TimelineEventEntry) =>
  a.percent - b.percent || a.index - b.index;

/**
 * Entries already use timelineEvents' visible range and exact shared percentage axis.
 * Both modes use the same visible-box collision solver. A merged badge replaces its
 * members' boxes: proximity between hidden members cannot propagate a merge chain.
 * Linked members keep dense merges linear; sorting costs O(n log n).
 */
export function layoutEventMarkers(
  entries: readonly TimelineEventEntry[],
  trackWidth: number,
  mode: EventMarkerMode = 'context-aware',
  config: EventMarkerLayoutConfig = EVENT_MARKER_LAYOUT,
): EventMarkerGroup[] {
  const sorted = [...entries].sort(compare);
  const place = (group: Placed) => {
    group.width = eventMarkerWidth(group.count, config);
    const midpoint = (group.min + group.max) / 2;
    group.center =
      group.count === 1
        ? midpoint
        : Math.max(
            group.width / 2 - config.axisGutterPx,
            Math.min(trackWidth - group.width / 2 + config.axisGutterPx, midpoint),
          );
    return group;
  };
  const single = (entry: TimelineEventEntry) => {
    const member = { entry };
    const position = (entry.percent * trackWidth) / 100;
    return place({
      head: member,
      tail: member,
      count: 1,
      min: position,
      max: position,
      center: position,
      width: config.markerWidthPx,
    });
  };
  const collides = (a: Placed, b: Placed) =>
    Math.abs(b.center - a.center) < (a.width + b.width) / 2 + config.markerGapPx - 1e-9;
  const append = (stack: Placed[], group: Placed) => {
    stack.push(group);
    while (stack.length > 1) {
      const right = stack[stack.length - 1],
        left = stack[stack.length - 2];
      if (!collides(left, right)) break;
      left.tail.next = right.head;
      left.tail = right.tail;
      left.count += right.count;
      left.min = Math.min(left.min, right.min);
      left.max = Math.max(left.max, right.max);
      place(left);
      stack.pop();
    }
  };
  if (!(trackWidth > 0))
    return sorted.map((entry) => ({
      entries: [entry],
      percent: entry.percent,
      width: config.markerWidthPx,
      lane: mode === 'context-aware' && eventContext(entry.event.context) === 'right' ? 1 : 0,
    }));
  const lanes: Placed[][] = mode === 'compact' ? [[]] : [[], []];
  if (mode === 'compact') {
    for (const entry of sorted) append(lanes[0], single(entry));
  } else {
    // Reserve strict Left/Right lanes first. General events never move them.
    const fixed: Placed[][] = [[], []];
    for (const entry of sorted) {
      const context = eventContext(entry.event.context);
      if (context !== 'other') append(fixed[context === 'left' ? 0 : 1], single(entry));
    }
    const cursors = [0, 0];
    for (const entry of sorted) {
      if (eventContext(entry.event.context) !== 'other') continue;
      const candidate = single(entry);
      const scores = lanes.map((stack, lane) => {
        while (
          cursors[lane] < fixed[lane].length &&
          fixed[lane][cursors[lane]].center <= candidate.center
        )
          append(stack, fixed[lane][cursors[lane]++]);
        const neighbors = [stack.at(-1), fixed[lane][cursors[lane]]].filter(
          (g): g is Placed => !!g,
        );
        const collisions = neighbors.filter((g) => collides(g, candidate));
        return {
          collisions: collisions.length,
          // Prefer retaining individual context markers when neither lane is free.
          singles: collisions.filter(
            (g) => g.count === 1 && eventContext(g.head.entry.event.context) !== 'other',
          ).length,
          members: collisions.reduce((n, g) => n + g.count, 0),
          clearance: Math.min(
            ...neighbors.map(
              (g) => Math.abs(g.center - candidate.center) - (g.width + candidate.width) / 2,
            ),
          ),
        };
      });
      const [upper, lower] = scores;
      const lane =
        (upper.collisions === 0) !== (lower.collisions === 0)
          ? upper.collisions === 0
            ? 0
            : 1
          : upper.singles !== lower.singles
            ? upper.singles < lower.singles
              ? 0
              : 1
            : upper.members !== lower.members
              ? upper.members < lower.members
                ? 0
                : 1
              : lower.clearance > upper.clearance
                ? 1
                : 0;
      append(lanes[lane], candidate);
    }
    for (let lane = 0; lane < 2; lane++)
      while (cursors[lane] < fixed[lane].length) append(lanes[lane], fixed[lane][cursors[lane]++]);
  }
  return lanes
    .flatMap((groups, lane) =>
      groups.map((group) => {
        const members: TimelineEventEntry[] = [];
        for (let member: Member | undefined = group.head; member; member = member.next)
          members.push(member.entry);
        members.sort(compare);
        return {
          entries: members,
          percent: group.count === 1 ? members[0].percent : (group.center / trackWidth) * 100,
          width: group.width,
          lane,
        };
      }),
    )
    .sort(
      (a, b) => a.percent - b.percent || a.lane - b.lane || a.entries[0].index - b.entries[0].index,
    );
}

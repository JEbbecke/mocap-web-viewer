import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseC3D } from '../src/importers/c3d/importer';
import { cropMotionData } from '../src/motion/crop';
import { exportC3D } from '../src/exporters/c3d';
import {
  applyCrop,
  cancelCrop,
  redoEdit,
  renameSessionMarker,
  restoreOriginal,
  selectCrop,
  setData,
  undoEdit,
  useSession,
} from '../src/state/session';
import { physicalFixture } from './helpers/c3d';
import { rotationFixture } from './helpers/rotationC3d';

beforeEach(() => {
  setData(parseC3D(physicalFixture(), 'crop.c3d'));
});
afterEach(() => useSession.setState(useSession.getInitialState(), true));

it.each(['start', 'end'] as const)(
  'restoring both boundaries (%s first) cancels only the provisional state',
  (first) => {
    useSession.setState({ frame: 17, playing: true, plot: 'analog:0', saved: true });
    const before = useSession.getState();
    const snapshot = structuredClone(before.data);
    selectCrop(100, 300);
    expect(useSession.getState().cropSelection).toEqual({ start: 100, end: 300 });
    if (first === 'start') selectCrop(0, 300);
    else selectCrop(100, 400);
    expect(useSession.getState().cropSelection).not.toBeNull();
    selectCrop(0, 400);
    expect(useSession.getState()).toEqual({ ...before, playing: false });
    expect(useSession.getState().data).toBe(before.data);
    expect(useSession.getState().history).toBe(before.history);
    expect(useSession.getState().data).toEqual(snapshot);
    applyCrop();
    expect(useSession.getState().data).toBe(before.data);
    expect(useSession.getState().dirty).toBe(false);
  },
);

it('uses the same transition as explicit Cancel, without creating undo/redo entries', () => {
  renameSessionMarker(0, 'Edited marker');
  undoEdit();
  const before = useSession.getState();
  selectCrop(1, 399);
  cancelCrop();
  const explicit = useSession.getState();
  selectCrop(1, 399);
  selectCrop(0, 400);
  expect(useSession.getState()).toEqual(explicit);
  expect(useSession.getState().history).toBe(before.history);
  cancelCrop();
  selectCrop(0, 400);
  expect(useSession.getState()).toEqual(explicit);
  redoEdit();
  expect(useSession.getState().data!.markers.labels).toEqual(['Edited marker']);
});

it('preserves an applied crop, its source origin, and subsequent edit undo/redo', () => {
  const original = useSession.getState().data!;
  selectCrop(100, 300);
  applyCrop();
  const applied = useSession.getState().data!;
  expect(applied.source.crop).toEqual({ start: 100, end: 300 });
  expect(applied.timeline).toMatchObject({ firstFrame: 136, frameCount: 200, rate: 200 });
  expect(useSession.getState().history.past).toHaveLength(0);
  renameSessionMarker(0, 'First edit');
  renameSessionMarker(0, 'Second edit');
  undoEdit();
  const before = useSession.getState();
  selectCrop(1, 199);
  selectCrop(0, 200);
  expect(useSession.getState()).toEqual(before);
  expect(useSession.getState().data).toBe(before.data);
  expect(useSession.getState().originalData).toBe(original);
  expect(useSession.getState().history).toBe(before.history);
  undoEdit();
  expect(useSession.getState().data!.markers.labels).toEqual(applied.markers.labels);
  redoEdit();
  redoEdit();
  expect(useSession.getState().data!.markers.labels).toEqual(['Second edit']);
  expect(useSession.getState().data!.source.crop).toEqual({ start: 100, end: 300 });
  expect(useSession.getState().data!.timeline).toEqual(applied.timeline);
  expect(useSession.getState().dirty).toBe(true);
  restoreOriginal();
  expect(useSession.getState().data).toBe(original);
});

it.each([1, 2, 3])('handles %i-frame recordings with a nonzero source origin', (count) => {
  const source = parseC3D(rotationFixture(), 'short.c3d');
  const data = count === 3 ? source : cropMotionData(source, 0, count);
  setData(data);
  if (count > 1) {
    selectCrop(1, count);
    expect(useSession.getState().cropSelection).toEqual({ start: 1, end: count });
  }
  selectCrop(0, count);
  applyCrop();
  expect(useSession.getState().cropSelection).toBeNull();
  expect(useSession.getState().data).toBe(data);
  expect(useSession.getState().data!.timeline.firstFrame).toBe(36);
  expect(useSession.getState().history.past).toHaveLength(0);
});

it('requires exact valid local half-open boundaries regardless of rate or source frame', () => {
  const data = useSession.getState().data!;
  setData({ ...data, timeline: { ...data.timeline, firstFrame: 70000, rate: 10000 } });
  selectCrop(0, 399); // The last sample index is not the exclusive end.
  const partial = useSession.getState().cropSelection;
  for (const [start, end] of [
    [-1, 400],
    [0, 401],
    [0.000001, 400],
    [0, 399.999999],
    [0, 0],
    [400, 400],
    [1, 0],
    [70000, 70400],
    [NaN, 400],
    [0, Infinity],
  ]) {
    selectCrop(start, end);
    expect(useSession.getState().cropSelection).toBe(partial);
  }
  selectCrop(0, 400);
  expect(useSession.getState().cropSelection).toBeNull();
  expect(useSession.getState().data!.timeline).toMatchObject({ firstFrame: 70000, rate: 10000 });
});

it.each([false, true])('preserves C3D export bytes after cancellation (applied=%s)', (applied) => {
  const bytes = physicalFixture();
  if (applied) {
    selectCrop(100, 300);
    applyCrop();
  }
  const before = useSession.getState().data!;
  const range = before.source.crop ?? { start: 0, end: before.timeline.frameCount };
  const expected = exportC3D(bytes, range.start, range.end);
  selectCrop(1, before.timeline.frameCount - 1);
  selectCrop(0, before.timeline.frameCount);
  expect(useSession.getState().data).toBe(before);
  const after = useSession.getState().data!;
  const retained = after.source.crop ?? { start: 0, end: after.timeline.frameCount };
  expect(exportC3D(bytes, retained.start, retained.end)).toEqual(expected);
});

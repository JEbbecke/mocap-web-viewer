import { expect, it } from 'vitest';
import { cropPreviewInterval, outsideCropRegions } from '../src/plots/cropPreview';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';
import { applyCrop, selectCrop, setData, useSession } from '../src/state/session';
import { sampleTime } from '../src/explorer/datasets';

function fixture() {
  const data = parseC3D(physicalFixture(), 'synthetic.c3d');
  const count = data.markers.labels.length;
  data.timeline = { ...data.timeline, frameCount: 10, rate: 100, duration: 0.09 };
  data.markers.positions = new Float64Array(10 * count * 3).fill(1);
  data.markers.valid = new Uint8Array(10 * count).fill(1);
  return data;
}
const domain = { start: 0, end: 0.1 };

it('has no shading without a crop or with the complete trial selected', () => {
  const data = fixture();
  expect(cropPreviewInterval(data, null)).toBeNull();
  expect(cropPreviewInterval(data, { start: 0, end: 10 })).toBeNull();
  expect(outsideCropRegions(null, domain)).toEqual({ before: null, after: null });
});

it('shows both outside regions for a middle crop and one for endpoint crops', () => {
  const data = fixture();
  expect(outsideCropRegions(cropPreviewInterval(data, { start: 2, end: 7 }), domain)).toEqual({
    before: { start: 0, end: 0.02 },
    after: { start: 0.07, end: 0.1 },
  });
  expect(outsideCropRegions(cropPreviewInterval(data, { start: 0, end: 7 }), domain)).toEqual({
    before: null,
    after: { start: 0.07, end: 0.1 },
  });
  expect(outsideCropRegions(cropPreviewInterval(data, { start: 2, end: 10 }), domain)).toEqual({
    before: { start: 0, end: 0.02 },
    after: null,
  });
});

it('uses physical time independently of stream rate, origin and sample indices', () => {
  const data = fixture();
  const signal = { values: new Float64Array(50), components: 1, rate: 500, startTime: 0.001 };
  const range = cropPreviewInterval(data, { start: 2, end: 7 })!;
  expect(range).toEqual({ start: 0.02, end: 0.07 });
  expect(sampleTime(signal, 2)).toBe(0.005);
  expect(
    outsideCropRegions(range, { start: sampleTime(signal, 0), end: sampleTime(signal, 49) }),
  ).toEqual({
    before: { start: 0.001, end: 0.02 },
    after: { start: 0.07, end: 0.099 },
  });
  // Retained independent model results must not imply future sample removal.
  expect(cropPreviewInterval(data, { start: 2, end: 7 }, false)).toBeNull();
});

it('intersects zoomed/panned domains without moving the underlying crop times', () => {
  const range = { start: 0.02, end: 0.07 };
  expect(outsideCropRegions(range, { start: 0.01, end: 0.08 })).toEqual({
    before: { start: 0.01, end: 0.02 },
    after: { start: 0.07, end: 0.08 },
  });
  expect(outsideCropRegions(range, { start: 0.03, end: 0.06 })).toEqual({
    before: null,
    after: null,
  });
  expect(outsideCropRegions(range, { start: 0.08, end: 0.09 })).toEqual({
    before: null,
    after: { start: 0.08, end: 0.09 },
  });
  expect(outsideCropRegions(range, { start: 0, end: 0.01 })).toEqual({
    before: { start: 0, end: 0.01 },
    after: null,
  });
  expect(range).toEqual({ start: 0.02, end: 0.07 });
});

it('clears the preview on cancel/completion and never edits data or history during selection', () => {
  const data = fixture();
  setData(data);
  const before = useSession.getState();
  selectCrop(2, 7);
  const state = useSession.getState();
  expect(cropPreviewInterval(data, state.cropSelection)).not.toBeNull();
  expect(state.data).toBe(data);
  expect(state.history).toBe(before.history);
  expect(state.dirty).toBe(before.dirty);
  useSession.setState({ cropSelection: null });
  expect(cropPreviewInterval(data, useSession.getState().cropSelection)).toBeNull();
  selectCrop(2, 7);
  applyCrop();
  expect(useSession.getState().data!.timeline.frameCount).toBe(5);
  expect(
    cropPreviewInterval(useSession.getState().data!, useSession.getState().cropSelection),
  ).toBeNull();
});

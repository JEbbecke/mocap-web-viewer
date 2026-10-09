import type { MotionData } from '../motion/types';
import { cropInterval } from '../motion/crop';

export type TimeRange = { start: number; end: number };

/** Current trial seconds; independent retained model results have no removal preview. */
export function cropPreviewInterval(
  data: MotionData,
  selection: { start: number; end: number } | null,
  croppedWithTrial = true,
): TimeRange | null {
  if (
    !croppedWithTrial ||
    !selection ||
    (selection.start === 0 && selection.end === data.timeline.frameCount)
  )
    return null;
  return cropInterval(data, selection.start, selection.end);
}

/** Intersect time regions with the current visible domain, never signal sample indices. */
export function outsideCropRegions(interval: TimeRange | null, domain: TimeRange) {
  const intersect = (start: number, end: number): TimeRange | null => {
    const a = Math.max(domain.start, start),
      b = Math.min(domain.end, end);
    return b > a ? { start: a, end: b } : null;
  };
  return {
    before: interval ? intersect(domain.start, interval.start) : null,
    after: interval ? intersect(interval.end, domain.end) : null,
  };
}

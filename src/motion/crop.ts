import type { MotionData, Series } from './types';

/** Zero-based point boundaries: [start, end), including every analog subframe. */
export function cropInterval(data: MotionData, start: number, end: number) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= end ||
    end > data.timeline.frameCount
  )
    throw new Error('Choose a crop start before the end, within the recording.');
  return { start: start / data.timeline.rate, end: end / data.timeline.rate };
}

// Snap only floating-point arithmetic noise at integer sample boundaries.
export function sampleBoundary(time: number, rate: number, origin = 0) {
  const x = (time - origin) * rate;
  const nearest = Math.round(x);
  return Math.abs(x - nearest) < 1e-8 ? nearest : Math.ceil(x);
}

export function timeBoundary(times: ArrayLike<number>, time: number) {
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < time - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function cropSeries(series: Series, start: number, end: number): Series {
  const count = series.values.length / series.components;
  const a = series.times
    ? timeBoundary(series.times, start)
    : Math.max(0, Math.min(count, sampleBoundary(start, series.rate, series.startTime)));
  const b = series.times
    ? timeBoundary(series.times, end)
    : Math.max(a, Math.min(count, sampleBoundary(end, series.rate, series.startTime)));
  return {
    ...series,
    values: series.values.slice(a * series.components, b * series.components),
    startTime: (series.times?.[a] ?? series.startTime + a / series.rate) - start,
    ...(series.times ? { times: series.times.slice(a, b).map((t) => t - start) } : {}),
  };
}

/** Event times in C3D are float32; snap representational noise at crop boundaries. */
export function eventInInterval(time: number, start: number, end: number, origin = 0) {
  const tolerance = 1e-7 * Math.max(1, Math.abs(origin + time));
  const snapped =
    Math.abs(time - start) <= tolerance ? start : Math.abs(time - end) <= tolerance ? end : time;
  return snapped >= start && snapped < end;
}

export function cropMotionData(data: MotionData, startFrame: number, endFrame: number): MotionData {
  const interval = cropInterval(data, startFrame, endFrame);
  const cut = (s: Series) => cropSeries(s, interval.start, interval.end);
  const count = data.markers.labels.length;
  const frameCount = endFrame - startFrame;
  return {
    ...data,
    source: {
      ...data.source,
      ...(data.source.timeOrigin !== undefined
        ? { timeOrigin: data.source.timeOrigin + interval.start }
        : {}),
      crop: {
        start: (data.source.crop?.start ?? 0) + startFrame,
        end: (data.source.crop?.start ?? 0) + endFrame,
      },
    },
    timeline: {
      ...data.timeline,
      firstFrame: data.timeline.firstFrame + startFrame,
      frameCount,
      duration: (frameCount - 1) / data.timeline.rate,
    },
    markers: {
      labels: [...data.markers.labels],
      positions: data.markers.positions.slice(startFrame * count * 3, endFrame * count * 3),
      valid: data.markers.valid.slice(startFrame * count, endFrame * count),
      residuals: data.markers.residuals?.slice(startFrame * count, endFrame * count),
      ...(data.markers.quality
        ? {
            quality: {
              ...data.markers.quality,
              type: data.markers.quality.type?.slice(startFrame * count, endFrame * count),
              cameraMasks: data.markers.quality.cameraMasks?.slice(
                startFrame * count * data.markers.quality.cameraCount,
                endFrame * count * data.markers.quality.cameraCount,
              ),
            },
          }
        : {}),
    },
    analogs: data.analogs.map((a) => ({ ...a, signal: cut(a.signal) })),
    signals: data.signals?.map((a) => ({ ...a, signal: cut(a.signal) })),
    rigidBodies: data.rigidBodies?.map((b) => ({
      ...b,
      position: cut(b.position),
      rotation: b.rotation && cut(b.rotation),
    })),
    forcePlatforms: data.forcePlatforms.map((p) => ({
      ...p,
      force: cut(p.force),
      moment: cut(p.moment),
      cop: cut(p.cop),
      freeMoment: p.freeMoment && cut(p.freeMoment),
      position:
        p.position &&
        (p.position.values.length === p.position.components ? p.position : cut(p.position)),
      rotation:
        p.rotation &&
        (p.rotation.values.length === p.rotation.components ? p.rotation : cut(p.rotation)),
      corners:
        p.corners &&
        (p.corners.values.length === p.corners.components
          ? { ...p.corners, values: p.corners.values.slice(), startTime: 0 }
          : cut(p.corners)),
    })),
    events: data.events
      .filter((e) =>
        eventInInterval(
          e.time,
          interval.start,
          interval.end,
          data.timeline.firstFrame / data.timeline.rate,
        ),
      )
      .map((e) => ({ ...e, time: Math.max(0, e.time - interval.start) })),
    warnings: [...data.warnings],
  };
}

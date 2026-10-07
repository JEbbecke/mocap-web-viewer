export interface VideoSchedule {
  start: number;
  end: number;
  fps: 30 | 60;
  speed: 1 | 0.5 | 0.25;
  durationUs: number;
  frameCount: number;
}
export function videoSchedule(
  start: number,
  end: number,
  fps: 30 | 60,
  speed: 1 | 0.5 | 0.25,
): VideoSchedule {
  if (
    ![start, end].every(Number.isFinite) ||
    end <= start ||
    ![30, 60].includes(fps) ||
    ![1, 0.5, 0.25].includes(speed)
  )
    throw new Error(
      'Video export requires a non-zero recorded time range and supported frame rate/speed.',
    );
  const durationUs = Math.round(((end - start) / speed) * 1e6);
  if (durationUs < 1)
    throw new Error('This recording is too short for video export. Export an image instead.');
  const count = ((end - start) / speed) * fps;
  const near = Math.round(count);
  const frameCount = Math.ceil(Math.abs(count - near) < 1e-9 ? near : count);
  if (durationUs > 120e6 || frameCount > 7200)
    throw new Error(
      'Video export supports up to two minutes. Crop the trial or choose a faster export speed.',
    );
  return { start, end, fps, speed, durationUs, frameCount };
}
/** Half-open physical span; shorten the final output frame to the exact end, rounded to microseconds. */
export function videoFrameTime(schedule: VideoSchedule, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= schedule.frameCount)
    throw new Error('Video frame is outside the export range.');
  const timestamp = Math.round((index / schedule.fps) * 1e6);
  const duration =
    Math.min(schedule.durationUs, Math.round(((index + 1) / schedule.fps) * 1e6)) - timestamp;
  if (duration <= 0) throw new Error('The video time range is below the encoder timing precision.');
  return { time: schedule.start + (index / schedule.fps) * schedule.speed, timestamp, duration };
}

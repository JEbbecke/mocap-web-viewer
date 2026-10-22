import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { advanceFrame, startClock } from '../src/playback/clock';
import { setData, setFrame, togglePlay, useSession } from '../src/state/session';
import { MOTION_UNITS } from '../src/motion/units';
import type { MotionData } from '../src/motion/types';
import { Timeline } from '../src/components/Timeline';

function recording(
  rate: number,
  firstFrame = 923,
  format = 'C3D',
  frameCount = rate * 4 + 1,
): MotionData {
  return {
    units: MOTION_UNITS,
    name: 'synthetic',
    source: { format, originalPositionUnit: 'mm', metadata: {} },
    timeline: { rate, firstFrame, frameCount, duration: (frameCount - 1) / rate },
    markers: {
      labels: ['A'],
      positions: new Float32Array(frameCount * 3),
      valid: new Uint8Array(frameCount).fill(1),
    },
    analogs: [],
    forcePlatforms: [],
    events: [],
    warnings: [],
  };
}

let now = 0;
let callback: FrameRequestCallback;
let stop: (() => void) | undefined;
let nextId = 0;
const listeners = new Map<string, () => void>();
function tick(time: number) {
  now = time;
  callback(time);
}

beforeEach(() => {
  now = 0;
  nextId = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((fn: FrameRequestCallback) => {
      callback = fn;
      return ++nextId;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('document', {
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  setData(recording(240));
  useSession.setState({ speed: 1, loop: false });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  listeners.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('declared-timebase playback', () => {
  for (const rate of [60, 100, 120, 200, 240])
    for (const speed of [0.5, 1, 2])
      it.each([15, 60, 144])(
        `${rate} Hz at ${speed}x advances by elapsed time at %s browser FPS`,
        (fps) => {
          setData(recording(rate));
          useSession.setState({ speed, playing: true });
          stop = startClock();
          for (let i = 1; i <= fps; i++) tick((i * 1000) / fps);
          expect(Math.abs(useSession.getState().frame - rate * speed)).toBeLessThanOrEqual(1);
          expect(useSession.getState().data!.timeline.rate).toBe(rate);
          expect(useSession.getState().data!.timeline.firstFrame).toBe(923);
          expect(useSession.getState().playing).toBe(true);
        },
      );

  it.each([0.5, 1, 2])('reaches the last sample after (N - 1) / rate / %s seconds', (speed) => {
    const data = recording(240, 923, 'C3D', 3301);
    setData(data);
    useSession.setState({ speed, playing: true });
    stop = startClock();
    tick((13750 - 10) / speed);
    expect(useSession.getState().playing).toBe(true);
    tick(13750 / speed);
    expect(useSession.getState()).toMatchObject({ frame: 3300, playing: false });
  });

  it('does not accumulate paused time and resumes/ seeks on the same local clock', () => {
    useSession.setState({ playing: true });
    stop = startClock();
    tick(100);
    togglePlay();
    const paused = useSession.getState().frame;
    tick(10100);
    expect(useSession.getState().frame).toBe(paused);
    togglePlay();
    tick(10125);
    expect(useSession.getState().frame).toBeCloseTo(paused + 6, 0);
    setFrame(100);
    tick(10250);
    expect(useSession.getState().frame).toBe(130);
  });

  it('loops on the half-open sample span, while stopping at the final timestamp without looping', () => {
    expect(advanceFrame(239, 0.01, 240, 1, 240, true).position).toBeCloseTo(1.4);
    expect(advanceFrame(239, 0.01, 240, 1, 240, false)).toEqual({ position: 239, ended: true });
    useSession.setState({ playing: true, loop: true, cropSelection: { start: 100, end: 340 } });
    stop = startClock();
    tick(500);
    expect(useSession.getState().frame).toBe(220);
    tick(1250);
    expect(useSession.getState().frame).toBe(160);
    expect(useSession.getState().playing).toBe(true);
  });

  it('does not catch up across a visibility reset and releases its RAF listener', () => {
    useSession.setState({ playing: true });
    stop = startClock();
    tick(100);
    now = 10000;
    listeners.get('visibilitychange')!();
    tick(10025);
    expect(useSession.getState().frame).toBe(30);
    stop();
    stop = undefined;
    expect(cancelAnimationFrame).toHaveBeenCalledWith(nextId);
    expect(listeners.has('visibilitychange')).toBe(false);
  });

  it('uses the newly loaded rate without interpreting the source first frame as elapsed time', () => {
    useSession.setState({ playing: true });
    stop = startClock();
    tick(1000);
    expect(useSession.getState().frame).toBe(240);
    setData(recording(60, 12000, 'H5'));
    tick(2000);
    expect(useSession.getState().frame).toBe(0);
    togglePlay();
    tick(3000);
    expect(useSession.getState().frame).toBe(60);
  });

  it('shows the final sample timestamp while keeping crop boundaries half-open', () => {
    const data = recording(240, 923, 'C3D', 3301);
    setData(data);
    const html = renderToStaticMarkup(createElement(Timeline, { data }));
    expect(html).toMatch(/<span>13\.750 s<\/span>/);
    expect(html).toContain('13.754 seconds'); // exclusive crop boundary, not last sample
  });
});

import { useSession } from '../state/session';
let mediaHolds = 0,
  resumedAt = 0;
/** Hold playback without writing frame/playing/session state or catching up after a media job. */
export function holdPlaybackClock() {
  mediaHolds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mediaHolds--;
    resumedAt = performance.now();
  };
}
export function advanceFrame(
  frame: number,
  elapsed: number,
  rate: number,
  speed: number,
  count: number,
  loop: boolean,
) {
  const next = frame + elapsed * rate * speed;
  return {
    position: loop ? next % count : Math.min(next, count - 1),
    ended: !loop && next >= count - 1,
  };
}
export function startClock() {
  let id = 0,
    last = performance.now(),
    position = useSession.getState().frame,
    lastFrame = position;
  const tick = (now: number) => {
    const state = useSession.getState();
    if (state.frame !== lastFrame) position = state.frame;
    last = Math.max(last, resumedAt);
    if (mediaHolds) {
      last = now;
      id = requestAnimationFrame(tick);
      return;
    }
    if (state.playing && state.data) {
      const start = state.cropSelection?.start ?? 0;
      const end = state.cropSelection?.end ?? state.data.timeline.frameCount;
      if (position < start || position >= end) position = start;
      const next = advanceFrame(
        position - start,
        Math.max(0, now - last) / 1000,
        state.data.timeline.rate,
        state.speed,
        end - start,
        state.loop,
      );
      position = start + next.position;
      lastFrame = Math.floor(position);
      useSession.setState({ frame: lastFrame, playing: !next.ended });
    } else {
      position = state.frame;
      lastFrame = state.frame;
    }
    last = now;
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  const visibility = () => {
    last = performance.now();
  };
  document.addEventListener('visibilitychange', visibility);
  return () => {
    cancelAnimationFrame(id);
    document.removeEventListener('visibilitychange', visibility);
  };
}

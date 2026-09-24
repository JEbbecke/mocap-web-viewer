import { useSession } from '../state/session';
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
    if (state.playing && state.data) {
      const start = state.cropSelection?.start ?? 0;
      const end = state.cropSelection?.end ?? state.data.timeline.frameCount;
      if (position < start || position >= end) position = start;
      const next = advanceFrame(
        position - start,
        (now - last) / 1000,
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

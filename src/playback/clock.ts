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
      const next = advanceFrame(
        position,
        (now - last) / 1000,
        state.data.timeline.rate,
        state.speed,
        state.data.timeline.frameCount,
        state.loop,
      );
      position = next.position;
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

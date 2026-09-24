import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { selectCrop, setFrame, useSession } from '../state/session';
import type { MotionData } from '../motion/types';

/** Two crop boundaries share the playback time axis; the thin line is the playhead. */
export function TimelineSlider({ data }: { data: MotionData }) {
  const frame = useSession((s) => s.frame);
  const selection = useSession((s) => s.cropSelection);
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; value: number } | null>(null);
  const { frameCount, rate, firstFrame } = data.timeline;
  const start = selection?.start ?? 0,
    end = selection?.end ?? frameCount;
  const origin = firstFrame + (data.source.format === 'C3D' ? 1 : 0);
  const percent = (value: number) => `${(100 * value) / frameCount}%`;
  const keyValue = (event: KeyboardEvent, value: number, min: number, max: number) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -10,
      PageUp: 10,
    };
    let next;
    if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key in steps) next = value + steps[event.key];
    else return;
    event.preventDefault();
    event.stopPropagation();
    return Math.max(min, Math.min(max, next));
  };
  const seek = (event: PointerEvent) => {
    const box = rail.current!.getBoundingClientRect();
    useSession.setState({ playing: false });
    setFrame(((event.clientX - box.left) / box.width) * frameCount);
  };
  return (
    <>
      <div className="timeline-slider" ref={rail}>
        <div className="timeline-rail" />
        <div
          className="timeline-included"
          style={{ left: percent(start), width: percent(end - start) }}
        />
        <div
          className="timeline-seek"
          role="slider"
          tabIndex={0}
          aria-label="Frame"
          aria-valuemin={0}
          aria-valuemax={frameCount - 1}
          aria-valuenow={frame}
          aria-valuetext={`Frame ${frame + 1}, ${(frame / rate).toFixed(3)} seconds`}
          onPointerDown={(event) => {
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            seek(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={(event) => {
            const value = keyValue(event, frame, 0, frameCount - 1);
            if (value !== undefined) {
              useSession.setState({ playing: false });
              setFrame(value);
            }
          }}
        />
        <span className="timeline-playhead" style={{ left: percent(frame) }} />
        {(['start', 'end'] as const).map((boundary) => {
          const isStart = boundary === 'start',
            value = isStart ? start : end;
          const min = isStart ? 0 : start + 1,
            max = isStart ? end - 1 : frameCount;
          const change = (next: number) => {
            selectCrop(isStart ? next : start, isStart ? end : next);
            // Follow the handle; the exclusive recording-end boundary uses the last frame.
            setFrame(next);
          };
          const label = `Crop ${boundary}`;
          const text = `Frame ${origin + value}${isStart ? '' : ' (exclusive)'}, ${(value / rate).toFixed(3)} seconds`;
          return (
            <button
              key={boundary}
              type="button"
              role="slider"
              className={`crop-handle crop-handle-${boundary}`}
              style={{ left: percent(value) }}
              aria-label={label}
              aria-orientation="horizontal"
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value}
              aria-valuetext={text}
              title={`${label}: ${text}. Drag or use arrow keys.`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.focus();
                drag.current = { x: event.clientX, value };
                event.currentTarget.setPointerCapture(event.pointerId);
                change(value);
              }}
              onPointerMove={(event) => {
                if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId))
                  return;
                const next =
                  drag.current.value +
                  Math.round(
                    ((event.clientX - drag.current.x) /
                      rail.current!.getBoundingClientRect().width) *
                      frameCount,
                  );
                change(Math.max(min, Math.min(max, next)));
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                // Return arrow keys to frame stepping after a pointer drag.
                // Tabbing to this handle still permits precise keyboard crop adjustment.
                event.currentTarget.blur();
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onKeyDown={(event) => {
                const next = keyValue(event, value, min, max);
                if (next !== undefined) change(next);
              }}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="crop-readout">
        <span>
          Start {origin + start} · {(start / rate).toFixed(3)} s
        </span>
        <span>{((end - start) / rate).toFixed(3)} s selected</span>
        <span title="Exclusive end boundary">
          End {origin + end} · {(end / rate).toFixed(3)} s
        </span>
      </div>
    </>
  );
}

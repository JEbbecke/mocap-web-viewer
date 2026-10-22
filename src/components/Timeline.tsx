import { applyCrop, restoreOriginal, setFrame, togglePlay, useSession } from '../state/session';
import type { MotionData } from '../motion/types';
import type { Ref } from 'react';
import { EventControls, EventEditor, TimelineEvents } from './EventEditor';

export function Timeline({
  data,
  controlsRef,
}: {
  data: MotionData;
  controlsRef?: Ref<HTMLDivElement>;
}) {
  const frame = useSession((s) => s.frame),
    playing = useSession((s) => s.playing),
    selection = useSession((s) => s.cropSelection),
    file = useSession((s) => s.sourceFile),
    dirty = useSession((s) => s.dirty),
    speed = useSession((s) => s.speed),
    loop = useSession((s) => s.loop),
    busy = useSession((s) => s.busy);
  return (
    <section className="timeline-section" aria-label="Timeline">
      <div ref={controlsRef} className="timeline">
        <div className="transport" role="group" aria-label="Playback">
          <button
            aria-label="Jump to beginning"
            title="Jump to first frame (Home)"
            onClick={() => setFrame(0)}
          >
            ⏮
          </button>
          <button
            aria-label="Previous frame"
            title="Previous frame (←)"
            onClick={() => {
              useSession.setState({ playing: false });
              setFrame(frame - 1);
            }}
          >
            ‹
          </button>
          <button
            className="play-button"
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={togglePlay}
          >
            {playing ? 'Ⅱ' : '▶'}
          </button>
          <button
            aria-label="Next frame"
            title="Next frame (→)"
            onClick={() => {
              useSession.setState({ playing: false });
              setFrame(frame + 1);
            }}
          >
            ›
          </button>
          <button
            aria-label="Jump to end"
            title="Jump to last frame (End)"
            onClick={() => setFrame(data.timeline.frameCount - 1)}
          >
            ⏭
          </button>
        </div>
        <div className="scrubber">
          <div className="time-labels">
            <strong>
              {(frame / data.timeline.rate).toFixed(3)} <span>s</span>
            </strong>
            <span>
              Frame {frame + 1} / {data.timeline.frameCount}
            </span>
            <span>{data.timeline.duration.toFixed(3)} s</span>
          </div>
          <TimelineEvents data={data} />
        </div>
        <div className="playback-settings" role="group" aria-label="Playback settings">
          <label className="speed-label">
            <span className="sr-only">Speed</span>
            <select
              aria-label="Playback speed"
              title="Playback speed"
              value={speed}
              onChange={(e) => useSession.setState({ speed: Number(e.target.value) })}
            >
              {[0.25, 0.5, 1, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
          <label className="inline-check" title="Loop playback">
            <input
              type="checkbox"
              aria-label="Loop playback"
              checked={loop}
              onChange={(e) => useSession.setState({ loop: e.target.checked })}
            />
            Loop
          </label>
        </div>
        <div className="timeline-actions">
          <div className="crop-actions" role="group" aria-label="Crop actions">
            <button onClick={applyCrop} disabled={!selection || busy} title="Crop selected range">
              Apply crop
            </button>
            <div className="crop-secondary">
              {selection ? (
                <button
                  title="Cancel crop selection"
                  onClick={() => useSession.setState({ cropSelection: null, playing: false })}
                >
                  Cancel crop
                </button>
              ) : file && dirty ? (
                <button
                  disabled={busy}
                  title="Restore original recording"
                  onClick={restoreOriginal}
                >
                  Restore original
                </button>
              ) : null}
            </div>
          </div>
          <EventControls data={data} />
        </div>
      </div>
      <EventEditor data={data} />
    </section>
  );
}

import {
  applyCrop,
  restoreOriginal,
  saveAs,
  setFrame,
  togglePlay,
  useSession,
} from '../state/session';
import type { MotionData } from '../motion/types';
import { TimelineSlider } from './TimelineSlider';
export function Timeline({ data }: { data: MotionData }) {
  const frame = useSession((s) => s.frame),
    playing = useSession((s) => s.playing),
    selection = useSession((s) => s.cropSelection),
    file = useSession((s) => s.sourceFile),
    saved = useSession((s) => s.saved),
    speed = useSession((s) => s.speed),
    loop = useSession((s) => s.loop);
  return (
    <section className="timeline-section">
      <div className="timeline">
        <div className="transport">
          <button
            aria-label="Jump to beginning"
            title="Beginning (Home)"
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
            title="Play / pause (Space)"
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
            title="End (End)"
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
            <span>{(data.timeline.frameCount / data.timeline.rate).toFixed(3)} s</span>
          </div>
          <TimelineSlider data={data} />
          <div className="events-track">
            {data.events
              .filter((e) => e.time >= 0 && e.time <= data.timeline.duration)
              .map((e, i) => (
                <button
                  key={i}
                  style={{
                    left: `${(100 * e.time * data.timeline.rate) / data.timeline.frameCount}%`,
                  }}
                  title={`${e.context} ${e.label} · ${e.time.toFixed(3)} s`}
                  aria-label={`Jump to ${e.label}`}
                  onClick={() => setFrame(e.time * data.timeline.rate)}
                />
              ))}
          </div>
        </div>
        <label className="speed-label">
          Speed
          <select
            aria-label="Playback speed"
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
        <label className="inline-check">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => useSession.setState({ loop: e.target.checked })}
          />
          Loop
        </label>
        <div className="timeline-actions">
          <button
            onClick={applyCrop}
            disabled={!selection}
            title="Drag the timeline handles to select a crop"
          >
            Crop
          </button>
          {selection && (
            <button onClick={() => useSession.setState({ cropSelection: null, playing: false })}>
              Cancel crop
            </button>
          )}
          {data.source.crop && (
            <>
              <button className="primary" onClick={saveAs} disabled={!file || Boolean(selection)}>
                Export
              </button>
              <button onClick={restoreOriginal}>Restore original</button>
              {saved && <span role="status">Download prepared</span>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

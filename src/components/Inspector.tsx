import { useState } from 'react';
import type { MotionData } from '../motion/types';
import { connectionSets, resolveConnections } from '../motion/connections';
import { setFrame, toggleMarker, useSession, type DisplayKey } from '../state/session';
import { PanelToggle } from './PanelToggle';
function SelectedMarker({ data }: { data: MotionData }) {
  const selected = useSession((s) => s.selected),
    frame = useSession((s) => s.frame),
    i = frame * data.markers.labels.length + selected,
    valid = data.markers.valid[i];
  return (
    <section className="selected-marker">
      <div className="eyebrow">
        SELECTED MARKER{' '}
        <span className={valid ? 'good' : 'warning'}>{valid ? 'VALID' : 'MISSING'}</span>
      </div>
      <h3>{data.markers.labels[selected]}</h3>
      <div className="coordinate-values">
        {['X', 'Y', 'Z'].map((axis, a) => (
          <div key={axis}>
            <span>{axis}</span>
            <strong>{valid ? data.markers.positions[i * 3 + a].toFixed(4) : '—'}</strong>
          </div>
        ))}
      </div>
      <div className="muted small">
        Position in metres · source frame {data.timeline.firstFrame + frame}
        {data.markers.residuals && valid
          ? ` · residual ${(data.markers.residuals[i] * 1000).toFixed(2)} mm`
          : ''}
      </div>
    </section>
  );
}
export function Inspector({
  data,
  collapsed,
  onToggle,
}: {
  data: MotionData;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState('Markers'),
    selected = useSession((s) => s.selected),
    hidden = useSession((s) => s.hidden),
    search = useSession((s) => s.search);
  const display = useSession((s) => s.display),
    connectionSet = useSession((s) => s.connectionSet),
    threshold = useSession((s) => s.threshold),
    scale = useSession((s) => s.forceScale),
    assumeGlobal = useSession((s) => s.assumeGlobal);
  const items = data.markers.labels
    .map((name, index) => ({ name, index }))
    .filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <aside id="trial-inspector" className={`inspector ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-heading">
        <span className="sidebar-title">TRIAL INSPECTOR</span>
        <span>{data.markers.labels.length} markers</span>
        <PanelToggle panel="sidebar" expanded={!collapsed} onToggle={onToggle} />
      </div>
      <SelectedMarker data={data} />
      <div className="tabs" role="tablist">
        {['Markers', 'Display', 'Info'].map((t) => (
          <button role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {tab === 'Markers' ? (
          <>
            <input
              className="search"
              aria-label="Search markers"
              placeholder="Search markers…"
              value={search}
              onChange={(e) => useSession.setState({ search: e.target.value })}
            />
            <div className="list-heading">
              <span>{items.length} TRAJECTORIES</span>
              <button
                className="text-button"
                onClick={() => useSession.setState({ hidden: new Set() })}
              >
                Show all
              </button>
            </div>
            <div className="marker-list">
              {items.map(({ name, index }) => (
                <div key={index} className={`marker-row ${selected === index ? 'selected' : ''}`}>
                  <label title={`Show ${name}`}>
                    <input
                      aria-label={`Show ${name}`}
                      type="checkbox"
                      checked={!hidden.has(index)}
                      onChange={() => toggleMarker(index)}
                    />
                  </label>
                  <button onClick={() => useSession.setState({ selected: index, plot: 'marker' })}>
                    <span className={name.startsWith('L') ? 'marker-dot left' : 'marker-dot'} />
                    {name}
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : tab === 'Display' ? (
          <>
            <h4>Scene layers</h4>
            <div className="display-options">
              {(
                Object.entries({
                  markers: 'Markers',
                  connections: 'Marker connections',
                  plates: 'Force plates',
                  plateNumbers: 'Force plate numbers',
                  forces: 'Ground reaction forces',
                  cop: 'Centre of pressure',
                  labels: 'Marker labels',
                  grid: 'Ground grid',
                  axes: 'Coordinate axes',
                }) as [DisplayKey, string][]
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={display[key]}
                    onChange={(e) =>
                      useSession.setState((s) => ({
                        display: { ...s.display, [key]: e.target.checked },
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <h4>Marker connections</h4>
            <select
              aria-label="Connection preset"
              value={connectionSet}
              onChange={(e) => useSession.setState({ connectionSet: e.target.value })}
            >
              <option value="auto">Matching named links</option>
              <option value="none">None</option>
              {connectionSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="small muted">
              {resolveConnections(data.markers.labels, connectionSet).length} matching links.
              Display guides between named markers; no inferred joint centres.
            </p>
            <h4>Force display</h4>
            <label className="field-label">
              Vector scale (mm/N)
              <input
                aria-label="Force vector scale"
                type="number"
                min="0.01"
                max="10"
                step="0.1"
                value={scale * 1000}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v <= 10) useSession.setState({ forceScale: v / 1000 });
                }}
              />
            </label>
            <label className="field-label">
              Minimum force magnitude (N)
              <input
                aria-label="Force display threshold"
                type="number"
                min="0"
                step="5"
                value={threshold}
                onChange={(e) =>
                  useSession.setState({ threshold: Math.max(0, Number(e.target.value)) })
                }
              />
            </label>
            <p className="muted small">Display only. Original force samples remain unchanged.</p>
            {data.forcePlatforms.some((p) => p.coordinateFrame === 'unresolved') && (
              <label className="warning inline-check">
                <input
                  type="checkbox"
                  checked={assumeGlobal}
                  onChange={(e) => useSession.setState({ assumeGlobal: e.target.checked })}
                />
                I confirm unresolved force/COP samples are already in global lab coordinates.
              </label>
            )}
            <h4>Force platforms</h4>
            {data.forcePlatforms.length ? (
              data.forcePlatforms.map((p, i) => (
                <div className="plate-card" key={i}>
                  <strong>
                    {i + 1} · {p.name}
                  </strong>
                  <span>
                    {p.force.rate} Hz · {p.coordinateFrame}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => useSession.setState({ plot: `plate:${i}:force` })}
                  >
                    Inspect force signal ↗
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">No supported force platforms.</p>
            )}
          </>
        ) : (
          <>
            <h4>File information</h4>
            <dl>
              {Object.entries({
                File: data.name,
                Format: data.source.format,
                Frames: data.timeline.frameCount,
                'Point rate': `${data.timeline.rate} Hz`,
                Duration: `${data.timeline.duration.toFixed(3)} s`,
                'Source first frame': data.timeline.firstFrame,
                'Source position unit': data.source.originalPositionUnit,
                Markers: data.markers.labels.length,
                'Analog channels': data.analogs.length,
                'Force platforms': data.forcePlatforms.length,
                Events: data.events.length,
              }).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <h4>Events</h4>
            {data.events.length ? (
              data.events.map((e, i) => (
                <button
                  className="event-row"
                  key={i}
                  onClick={() => setFrame(e.time * data.timeline.rate)}
                >
                  {e.label} {e.context}
                  <span>{e.time.toFixed(3)} s</span>
                </button>
              ))
            ) : (
              <p className="muted small">No supported events in this file.</p>
            )}
            <details>
              <summary>Source metadata</summary>
              <pre>
                {JSON.stringify(
                  data.source.metadata,
                  (_, v) => (typeof v === 'bigint' ? v.toString() : v),
                  2,
                )}
              </pre>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}

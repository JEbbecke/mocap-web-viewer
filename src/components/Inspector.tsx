import { useState } from 'react';
import type { MotionData } from '../motion/types';
import { connectionSets, resolveConnections } from '../motion/connections';
import { useSession } from '../state/session';
import { displayOptions } from './displayOptions';
import { PanelToggle } from './PanelToggle';
import { FileInfo } from './FileInfo';
import { DataBrowser } from './DataBrowser';
import { TrialOverview } from './TrialOverview';
export function Inspector({
  data,
  collapsed,
  onToggle,
}: {
  data: MotionData;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState('Data');
  const display = useSession((s) => s.display),
    connectionSet = useSession((s) => s.connectionSet),
    threshold = useSession((s) => s.threshold),
    scale = useSession((s) => s.forceScale),
    assumeGlobal = useSession((s) => s.assumeGlobal);
  return (
    <aside id="trial-inspector" className={`inspector ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-heading">
        <span className="sidebar-title">TRIAL INSPECTOR</span>
        <span>{data.markers.labels.length} markers</span>
        <PanelToggle panel="sidebar" expanded={!collapsed} onToggle={onToggle} />
      </div>
      <TrialOverview data={data} />
      <div className="tabs" role="tablist">
        {['Data', 'Display', 'File Info'].map((t) => (
          <button role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {tab === 'Data' ? (
          <DataBrowser data={data} />
        ) : tab === 'Display' ? (
          <>
            <h4>Scene layers</h4>
            <div className="display-options">
              {displayOptions(data).map(([key, label]) => (
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
              {
                resolveConnections(
                  data.markers.connectionLabels ?? data.markers.labels,
                  connectionSet,
                ).length
              }{' '}
              matching links. Display guides between named markers; no inferred joint centres.
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
                value={scale}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v <= 10) useSession.setState({ forceScale: v });
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
          </>
        ) : (
          <FileInfo data={data} />
        )}
      </div>
    </aside>
  );
}

import { useEffect, useState } from 'react';
import type { MotionData } from '../motion/types';
import { connectionSets } from '../motion/connections';
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
  const [expandedFileInfo, setExpandedFileInfo] = useState<Set<string>>(() => new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const [collapsedSearchSections, setCollapsedSearchSections] = useState<Set<string>>(
    () => new Set(),
  );
  const sourceFile = useSession((s) => s.sourceFile);
  const search = useSession((s) => s.search);
  useEffect(() => {
    setExpandedSections(new Set());
    setExpandedFileInfo(new Set());
  }, [sourceFile]);
  useEffect(() => {
    setCollapsedSearchSections(new Set());
  }, [sourceFile, search]);
  const toggleSection = (name: string) => {
    const update = search.trim() ? setCollapsedSearchSections : setExpandedSections;
    update((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const display = useSession((s) => s.display),
    connectionSet = useSession((s) => s.connectionSet),
    threshold = useSession((s) => s.threshold),
    scale = useSession((s) => s.forceScale),
    assumeGlobal = useSession((s) => s.assumeGlobal);
  return (
    <aside id="trial-inspector" className={`inspector ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-heading">
        <span className="sidebar-title">TRIAL INSPECTOR</span>
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
          <DataBrowser
            data={data}
            expandedSections={expandedSections}
            collapsedSearchSections={collapsedSearchSections}
            onToggleSection={toggleSection}
          />
        ) : tab === 'Display' ? (
          <div className="display-settings" role="tabpanel" aria-label="Display">
            <h4>Scene layers</h4>
            <div className="display-options">
              {displayOptions(data).map(([key, label]) => (
                <label
                  key={key}
                  title={
                    key === 'compactEventMarkers'
                      ? 'Display events in one row and cluster only overlapping markers.'
                      : undefined
                  }
                >
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
          </div>
        ) : (
          <FileInfo
            data={data}
            expandedRows={expandedFileInfo}
            onToggleRow={(key) =>
              setExpandedFileInfo((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          />
        )}
      </div>
    </aside>
  );
}

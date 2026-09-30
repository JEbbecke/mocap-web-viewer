import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MotionData } from '../motion/types';
import {
  renameSessionAnalog,
  renameSessionMarker,
  renameSessionData,
  openSessionEvent,
  toggleMarker,
  useSession,
} from '../state/session';
import { LabelEditor } from './LabelEditor';
import { dataSections, filterDataSections } from './dataSections';

function Section({
  name,
  count,
  searching,
  children,
}: {
  name: string;
  count: string;
  searching: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(name === 'Markers');
  return (
    <details
      className="data-section"
      open={searching || expanded}
      onToggle={(e) => {
        if (!searching) setExpanded(e.currentTarget.open);
      }}
    >
      <summary>
        <span>{name}</span>
        <span className="data-count">{count}</span>
      </summary>
      {(searching || expanded) && <div className="data-section-content">{children}</div>}
    </details>
  );
}

export function DataBrowser({ data }: { data: MotionData }) {
  const [editing, setEditing] = useState<string | null>(null);
  const busy = useSession((s) => s.busy);
  useEffect(() => {
    setEditing(null);
  }, [data]);
  const selected = useSession((s) => s.selected),
    hidden = useSession((s) => s.hidden),
    search = useSession((s) => s.search),
    plot = useSession((s) => s.plot);
  const sections = useMemo(() => dataSections(data), [data]);
  const filtered = useMemo(() => filterDataSections(sections, search), [sections, search]);
  const searching = !!search.trim();
  const beginRename = (id: string) => {
    if (!busy) setEditing(id);
  };
  return (
    <div className="data-browser" role="tabpanel" aria-label="Data">
      <input
        className="search"
        aria-label="Search data"
        placeholder="Search data…"
        value={search}
        onChange={(e) => useSession.setState({ search: e.target.value })}
      />
      {!filtered.length && (
        <p className="muted small" role="status">
          {sections.length ? 'No matching data.' : 'No supported data available.'}
        </p>
      )}
      {filtered.map((section) => (
        <Section
          key={section.name}
          name={section.name}
          searching={searching}
          count={searching ? `${section.entries.length} / ${section.total}` : String(section.total)}
        >
          {section.note && <p className="muted small">{section.note}</p>}
          {section.name === 'Markers' && (
            <div className="list-heading">
              <span>{section.total} TRAJECTORIES</span>
              <button
                className="text-button"
                onClick={() => useSession.setState({ hidden: new Set() })}
              >
                Show all
              </button>
            </div>
          )}
          {section.entries.map((entry) =>
            entry.marker !== undefined ? (
              <div
                key={entry.id}
                className={`marker-row ${selected === entry.marker ? 'selected' : ''}`}
              >
                <label title={`Show ${entry.name}`}>
                  <input
                    aria-label={`Show ${entry.name}`}
                    type="checkbox"
                    checked={!hidden.has(entry.marker)}
                    onChange={() => toggleMarker(entry.marker!)}
                  />
                </label>
                {editing === entry.id ? (
                  <LabelEditor
                    name={entry.name}
                    busy={busy}
                    onSave={(label) => renameSessionMarker(entry.marker!, label)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <button
                      title={entry.name}
                      onDoubleClick={() => beginRename(entry.id)}
                      onClick={() =>
                        useSession.setState({ selected: entry.marker, plot: 'marker' })
                      }
                    >
                      <span
                        className={entry.name.startsWith('L') ? 'marker-dot left' : 'marker-dot'}
                      />
                      {entry.name}
                    </button>
                    <button
                      className="rename-marker"
                      aria-label={`Rename ${entry.name}`}
                      title="Rename marker"
                      disabled={busy}
                      onClick={() => beginRename(entry.id)}
                    >
                      ✎
                    </button>
                  </>
                )}
              </div>
            ) : entry.analog !== undefined || entry.rename !== undefined ? (
              <div key={entry.id} className="analog-row">
                {editing === entry.id ? (
                  <LabelEditor
                    name={entry.name}
                    busy={busy}
                    onSave={(label) =>
                      entry.analog !== undefined
                        ? renameSessionAnalog(entry.analog, label)
                        : renameSessionData(entry.rename!, label)
                    }
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <button
                      className="data-entry"
                      title={entry.name}
                      aria-label={entry.plot !== undefined ? `Plot ${entry.name}` : entry.name}
                      aria-pressed={entry.plot !== undefined ? plot === entry.plot : undefined}
                      onClick={() => {
                        if (entry.plot !== undefined) useSession.setState({ plot: entry.plot });
                      }}
                      onDoubleClick={() => beginRename(entry.id)}
                    >
                      <span>{entry.name}</span>
                      {entry.detail && <small>{entry.detail}</small>}
                    </button>
                    <button
                      className="rename-label"
                      aria-label={`Rename ${entry.analog !== undefined ? 'analog ' : ''}${entry.name}`}
                      title="Rename label"
                      disabled={busy}
                      onClick={() => beginRename(entry.id)}
                    >
                      ✎
                    </button>
                  </>
                )}
              </div>
            ) : entry.event !== undefined ? (
              <button
                key={entry.id}
                className="data-entry"
                title={entry.name}
                aria-label={`Edit event ${entry.name}`}
                onClick={() => openSessionEvent(entry.event!)}
              >
                <span>{entry.name}</span>
                {entry.detail && <small>{entry.detail}</small>}
              </button>
            ) : (
              <div key={entry.id} className="data-entry" title={entry.name}>
                <span>{entry.name}</span>
                {entry.detail && <small>{entry.detail}</small>}
              </div>
            ),
          )}
        </Section>
      ))}
    </div>
  );
}

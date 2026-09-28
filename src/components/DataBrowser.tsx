import { useMemo, useState, type ReactNode } from 'react';
import type { MotionData } from '../motion/types';
import { setFrame, toggleMarker, useSession } from '../state/session';
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
  const selected = useSession((s) => s.selected),
    hidden = useSession((s) => s.hidden),
    search = useSession((s) => s.search),
    plot = useSession((s) => s.plot);
  const sections = useMemo(() => dataSections(data), [data]);
  const filtered = useMemo(() => filterDataSections(sections, search), [sections, search]);
  const searching = !!search.trim();
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
                <button
                  title={entry.name}
                  onClick={() => useSession.setState({ selected: entry.marker, plot: 'marker' })}
                >
                  <span className={entry.name.startsWith('L') ? 'marker-dot left' : 'marker-dot'} />
                  {entry.name}
                </button>
              </div>
            ) : entry.plot !== undefined || entry.time !== undefined ? (
              <button
                key={entry.id}
                className="data-entry"
                title={entry.name}
                aria-label={`${entry.time !== undefined ? 'Seek to' : 'Plot'} ${entry.name}`}
                aria-pressed={entry.plot !== undefined ? plot === entry.plot : undefined}
                onClick={() =>
                  entry.time !== undefined
                    ? setFrame(entry.time * data.timeline.rate)
                    : useSession.setState({ plot: entry.plot! })
                }
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

import { useId, useState } from 'react';
import type { MotionData } from '../motion/types';
import { fileInfoSections, type InfoRow } from './fileInfoSections';
import { metadataTimestampParts } from './metadataDisplay';

function groupedRows(rows: InfoRow[]) {
  const groups = new Map<string, InfoRow[]>();
  for (const row of rows) {
    const group = row.group ?? '';
    const entries = groups.get(group) ?? [];
    entries.push(row);
    groups.set(group, entries);
  }
  return [...groups];
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Copied');
    } catch {
      setStatus('Copy failed. Select the value to copy it.');
    }
  };
  return (
    <>
      <button type="button" className="metadata-action" aria-label={`Copy ${label}`} onClick={copy}>
        Copy
      </button>
      <span className="metadata-copy-status" role="status">
        {status}
      </span>
    </>
  );
}

function MetadataRow({
  row,
  expanded,
  onToggle,
}: {
  row: InfoRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  const display = row.summary ? [row.summary] : (row.displayValues ?? row.values);
  const hasDetails =
    row.values.length !== display.length ||
    row.values.some((value, i) => value !== display[i]) ||
    !!row.summary;
  const compact = (
    <span className="metadata-display" id={`${id}-value`}>
      {display.map((value, i) => {
        const timestamp =
          row.kind === 'timestamp' ? metadataTimestampParts(row.values[i]) : undefined;
        return timestamp ? (
          <span className="metadata-timestamp" key={i}>
            <span>{timestamp.date}</span>
            {timestamp.time && <span>{timestamp.time}</span>}
          </span>
        ) : (
          <span
            key={i}
            className={hasDetails ? undefined : 'file-info-value'}
            title={row.tooltip || value}
          >
            {value}
          </span>
        );
      })}
    </span>
  );
  return (
    <div
      className={`metadata-row${hasDetails ? ' metadata-expandable' : ''}${row.values[0] === 'Not available' ? ' metadata-unavailable' : ''}`}
      onClick={
        hasDetails
          ? (event) => {
              // Copy controls and expanded text must never toggle the property.
              if (!(event.target as HTMLElement).closest('button, .metadata-disclosure'))
                onToggle();
            }
          : undefined
      }
    >
      <dt>{row.label}</dt>
      <dd className="metadata-compact" title={row.tooltip || row.values.join('\n')}>
        {hasDetails ? (
          <button
            type="button"
            className="metadata-row-toggle"
            aria-label={`${row.label} details`}
            aria-expanded={expanded}
            aria-controls={id}
            aria-describedby={`${id}-value`}
            onClick={onToggle}
          >
            {compact}
            <svg
              className="metadata-chevron"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        ) : (
          compact
        )}
      </dd>
      {hasDetails && (
        <dd className="metadata-disclosure" hidden={!expanded}>
          <div className="metadata-details" id={id}>
            {row.values.map((value, i) => (
              <div className="metadata-original" key={i}>
                {row.detailLabels?.[i] && (
                  <span className="metadata-detail-label">{row.detailLabels[i]}</span>
                )}
                <span className="file-info-value" title={row.tooltip || value}>
                  {value}
                </span>
                <CopyValue
                  key={value}
                  value={value}
                  label={`${row.group ? `${row.group}: ` : ''}${row.label}${row.detailLabels?.[i] ? ` (${row.detailLabels[i]})` : row.values.length > 1 ? ` ${i + 1}` : ''}`}
                />
              </div>
            ))}
          </div>
        </dd>
      )}
    </div>
  );
}

export function FileInfo({
  data,
  expandedRows,
  onToggleRow,
}: {
  data: MotionData;
  expandedRows?: ReadonlySet<string>;
  onToggleRow?: (key: string) => void;
}) {
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(() => new Set());
  const toggle =
    onToggleRow ??
    ((key: string) =>
      setLocalExpanded((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }));
  return (
    <div className="file-info" role="tabpanel" aria-label="File Info">
      {fileInfoSections(data).map((section) => (
        <section
          className={`file-info-section${section.title === 'Dates & Provenance' ? ' file-info-dates' : ''}`}
          key={section.title}
          aria-label={section.title}
        >
          <h4>{section.title}</h4>
          {groupedRows(section.rows).map(([group, rows]) => (
            <div
              className="file-info-group"
              role={group ? 'group' : undefined}
              aria-label={group || undefined}
              key={group}
            >
              {group === 'Subject & Trial' ? <h4>{group}</h4> : group && <h5>{group}</h5>}
              {section.notes?.[group] && (
                <p className="file-info-note muted">{section.notes[group]}</p>
              )}
              <dl>
                {rows.map((row) => {
                  const key = `${section.title}/${group}/${row.label}`;
                  return (
                    <MetadataRow
                      key={key}
                      row={row}
                      expanded={(expandedRows ?? localExpanded).has(key)}
                      onToggle={() => toggle(key)}
                    />
                  );
                })}
              </dl>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

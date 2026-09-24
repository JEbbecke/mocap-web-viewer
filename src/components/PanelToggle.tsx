export function PanelToggle({
  panel,
  expanded,
  onToggle,
}: {
  panel: 'plot' | 'sidebar';
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = `${expanded ? 'Hide' : 'Show'} ${panel === 'plot' ? 'plot panel' : 'right sidebar'}`;
  return (
    <button
      className="panel-toggle"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={panel === 'plot' ? 'signal-panel-content' : 'trial-inspector'}
      onClick={onToggle}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d={panel === 'plot' ? 'm5 7 5 5 5-5' : 'm7 5 5 5-5 5'} />
      </svg>
    </button>
  );
}

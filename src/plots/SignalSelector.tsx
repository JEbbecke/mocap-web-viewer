import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

type Option = { value: string; label: ReactNode };
type Group = { label?: string; options: Option[] };

/** Native option definitions also supply the collapsible, keyboard-accessible picker. */
export function SignalSelector({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>();
  const groups: Group[] = [];
  const collect = (nodes: ReactNode, group?: Group) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<{ value?: string; label?: string; children?: ReactNode }>(node)) return;
      if (node.type === 'option') {
        const option = { value: node.props.value!, label: node.props.children };
        if (group) group.options.push(option);
        else groups.push({ options: [option] });
      } else if (node.type === 'optgroup') {
        const next: Group = { label: node.props.label, options: [] };
        collect(node.props.children, next);
        if (next.options.length) groups.push(next);
      } else collect(node.props.children, group);
    });
  };
  collect(children);
  const selected = groups.flatMap((g) => g.options).find((o) => o.value === value);
  const close = () => {
    if (root.current) root.current.open = false;
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
    };
  }, []);
  const option = (o: Option) => (
    <button
      type="button"
      key={o.value}
      aria-pressed={value === o.value}
      onClick={() => {
        onChange(o.value);
        close();
        root.current?.querySelector('summary')?.focus();
      }}
    >
      {o.label}
    </button>
  );
  return (
    <div className="signal-selector">
      <select
        className="signal-select-native"
        aria-hidden="true"
        tabIndex={-1}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <details
        ref={root}
        onToggle={(event) => {
          if (event.target !== event.currentTarget || !event.currentTarget.open) return;
          const bounds = event.currentTarget.querySelector('summary')!.getBoundingClientRect();
          setMenuPosition({
            position: 'fixed',
            top: 'auto',
            right: 'auto',
            left: bounds.left,
            bottom: window.innerHeight - bounds.top,
            width: bounds.width,
            maxHeight: Math.max(100, Math.min(320, bounds.top - 12)),
          });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            root.current?.querySelector('summary')?.focus();
          }
        }}
      >
        <summary
          className="signal-selector-trigger"
          aria-label={`Choose ${label.toLowerCase()}`}
          title={
            selected
              ? Children.toArray(selected.label)
                  .filter((part) => typeof part === 'string' || typeof part === 'number')
                  .join('')
              : 'No signal'
          }
        >
          {selected?.label ?? 'No signal'}
        </summary>
        <div
          className="signal-selector-menu"
          style={menuPosition}
          role="group"
          aria-label={`${label} groups`}
        >
          {groups.map((group, i) =>
            group.label ? (
              <details key={group.label}>
                <summary>{group.label}</summary>
                <div>{group.options.map(option)}</div>
              </details>
            ) : (
              <div key={i}>{group.options.map(option)}</div>
            ),
          )}
        </div>
      </details>
    </div>
  );
}

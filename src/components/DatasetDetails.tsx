import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Dataset } from '../explorer/datasets';

/** Metadata overlays the workspace; opening it never participates in panel sizing. */
export function DatasetDetails({ dataset }: { dataset: Dataset }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 320 });
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current!;
    const panel = popup.current!;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      if (!anchor.isConnected || rect.bottom < 0 || rect.top > innerHeight) {
        setOpen(false);
        return;
      }
      const above = Math.max(0, rect.top - 14);
      const below = Math.max(0, innerHeight - rect.bottom - 14);
      const up = below < Math.min(panel.scrollHeight, 400) && above > below;
      const maxHeight = Math.min(400, up ? above : below);
      const height = Math.min(panel.scrollHeight + 2, maxHeight);
      const next = {
        left: Math.max(
          8,
          Math.min(innerWidth - panel.offsetWidth - 8, rect.right - panel.offsetWidth),
        ),
        top: up ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
        maxHeight,
      };
      setPosition((old) =>
        old.left === next.left && old.top === next.top && old.maxHeight === next.maxHeight
          ? old
          : next,
      );
    };
    const outside = (event: Event) => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      anchor.focus({ preventScroll: true });
    };
    place();
    panel.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    observer.observe(anchor);
    observer.observe(anchor.closest('.explorer-dataset-info')!);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="explorer-details-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7" />
          <path d="M10 9v5m0-8v1" />
        </svg>
        Details
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="dialog"
            aria-label={`${dataset.name} dataset details`}
            tabIndex={-1}
            className={`explorer-facts${dataset.path[0] === 'Metadata' ? ' explorer-metadata' : ''}`}
            style={position}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              // Resume the trigger's document order after reading the portalled panel.
              setOpen(false);
              trigger.current?.focus({ preventScroll: true });
              if (event.shiftKey) event.preventDefault();
            }}
          >
            <strong>{dataset.name}</strong>
            <dl>
              {dataset.facts.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </>
  );
}

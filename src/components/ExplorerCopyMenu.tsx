import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep the existing explicit copy scopes and handlers inside a viewport-safe menu. */
export function ExplorerCopyMenu({ children, busy }: { children: ReactNode; busy: boolean }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialLast = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 240 });
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current!;
    const panel = menu.current!;
    const items = [
      ...panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    ];
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      if (!anchor.isConnected || rect.bottom < 0 || rect.top > innerHeight) {
        setOpen(false);
        return;
      }
      const above = Math.max(0, rect.top - 14),
        below = Math.max(0, innerHeight - rect.bottom - 14);
      const up = below < panel.scrollHeight && above > below;
      const maxHeight = up ? above : below;
      const next = {
        left: Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8)),
        top: up
          ? Math.max(8, rect.top - Math.min(panel.scrollHeight + 2, maxHeight) - 6)
          : rect.bottom + 6,
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
      close();
    };
    place();
    (items[initialLast.current ? items.length - 1 : 0] ?? panel).focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    observer.observe(anchor.parentElement!);
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
        id={`${id}-trigger`}
        type="button"
        className="explorer-copy-trigger"
        aria-busy={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          initialLast.current = false;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          initialLast.current = event.key === 'ArrowUp';
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="1" />
          <path d="M12 7V3H3v9h4" />
        </svg>
        Copy <span aria-hidden="true">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-labelledby={`${id}-trigger`}
            tabIndex={-1}
            className="export-menu explorer-copy-menu"
            style={position}
            onClick={(event) => {
              event.stopPropagation();
              const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
                '[role="menuitem"]',
              );
              if (item && !item.disabled) close();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                const items = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]:not(:disabled)',
                  ),
                ];
                const index = items.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
                items[next]?.focus();
              } else if (event.key === 'Tab') close();
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../state/session';
import { markerScenePosition } from '../viewer/markerPosition';
import {
  deleteSelectedMarker,
  focusSelectedMarker,
  renameSelectedMarker,
  selectedMarkerActions,
} from '../state/markerCommands';

export function MarkerContextMenu() {
  const s = useSession();
  const request = s.markerMenu;
  const menu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const valid =
    !!request &&
    request.marker === s.selected &&
    request.data === s.data &&
    !s.busy &&
    s.viewerReady &&
    !!s.data?.markers.labels[s.selected] &&
    !s.hidden.has(s.selected) &&
    (!request.sampleAvailable || !!markerScenePosition(s.data!, s.frame, s.selected));
  const actions = selectedMarkerActions();
  const close = (restore = true) => {
    if (restore) {
      const target = returnFocus.current;
      if (target?.isConnected && target.getClientRects().length)
        target.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('.viewport')?.focus({ preventScroll: true });
    }
    useSession.setState({ markerMenu: null });
  };
  useLayoutEffect(() => {
    if (!valid || !request) return;
    const place = () => {
      const rect = menu.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          left: Math.max(8, Math.min(request.x, window.innerWidth - rect.width - 8)),
          top: Math.max(8, Math.min(request.y, window.innerHeight - rect.height - 8)),
        });
    };
    place();
    const observer = new ResizeObserver(place);
    if (menu.current) observer.observe(menu.current);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [valid, request]);
  useEffect(() => {
    if (!valid) {
      if (request) close(false);
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    returnFocus.current = previous?.closest('.viewport,[data-marker-select]') as HTMLElement | null;
    const element = menu.current;
    element?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: Event) => {
      if (!element?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
    };
  }, [valid, request]);
  if (!valid) return null;
  const items = [
    {
      label: 'Focus camera',
      key: 'C',
      icon: '◎',
      available: actions.focus,
      run: focusSelectedMarker,
    },
    {
      label: 'Rename marker',
      key: 'Ctrl+Shift+U',
      icon: '✎',
      available: actions.rename,
      run: renameSelectedMarker,
    },
    {
      label: 'Delete marker',
      key: 'Delete',
      icon: '×',
      available: actions.delete,
      run: deleteSelectedMarker,
    },
  ];
  return createPortal(
    <div
      ref={menu}
      className="export-menu marker-context-menu"
      role="menu"
      aria-label={`Marker: ${s.data!.markers.labels[s.selected]}`}
      style={position}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (
          ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
        ) {
          event.preventDefault();
          event.stopPropagation();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index +
                    (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="marker-menu-heading" title={s.data!.markers.labels[s.selected]}>
        Marker: {s.data!.markers.labels[s.selected]}
      </div>
      {items.map((item) => (
        <button
          type="button"
          key={item.key}
          role="menuitem"
          disabled={!item.available}
          className={item.key === 'Delete' ? 'marker-menu-delete' : ''}
          title={item.key === 'Delete' ? actions.deleteReason : undefined}
          onClick={() => {
            close();
            item.run();
          }}
        >
          <span aria-hidden="true" className="marker-menu-icon">
            {item.icon}
          </span>
          <span>{item.label}</span>
          <kbd>{item.key}</kbd>
        </button>
      ))}
    </div>,
    document.body,
  );
}

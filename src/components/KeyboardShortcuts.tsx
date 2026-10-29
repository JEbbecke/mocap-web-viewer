import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shortcutReference } from '../state/shortcutReference';

export function KeyboardShortcuts() {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="keyboard-shortcuts-trigger"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          dialog.current?.showModal();
          content.current?.scrollTo({ top: 0, behavior: 'instant' });
          setOpen(true);
          closeButton.current?.focus({ preventScroll: true });
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="1.5" y="4" width="17" height="12" rx="2" />
          <path d="M5 7.5h.5m3.5 0h.5m3.5 0h.5m-8.5 3h.5m3.5 0h.5m3.5 0h2M6 13.5h8" />
        </svg>
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          id={id}
          className="export-dialog shortcuts-dialog"
          aria-labelledby={`${id}-heading`}
          aria-describedby={`${id}-description`}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus({ preventScroll: true });
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            // Keep application commands local to this modal. Native scrolling,
            // Escape/cancel and button activation retain their browser defaults.
            event.stopPropagation();
            if (event.key !== 'Tab') return;
            const stops = [
              ...event.currentTarget.querySelectorAll<HTMLElement>('button,[tabindex="0"]'),
            ];
            const first = stops[0],
              last = stops.at(-1)!;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <div className="shortcuts-heading">
            <h2 id={`${id}-heading`}>Keyboard shortcuts</h2>
            <button
              ref={closeButton}
              type="button"
              aria-label="Close keyboard shortcuts"
              onClick={() => dialog.current?.close()}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p id={`${id}-description`} className="small muted">
            Shortcuts depend on focus. Text fields and controls keep their own keys. Ctrl/Cmd means
            Ctrl on Windows/Linux or Cmd on macOS, only where shown.
          </p>
          <div
            ref={content}
            className="shortcuts-content"
            tabIndex={0}
            role="region"
            aria-label="Shortcut reference"
          >
            {shortcutReference.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3>{group.title}</h3>
                <p>{group.context}</p>
                <dl>
                  {group.entries.map((entry) => (
                    <div className="shortcut-row" key={entry.action}>
                      <dt>{entry.action}</dt>
                      <dd>
                        {entry.keys.map((keys) => (
                          <kbd key={keys}>{keys}</kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <div className="shortcuts-actions">
            <button type="button" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}

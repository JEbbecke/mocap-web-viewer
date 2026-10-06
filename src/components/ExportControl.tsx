import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MotionData } from '../motion/types';
import { conversionPlan, type ExportFormat } from '../exporters/conversion';
import { exportFile, useSession } from '../state/session';

/** Output format and preview are view state; they never mutate science/history. */
export function ExportControl({ data, disabled }: { data: MotionData; disabled: boolean }) {
  const file = useSession((s) => s.sourceFile);
  const saved = useSession((s) => s.saved);
  const sourceFormat: ExportFormat = data.source.format === 'C3D' ? 'C3D' : 'H5';
  const [format, setFormat] = useState<ExportFormat>(sourceFormat);
  const [menuOpen, setMenuOpen] = useState(false);
  const [review, setReview] = useState(false);
  const control = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialItem = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const formats: ExportFormat[] = [sourceFormat, sourceFormat === 'C3D' ? 'H5' : 'C3D'];
  const plan = useMemo(
    () => (review ? conversionPlan(data, format) : undefined),
    [review, data, format],
  );
  useEffect(() => {
    setFormat(sourceFormat);
    setMenuOpen(false);
    setReview(false);
  }, [file, sourceFormat]);
  useEffect(() => {
    if (disabled) setMenuOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      [initialItem.current]?.focus();
    const closeOutside = (event: Event) => {
      if (!control.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (review) dialog.current?.showModal();
  }, [review]);
  return (
    <>
      <div className="export-control" ref={control} onClick={(event) => event.stopPropagation()}>
        <button
          ref={trigger}
          id={`${id}-trigger`}
          className="primary"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `${id}-menu` : undefined}
          onClick={() => {
            initialItem.current = 0;
            setMenuOpen((open) => !open);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              initialItem.current = event.key === 'ArrowUp' ? formats.length - 1 : 0;
              setMenuOpen(true);
            }
          }}
        >
          Export <span aria-hidden="true">▾</span>
        </button>
        {menuOpen && (
          <div
            ref={menu}
            id={`${id}-menu`}
            className="export-menu"
            role="menu"
            aria-labelledby={`${id}-trigger`}
            onKeyDown={(event) => {
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
              );
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                        items.length;
                items[next]?.focus();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setMenuOpen(false);
                trigger.current?.focus();
              } else if (event.key === 'Tab') {
                setMenuOpen(false);
                trigger.current?.focus();
              }
            }}
          >
            {formats.map((target) => (
              <button
                key={target}
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setMenuOpen(false);
                  setFormat(target);
                  trigger.current?.focus();
                  if (target === sourceFormat) exportFile(target);
                  else setReview(true);
                }}
              >
                Export {target}
                {target === sourceFormat && <span aria-hidden="true">(source)</span>}
              </button>
            ))}
          </div>
        )}
        {saved && !menuOpen && (
          <span className="export-status" role="status">
            Export prepared
          </span>
        )}
      </div>
      {review && plan && (
        <dialog
          ref={dialog}
          className="export-dialog"
          aria-labelledby={`${id}-heading`}
          onCancel={() => {
            setReview(false);
            trigger.current?.focus();
          }}
          onClose={() => setReview(false)}
        >
          <h2 id={`${id}-heading`}>Export as {format}</h2>
          <p>
            C3D and H5 support different feature sets. Data may be omitted or changed during
            conversion. Use the source format to preserve source-specific content.
            <br />
            Review the conversion before exporting.
          </p>
          <div className="conversion-details">
            <h3>Will export</h3>
            <ul>
              {plan.report.included.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {plan.report.errors.length > 0 && (
              <section role="alert">
                <h3>Cannot convert</h3>
                <ul>
                  {plan.report.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
            {plan.report.warnings.length > 0 && (
              <section>
                <h3>Changed or omitted</h3>
                <ul>
                  {plan.report.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="export-dialog-actions">
            <button
              autoFocus
              onClick={() => {
                setReview(false);
                trigger.current?.focus();
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={plan.report.errors.length > 0}
              onClick={() => {
                setReview(false);
                exportFile(format);
              }}
            >
              Export {format}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

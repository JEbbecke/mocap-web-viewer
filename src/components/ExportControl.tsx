import { useEffect, useMemo, useRef, useState } from 'react';
import type { MotionData } from '../motion/types';
import { conversionPlan, type ExportFormat } from '../exporters/conversion';
import { saveAs, useSession } from '../state/session';

/** Output format and preview are view state; they never mutate science/history. */
export function ExportControl({ data, disabled }: { data: MotionData; disabled: boolean }) {
  const file = useSession((s) => s.sourceFile);
  const sourceFormat: ExportFormat = data.source.format === 'C3D' ? 'C3D' : 'H5';
  const [format, setFormat] = useState<ExportFormat>(sourceFormat);
  const [review, setReview] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const plan = useMemo(
    () => (review ? conversionPlan(data, format) : undefined),
    [review, data, format],
  );
  useEffect(() => {
    setFormat(sourceFormat);
    setReview(false);
  }, [file, sourceFormat]);
  useEffect(() => {
    if (review) dialog.current?.showModal();
  }, [review]);
  return (
    <>
      <select
        aria-label="Export format"
        value={format}
        disabled={disabled}
        onChange={(e) => setFormat(e.target.value as ExportFormat)}
      >
        <option value={sourceFormat}>{sourceFormat} (source)</option>
        <option value={sourceFormat === 'C3D' ? 'H5' : 'C3D'}>
          {sourceFormat === 'C3D' ? 'H5' : 'C3D'}
        </option>
      </select>
      <button
        className="primary"
        disabled={disabled}
        onClick={() => {
          if (format === sourceFormat) saveAs(format);
          else setReview(true);
        }}
      >
        Export
      </button>
      {review && plan && (
        <dialog
          ref={dialog}
          className="export-dialog"
          aria-labelledby="export-heading"
          onCancel={() => setReview(false)}
          onClose={() => setReview(false)}
        >
          <h2 id="export-heading">Export as {format}</h2>
          <p>Review the conversion before downloading. Processing stays in your browser.</p>
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
                <h3>Omitted or changed</h3>
                <ul>
                  {plan.report.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="export-dialog-actions">
            <button autoFocus onClick={() => setReview(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={plan.report.errors.length > 0}
              onClick={() => {
                setReview(false);
                saveAs(format);
              }}
            >
              Download {format}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

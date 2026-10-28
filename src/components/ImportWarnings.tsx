import { useState } from 'react';
import type { MotionData } from '../motion/types';

/** Hide presentation only. Import limitations and export disclosures stay in MotionData. */
export function ImportWarnings({ data }: { data: MotionData }) {
  // Each successful import attaches fresh file properties, even for the same File.
  // Those properties survive edits, crop and workspace changes within the trial.
  const scope = data.source.filesystem ?? data.warnings;
  const [presentation, setPresentation] = useState({ scope, dismissed: new Set<number>() });
  if (presentation.scope !== scope) {
    setPresentation({ scope, dismissed: new Set<number>() });
  }
  const dismissed = presentation.scope === scope ? presentation.dismissed : new Set<number>();
  const visible = data.warnings.flatMap((message, index) =>
    dismissed.has(index) ? [] : [{ message, index }],
  );
  const dismiss = (indices: number[]) =>
    setPresentation({ scope, dismissed: new Set([...dismissed, ...indices]) });
  if (!visible.length) return null;
  return (
    <div className="warnings">
      <details>
        <summary>
          {visible.length} import {visible.length === 1 ? 'note' : 'notes'}{' '}
          <span>
            {data.source.partialImport
              ? 'File loaded with limitations: rotation data was not imported'
              : 'Review data conventions'}
          </span>
        </summary>
        <ul>
          {visible.map(({ message, index }) => (
            <li key={index}>
              <div className="warning-note">
                <span>{message}</span>
                <button
                  type="button"
                  className="warning-dismiss"
                  aria-label="Dismiss warning"
                  onClick={() => dismiss([index])}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </details>
      <button
        type="button"
        className="warning-dismiss warning-dismiss-all"
        aria-label="Dismiss all import warnings"
        onClick={() => dismiss(visible.map(({ index }) => index))}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

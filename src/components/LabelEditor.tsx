import { useId, useState } from 'react';

/** Shared committed-label editor; native text undo stays local to its draft. */
export function LabelEditor({
  name,
  busy,
  onSave,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onSave: (label: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [validation, setValidation] = useState('');
  const errorId = useId();
  return (
    <form
      className="label-rename"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        try {
          onSave(draft);
          onCancel();
        } catch (error) {
          setValidation((error as Error).message);
        }
      }}
    >
      <input
        autoFocus
        aria-label={`New label for ${name}`}
        value={draft}
        aria-invalid={!!validation}
        aria-describedby={validation ? errorId : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setValidation('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <button type="submit" disabled={busy} title="Confirm label">
        Save
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      {validation && (
        <span id={errorId} role="alert">
          {validation}
        </span>
      )}
    </form>
  );
}

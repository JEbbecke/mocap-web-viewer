import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../state/session';
import { saveSelectedMarkerName } from '../state/markerCommands';
import { LabelEditor } from './LabelEditor';

export function MarkerRenameDialog() {
  const request = useSession((s) => s.markerRename);
  const data = useSession((s) => s.data);
  const selected = useSession((s) => s.selected);
  const busy = useSession((s) => s.busy);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const valid = !!request && request.data === data && request.marker === selected && !busy;
  const close = () => useSession.setState({ markerRename: null });
  useEffect(() => {
    if (!valid) {
      if (request) close();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector('input')?.select();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [valid, request]);
  if (!valid) return null;
  const name = data!.markers.labels[selected];
  return createPortal(
    <dialog
      ref={dialog}
      className="export-dialog marker-rename-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <h2 id={id}>Rename marker</h2>
      <LabelEditor
        key={name}
        name={name}
        busy={busy}
        onSave={(value) => {
          if (!saveSelectedMarkerName(value)) throw new Error('Marker is no longer available.');
        }}
        onCancel={close}
      />
    </dialog>,
    document.body,
  );
}

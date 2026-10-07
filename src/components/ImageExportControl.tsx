import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { MotionData } from '../motion/types';
import { useSession } from '../state/session';
import {
  DEFAULT_IMAGE_EXPORT,
  IMAGE_RESOLUTIONS,
  saveSceneImage,
  type ImageExportRequest,
  type ImageResolution,
} from '../viewer/imageExport';

export function ImageExportControl({
  data,
  active,
  request,
  open,
  onClose,
}: {
  data: MotionData | null;
  active: boolean;
  request: RefObject<ImageExportRequest | null>;
  open: boolean;
  onClose: () => void;
}) {
  const sourceFile = useSession((s) => s.sourceFile);
  const busy = useSession((s) => s.busy);
  const [resolution, setResolution] = useState<ImageResolution>(DEFAULT_IMAGE_EXPORT.resolution);
  const [watermark, setWatermark] = useState(DEFAULT_IMAGE_EXPORT.watermark);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const id = useId();
  const close = () => {
    pending.current?.abort();
    pending.current = null;
    dialog.current?.close();
    setExporting(false);
    onClose();
  };
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setExporting(false);
    setMessage('');
    setError('');
    return () => {
      pending.current?.abort();
    };
  }, [data, active, busy]);
  useEffect(() => {
    if (open) {
      setError('');
      setMessage('');
      dialog.current?.showModal();
    } else pending.current?.abort();
  }, [open]);
  const exportImage = async () => {
    setError('');
    setMessage('');
    if (!data || !request.current) {
      setError('Image export failed. The 3D renderer is unavailable.');
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setExporting(true);
    try {
      const image = await request.current({ resolution, watermark }, controller.signal);
      if (controller.signal.aborted) return;
      saveSceneImage(image, sourceFile?.name ?? data.name);
      setMessage('Image exported.');
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          `Image export failed. ${failure instanceof Error ? failure.message : 'Try a smaller resolution.'}`,
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setExporting(false);
      }
    }
  };
  return (
    <>
      {open && (
        <dialog
          ref={dialog}
          className="export-dialog image-export-dialog"
          aria-labelledby={`${id}-title`}
          onClick={(event) => event.stopPropagation()}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClose={close}
        >
          <h2 id={`${id}-title`}>Export image</h2>
          <p>The current 3D scene only. Playback can continue while this dialog is open.</p>
          <div className="image-resolution">
            <label htmlFor={`${id}-resolution`}>Image resolution</label>
            <select
              id={`${id}-resolution`}
              value={resolution}
              disabled={exporting}
              onChange={(event) => setResolution(event.target.value as ImageResolution)}
            >
              {IMAGE_RESOLUTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <label className="image-watermark">
            <input
              type="checkbox"
              checked={watermark}
              disabled={exporting}
              onChange={(event) => setWatermark(event.target.checked)}
            />{' '}
            Include JE Motion Lab watermark
          </label>
          <p className="muted">
            A different aspect ratio expands the view without stretching or cutting off the current
            framing.
          </p>
          {error && <p role="alert">{error}</p>}
          <p role="status">{exporting ? 'Creating PNG…' : message}</p>
          <div className="export-dialog-actions">
            <button onClick={close}>{exporting ? 'Cancel' : 'Close'}</button>
            <button className="primary" disabled={exporting} onClick={exportImage}>
              Export PNG
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

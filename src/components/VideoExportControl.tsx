import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { MotionData } from '../motion/types';
import { useSession } from '../state/session';
import { imageSize, saveMediaBlob } from '../viewer/imageExport';
import {
  DEFAULT_VIDEO_EXPORT,
  VIDEO_UNAVAILABLE,
  videoCapability,
  videoFilename,
  type VideoExportOptions,
  type VideoExportRequest,
  type VideoProgress,
} from '../viewer/videoExport';
import { videoSchedule } from '../viewer/videoTiming';

export function VideoExportControl({
  data,
  request,
  open,
  onClose,
}: {
  data: MotionData | null;
  request: RefObject<VideoExportRequest | null>;
  open: boolean;
  onClose: () => void;
}) {
  const file = useSession((state) => state.sourceFile);
  const [options, setOptions] = useState<VideoExportOptions>({ ...DEFAULT_VIDEO_EXPORT });
  const [capabilityError, setCapabilityError] = useState(''),
    [checking, setChecking] = useState(true);
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [progress, setProgress] = useState<VideoProgress>({ completed: 0, total: 1 });
  const dialog = useRef<HTMLDialogElement>(null),
    pending = useRef<AbortController | null>(null);
  const id = useId();
  let rangeError = '',
    duration = 0;
  try {
    if (data)
      duration =
        videoSchedule(0, data.timeline.duration, options.fps, options.speed).durationUs / 1e6;
  } catch (failure) {
    rangeError = failure instanceof Error ? failure.message : 'Invalid video range.';
  }
  const close = () => {
    pending.current?.abort();
    pending.current = null;
    dialog.current?.close();
    setExporting(false);
    onClose();
  };
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      setError('');
      setMessage('');
    } else {
      pending.current?.abort();
      setExporting(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const capabilityController = new AbortController();
    setChecking(true);
    setCapabilityError('');
    const check = async () => {
      try {
        if (!request.current) throw new Error('The 3D renderer is unavailable.');
        const size = imageSize(options.resolution, request.current.viewport());
        if (size.width * size.height > 1920 * 1080)
          throw new Error('Choose 1920 × 1080; this viewport exceeds the video pixel limit.');
        if (!(await videoCapability(size, options.fps, capabilityController.signal)))
          throw new Error(VIDEO_UNAVAILABLE);
      } catch (failure) {
        if (!cancelled)
          setCapabilityError(failure instanceof Error ? failure.message : VIDEO_UNAVAILABLE);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
      capabilityController.abort();
    };
  }, [open, options.resolution, options.fps, request]);
  const exportVideo = async () => {
    if (!data || !request.current) {
      setError('Video export failed. Open a recording in the viewer.');
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setExporting(true);
    setError('');
    setMessage('');
    setProgress({ completed: 0, total: 1 });
    try {
      const video = await request.current.exportVideo(options, controller.signal, (value) => {
        if (!controller.signal.aborted) setProgress(value);
      });
      if (controller.signal.aborted) return;
      saveMediaBlob(video.blob, videoFilename(file?.name ?? data.name, video.fps, video.blob.type));
      setMessage('Video exported.');
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          `Video export failed. ${failure instanceof Error ? failure.message : 'Try a shorter clip.'}`,
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setExporting(false);
      }
    }
  };
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className="export-dialog video-export-dialog"
      aria-labelledby={`${id}-title`}
      onClick={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={close}
    >
      <h2 id={`${id}-title`}>Export video</h2>
      <p>
        The current trial’s recorded time span, including applied crops. The live view stays at its
        current frame.
      </p>
      <div className="media-export-field">
        <label htmlFor={`${id}-resolution`}>Video resolution</label>
        <select
          id={`${id}-resolution`}
          disabled={exporting}
          value={options.resolution}
          onChange={(event) =>
            setOptions({
              ...options,
              resolution: event.target.value as VideoExportOptions['resolution'],
            })
          }
        >
          <option value="viewport">Current viewport</option>
          <option value="1080p">1920 × 1080</option>
        </select>
      </div>
      <div className="media-export-field">
        <label htmlFor={`${id}-fps`}>Frame rate</label>
        <select
          id={`${id}-fps`}
          disabled={exporting}
          value={options.fps}
          onChange={(event) =>
            setOptions({ ...options, fps: Number(event.target.value) as VideoExportOptions['fps'] })
          }
        >
          <option value="30">30 fps</option>
          <option value="60">60 fps</option>
        </select>
      </div>
      <div className="media-export-field">
        <label htmlFor={`${id}-speed`}>Playback speed</label>
        <select
          id={`${id}-speed`}
          disabled={exporting}
          value={options.speed}
          onChange={(event) =>
            setOptions({
              ...options,
              speed: Number(event.target.value) as VideoExportOptions['speed'],
            })
          }
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
        </select>
      </div>
      <label className="image-watermark">
        <input
          type="checkbox"
          disabled={exporting}
          checked={options.watermark}
          onChange={(event) => setOptions({ ...options, watermark: event.target.checked })}
        />{' '}
        Include JE Motion Lab watermark
      </label>
      <p>Estimated duration: {duration.toFixed(3)} s</p>
      <p className="muted">
        WebM format is selected automatically. Up to two minutes and 64 MiB. Encoding may take
        longer than the video’s duration.
      </p>
      {(rangeError || capabilityError) && <p role="status">{rangeError || capabilityError}</p>}
      {error && <p role="alert">{error}</p>}
      {exporting && (
        <progress
          aria-label="Video export progress"
          value={progress.completed}
          max={progress.total}
        />
      )}
      <p role="status">
        {exporting ? `Rendering video… Frame ${progress.completed} / ${progress.total}` : message}
      </p>
      <div className="export-dialog-actions">
        <button onClick={close}>{exporting ? 'Cancel' : 'Close'}</button>
        <button
          className="primary"
          disabled={exporting || checking || !!rangeError || !!capabilityError}
          onClick={exportVideo}
        >
          Export video
        </button>
      </div>
    </dialog>
  );
}

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { MotionData } from '../motion/types';
import { useSession } from '../state/session';
import type { ImageExportRequest } from '../viewer/imageExport';
import {
  videoMenuCapability,
  VIDEO_UNAVAILABLE,
  type VideoExportRequest,
} from '../viewer/videoExport';
import { ImageExportControl } from './ImageExportControl';
import { VideoExportControl } from './VideoExportControl';

export function MediaExportControl({
  data,
  active,
  imageRequest,
  videoRequest,
}: {
  data: MotionData | null;
  active: boolean;
  imageRequest: RefObject<ImageExportRequest | null>;
  videoRequest: RefObject<VideoExportRequest | null>;
}) {
  const busy = useSession((state) => state.busy);
  const [menuOpen, setMenuOpen] = useState(false);
  const [workflow, setWorkflow] = useState<'image' | 'video' | null>(null);
  const [videoSupported, setVideoSupported] = useState<boolean | null>(null);
  const control = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const disabled = !data || !active || busy;
  const closeWorkflow = () => {
    setWorkflow(null);
    trigger.current?.focus();
  };
  useEffect(() => {
    setWorkflow(null);
    setMenuOpen(false);
  }, [data, active, busy]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    let cancelled = false;
    const capabilityController = new AbortController();
    setVideoSupported(null);
    videoMenuCapability(videoRequest.current?.viewport(), capabilityController.signal)
      .then((result) => {
        if (!cancelled) setVideoSupported(!!result);
      })
      .catch(() => {
        if (!cancelled) setVideoSupported(false);
      });
    const outside = (event: Event) => {
      if (!control.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      cancelled = true;
      capabilityController.abort();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [menuOpen, videoRequest]);
  return (
    <div
      ref={control}
      className="export-control media-export-control"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={trigger}
        id={`${id}-trigger`}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? `${id}-menu` : undefined}
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setMenuOpen(true);
          }
        }}
      >
        Export media <span aria-hidden="true">▾</span>
      </button>
      {menuOpen && (
        <div
          ref={menu}
          id={`${id}-menu`}
          className="export-menu"
          role="menu"
          aria-labelledby={`${id}-trigger`}
          onKeyDown={(event) => {
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
              ),
            ];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
              items[next]?.focus();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setMenuOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setWorkflow('image');
            }}
          >
            Export image…
          </button>
          <button
            role="menuitem"
            disabled={!videoSupported}
            onClick={() => {
              setMenuOpen(false);
              setWorkflow('video');
            }}
          >
            Export video…
          </button>
          {videoSupported !== true && (
            <p role="status">
              {videoSupported === null ? 'Checking video export support…' : VIDEO_UNAVAILABLE}
            </p>
          )}
        </div>
      )}
      <ImageExportControl
        data={data}
        active={active}
        request={imageRequest}
        open={workflow === 'image'}
        onClose={closeWorkflow}
      />
      <VideoExportControl
        data={data}
        request={videoRequest}
        open={workflow === 'video'}
        onClose={closeWorkflow}
      />
    </div>
  );
}

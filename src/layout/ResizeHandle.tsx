import { useEffect, useRef, useState } from 'react';
import { dragSize, keyboardSize, type ResizeAxis } from './geometry';

interface ResizeHandleProps {
  axis: ResizeAxis;
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  /** Negative when the controlled panel follows the separator. */
  sign?: number;
}

/** Pointer capture keeps nested splitters independent without document move listeners. */
export function ResizeHandle(props: ResizeHandleProps) {
  const { axis, label, controls, value, min, max, sign = 1, onChange, onReset } = props;
  const current = useRef(props);
  current.current = props;
  const [active, setActive] = useState(false);
  const drag = useRef<{
    pointer: number;
    origin: number;
    start: number;
    element: HTMLDivElement;
    previous: string | null;
    blur: () => void;
  } | null>(null);
  const frame = useRef(0),
    pending = useRef<number | null>(null);
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current !== null) {
      current.current.onChange(pending.current);
      pending.current = null;
    }
  };
  const finish = (mounted = true) => {
    const state = drag.current;
    if (!state) return;
    flush();
    drag.current = null;
    window.removeEventListener('blur', state.blur);
    if (state.element.hasPointerCapture(state.pointer))
      state.element.releasePointerCapture(state.pointer);
    if (state.previous === null) document.documentElement.removeAttribute('data-panel-resize');
    else document.documentElement.setAttribute('data-panel-resize', state.previous);
    if (mounted) setActive(false);
  };
  useEffect(() => () => finish(false), []);
  return (
    <div
      className={`resize-handle resize-${axis}${active ? ' is-resizing' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} pixels`}
      title={`${label}. Drag or use arrow keys (Shift for larger steps). Double-click or Home to reset.`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current || min === max) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const blur = () => finish();
        drag.current = {
          pointer: event.pointerId,
          origin: axis === 'horizontal' ? event.clientX : event.clientY,
          start: value,
          element: event.currentTarget,
          previous: document.documentElement.getAttribute('data-panel-resize'),
          blur,
        };
        document.documentElement.setAttribute('data-panel-resize', axis);
        window.addEventListener('blur', blur);
        setActive(true);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const config = current.current;
        const position = axis === 'horizontal' ? event.clientX : event.clientY;
        pending.current = dragSize(
          state.start,
          position - state.origin,
          sign,
          config.min,
          config.max,
        );
        if (!frame.current) frame.current = requestAnimationFrame(flush);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        finish();
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointer === event.pointerId) finish();
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointer === event.pointerId) finish();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        finish();
        onReset();
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = keyboardSize(event.key, axis, value, sign, min, max, event.shiftKey ? 40 : 10);
        if (event.key !== 'Home' && next === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Home') onReset();
        else onChange(next!);
      }}
    />
  );
}

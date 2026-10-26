export type ResizeAxis = 'horizontal' | 'vertical';

/** Effective constraints never replace the user's preferred dimension. */
export function panelBounds(minimum: number, maximum: number) {
  const max = Math.max(0, maximum);
  return { min: Math.min(Math.max(0, minimum), max), max };
}

export function clampPanel(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function dragSize(start: number, delta: number, sign: number, min: number, max: number) {
  return clampPanel(start + delta * sign, min, max);
}

export function splitSizes(width: number, ratio: number, minimum = 250) {
  const resizable = width >= minimum * 2;
  const left = resizable ? clampPanel(width * ratio, minimum, width - minimum) : minimum;
  return { left, right: resizable ? width - left : minimum, resizable };
}

export function keyboardSize(
  key: string,
  axis: ResizeAxis,
  value: number,
  sign: number,
  min: number,
  max: number,
  step: number,
) {
  const previous = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  const next = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  if (key !== previous && key !== next) return null;
  return dragSize(value, key === previous ? -step : step, sign, min, max);
}

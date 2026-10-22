import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResizeHandle } from '../src/layout/ResizeHandle';
import {
  clampPanel,
  dragSize,
  keyboardSize,
  panelBounds,
  splitSizes,
} from '../src/layout/geometry';

describe('container-constrained workspace dimensions', () => {
  it('uses defaults, clamps temporarily and restores the untouched preference', () => {
    const preferred = 480;
    expect(clampPanel(310, 260, 560)).toBe(310);
    expect(clampPanel(preferred, 260, 346)).toBe(346);
    expect(clampPanel(preferred, 260, 560)).toBe(480);
    expect(panelBounds(260, -40)).toEqual({ min: 0, max: 0 });
    expect(panelBounds(260, 200)).toEqual({ min: 200, max: 200 });
  });

  it('resizes either edge along either axis without accumulating rounding drift', () => {
    expect(dragSize(310, -75, -1, 260, 560)).toBe(385);
    expect(dragSize(254, -80, -1, 180, 600)).toBe(334);
    expect(dragSize(250, 93.25, 1, 180, 520)).toBe(343.25);
    expect(dragSize(310, -10000, -1, 260, 560)).toBe(560);
    expect(dragSize(310, 10000, -1, 260, 560)).toBe(260);
    expect(dragSize(310, 0, -1, 260, 560)).toBe(310);
  });

  it('only handles keyboard input on the relevant axis and respects physical direction', () => {
    expect(keyboardSize('ArrowLeft', 'horizontal', 310, -1, 260, 560, 10)).toBe(320);
    expect(keyboardSize('ArrowDown', 'vertical', 254, -1, 180, 600, 40)).toBe(214);
    expect(keyboardSize('ArrowUp', 'horizontal', 310, -1, 260, 560, 10)).toBeNull();
    expect(keyboardSize('ArrowLeft', 'horizontal', 555, -1, 260, 560, 40)).toBe(560);
    expect(keyboardSize('Space', 'vertical', 254, -1, 180, 600, 10)).toBeNull();
  });

  it('exposes an oriented, named, focusable separator with documented reset controls', () => {
    const view = renderToStaticMarkup(
      createElement(ResizeHandle, {
        axis: 'horizontal',
        label: 'Trial Inspector width',
        controls: 'trial-inspector',
        value: 310,
        min: 260,
        max: 560,
        onChange: () => {},
        onReset: () => {},
      }),
    );
    expect(view).toContain('role="separator"');
    expect(view).toContain('tabindex="0"');
    expect(view).toContain('aria-orientation="vertical"');
    expect(view).toContain('aria-controls="trial-inspector"');
    expect(view).toContain('aria-valuenow="310"');
    expect(view).toContain('Double-click or Home to reset');
  });

  it('keeps both plots usable and restores the ratio after temporary container constraints', () => {
    expect(splitSizes(1000, 0.5)).toEqual({ left: 500, right: 500, resizable: true });
    expect(splitSizes(1000, 0.65)).toEqual({ left: 650, right: 350, resizable: true });
    expect(splitSizes(600, 0.65)).toEqual({ left: 350, right: 250, resizable: true });
    expect(splitSizes(400, 0.65)).toEqual({ left: 250, right: 250, resizable: false });
    expect(splitSizes(1000, 0.65)).toEqual({ left: 650, right: 350, resizable: true });
    for (const width of [1920, 1366, 941, 500, 400, 2560]) {
      const sizes = splitSizes(width, 0.651234);
      expect(sizes.left).toBeGreaterThanOrEqual(250);
      expect(sizes.right).toBeGreaterThanOrEqual(250);
      expect(sizes.left + sizes.right).toBe(Math.max(width, 500));
    }
  });
});

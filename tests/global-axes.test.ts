import { expect, it } from 'vitest';
import { AxesHelper, Raycaster, Scene, Vector4, type WebGLRenderer } from 'three';
import { createGlobalAxes } from '../src/viewer/globalAxes';
import { isolateScientificScene } from '../src/viewer/scientificScene';
import { useSession } from '../src/state/session';

it('preserves all original world-origin endpoints and color gradients', () => {
  const original = new AxesHelper(0.5),
    axes = createGlobalAxes();
  try {
    for (const [attribute, start, end] of [
      ['position', 'instanceStart', 'instanceEnd'],
      ['color', 'instanceColorStart', 'instanceColorEnd'],
    ]) {
      const expected = original.geometry.getAttribute(attribute);
      for (let segment = 0; segment < 3; segment++) {
        for (const [index, name] of [start, end].entries()) {
          const actual = axes.geometry.getAttribute(name);
          expect([actual.getX(segment), actual.getY(segment), actual.getZ(segment)]).toEqual([
            expected.getX(segment * 2 + index),
            expected.getY(segment * 2 + index),
            expected.getZ(segment * 2 + index),
          ]);
        }
      }
    }
    expect(axes.position.toArray()).toEqual([0, 0, 0]);
    expect(axes.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(axes.scale.toArray()).toEqual([1, 1, 1]);
    expect(new Raycaster().intersectObject(axes)).toEqual([]);
  } finally {
    original.dispose();
    axes.geometry.dispose();
    axes.material.dispose();
  }
});

it('updates screen-space thickness from the current logical viewport, including isolated exports', () => {
  const axes = createGlobalAxes(),
    scene = new Scene();
  scene.add(axes);
  const isolated = isolateScientificScene(scene, useSession.getState());
  try {
    const copy = isolated.scene.getObjectByName(axes.name) as typeof axes;
    expect(copy).not.toBe(axes);
    expect(copy.geometry).not.toBe(axes.geometry);
    for (const line of [axes, copy]) {
      expect(line.material.worldUnits).toBe(false);
      expect(line.material.linewidth).toBe(3);
      expect(line.material.depthTest).toBe(false);
      expect(line.material.depthWrite).toBe(false);
      expect(line.material.transparent).toBe(true);
      expect(line.material.opacity).toBe(1);
      expect(line.renderOrder).toBeGreaterThan(3);
      for (const [width, height] of [
        [320, 440],
        [1100, 600],
        [3840, 2160],
      ]) {
        // WebGLRenderer.getViewport reports logical pixels, independent of DPR.
        const renderer = { getViewport: (target: Vector4) => target.set(0, 0, width, height) };
        line.onBeforeRender(renderer as WebGLRenderer);
        expect(line.material.resolution.toArray()).toEqual([width, height]);
      }
    }
  } finally {
    isolated.dispose();
    axes.geometry.dispose();
    axes.material.dispose();
  }
});

import { AxesHelper } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { sceneLength } from './scale';

/** Decorative global reference only; never included in scientific camera bounds. */
export function createGlobalAxes() {
  // Retain the pre-usability helper's exact 0.5-unit arms and RGB gradients.
  const original = new AxesHelper(0.5);
  const geometry = new LineSegmentsGeometry().fromLineSegments(original);
  geometry.setColors(original.geometry.getAttribute('color').array as Float32Array);
  original.dispose();
  const material = new LineMaterial({
    linewidth: sceneLength(20), // 4% of each 500 mm arm; 0.020 scene units.
    worldUnits: true,
    vertexColors: true,
    toneMapped: false,
    alphaToCoverage: true,
    depthTest: false,
    depthWrite: false,
    // Plates are transparent. Joining that pass is required to draw after them,
    // even with depth testing disabled. Opacity remains 1.
    transparent: true,
  });
  const axes = new LineSegments2(geometry, material);
  axes.name = 'Global coordinate axes';
  axes.renderOrder = 10; // After plate surfaces (1), outlines (2) and numbers (3).
  axes.raycast = () => {};
  // LineSegments2.onBeforeRender maintains the viewport aspect on resize/export.
  // Thickness stays in world units, with natural perspective scaling on zoom.
  return axes;
}

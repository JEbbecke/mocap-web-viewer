import { beforeEach, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three-stdlib';
import { parseC3D } from '../src/importers/c3d/importer';
import fixtures from './fixtures/c3d.json';
import { CameraController } from '../src/viewer/cameraController';
import { markerScenePosition } from '../src/viewer/markerPosition';
import { handleApplicationShortcut } from '../src/state/shortcuts';
import {
  closeMarkerInteractions,
  deleteSelectedMarker,
  focusSelectedMarker,
  openSelectedMarkerMenu,
  renameSelectedMarker,
  saveSelectedMarkerName,
  selectMarker,
  selectedMarkerActions,
} from '../src/state/markerCommands';
import {
  applyCrop,
  redoEdit,
  selectCrop,
  setData,
  setFrame,
  undoEdit,
  useSession,
} from '../src/state/session';

const state = useSession.getState;
const context = { viewerActive: true, closeExplorer: vi.fn() };
beforeEach(() => {
  setData(
    parseC3D(Uint8Array.from(Buffer.from(fixtures.intelFloat, 'base64')).buffer, 'markers.c3d'),
  );
  useSession.setState({ viewerReady: true });
});
function key(key: string, extra: Partial<KeyboardEvent> = {}, scope = '') {
  const preventDefault = vi.fn();
  const event = {
    key,
    code: key === ' ' ? 'Space' : key,
    preventDefault,
    target: { closest: (selector: string) => (scope && selector.includes(scope) ? {} : null) },
    ...extra,
  } as unknown as KeyboardEvent;
  const handled = handleApplicationShortcut(event, context);
  expect(preventDefault).toHaveBeenCalledTimes(handled ? 1 : 0);
  return handled;
}

it('focuses the selected current sample through the shared controller and holds a static pivot', () => {
  selectMarker(1);
  setFrame(1);
  const data = state().data!;
  const sample = data.markers.labels.length + 1;
  data.markers.valid[sample] = 1;
  if (data.markers.residuals) data.markers.residuals[sample] = 0;
  data.markers.positions.set([1234, -456, 789], sample * 3);
  const camera = new PerspectiveCamera(42, 1.5, 0.005, 2000);
  camera.up.set(0, 0, 1);
  camera.position.set(2, -3, 2);
  const controls = new OrbitControls(camera);
  controls.minDistance = 0.05;
  controls.update();
  const controller = new CameraController(camera, controls);
  const offset = camera.position.clone().sub(controls.target);
  const history = state().history;
  expect(key('c')).toBe(true);
  const expected = markerScenePosition(data, 1, 1)!;
  expect(state().camera.point).toEqual(expected.toArray());
  expect(controller.applyRequest(data, 1, state().camera)).toBe(true);
  expect(controls.target.distanceTo(expected)).toBeLessThan(1e-9);
  expect(camera.position.clone().sub(controls.target).distanceTo(offset)).toBeLessThan(1e-9);
  controls.setAzimuthalAngle(controls.getAzimuthalAngle() + 0.4);
  controls.update();
  expect(controls.target.distanceTo(expected)).toBeLessThan(1e-9);
  setFrame(2);
  expect(controller.applyRequest(data, 2, state().camera)).toBe(false);
  expect(controls.target.distanceTo(expected)).toBeLessThan(1e-9);
  expect(state().history).toBe(history);
  expect(key('f')).toBe(true);
  expect(state().camera.point).toBeUndefined();
  expect(controller.applyRequest(data, 2, state().camera)).toBe(true);
  expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
});

it('uses normalized millimetres once, including a legitimate world origin', () => {
  const data = state().data!;
  data.markers.positions.set([1234, -456, 789]);
  expect(markerScenePosition(data, 0, 0)!.toArray()).toEqual([1.234, -0.456, 0.789]);
  data.markers.positions.set([0, 0, 0]);
  expect(markerScenePosition(data, 0, 0)).toEqual(new Vector3());
});

it.each([
  'missing',
  'nan',
  'infinity',
  'residual',
  'nan residual',
  'missing coordinates',
  'frame',
  'selection',
  'no data',
  'no viewer',
])('safely rejects %s focus without camera requests or frame changes', (scenario) => {
  const data = state().data!;
  if (scenario === 'missing') data.markers.valid[0] = 0;
  if (scenario === 'nan') data.markers.positions[0] = NaN;
  if (scenario === 'infinity') data.markers.positions[1] = Infinity;
  if (scenario === 'missing coordinates') data.markers.positions = new Float64Array();
  if (scenario.includes('residual')) {
    data.markers.residuals ??= new Float64Array(data.markers.valid.length);
    data.markers.residuals[0] = scenario === 'residual' ? -1 : NaN;
  }
  if (scenario === 'frame') useSession.setState({ frame: 9999 });
  if (scenario === 'selection') useSession.setState({ selected: -1 });
  if (scenario === 'no data') useSession.setState({ data: null });
  if (scenario === 'no viewer') useSession.setState({ viewerReady: false });
  const before = state();
  expect(selectedMarkerActions().focus).toBe(false);
  expect(key('c')).toBe(false);
  expect(focusSelectedMarker()).toBe(false);
  expect(state().camera).toBe(before.camera);
  expect(state().frame).toBe(before.frame);
});

it('targets B after selecting A, with shared rename validation/history and unchanged scientific data', () => {
  const data = state().data!;
  selectMarker(0);
  openSelectedMarkerMenu(10, 20);
  selectMarker(1);
  openSelectedMarkerMenu(30, 40);
  expect(state().markerMenu?.marker).toBe(1);
  expect(renameSelectedMarker()).toBe(true);
  expect(state().markerMenu).toBeNull();
  for (const name of ['', data.markers.labels[0], 'bad\0name'])
    expect(() => saveSelectedMarkerName(name)).toThrow();
  expect(saveSelectedMarkerName('  Renamed B  ')).toBe(true);
  expect(state().data!.markers.labels).toEqual([data.markers.labels[0], 'Renamed B']);
  for (const field of ['positions', 'valid', 'residuals', 'quality'] as const)
    expect(state().data!.markers[field]).toBe(data.markers[field]);
  for (const field of ['timeline', 'events', 'analogs', 'forcePlatforms'] as const)
    expect(state().data![field]).toBe(data[field]);
  expect(state().selected).toBe(1);
  undoEdit();
  expect(state().data!.markers.labels).toEqual(data.markers.labels);
  redoEdit();
  expect(state().data!.markers.labels[1]).toBe('Renamed B');
});

it('cancels drafts and rejects stale requests on selection, replacement, crop and busy operations', () => {
  const data = state().data!;
  renameSelectedMarker();
  closeMarkerInteractions();
  expect(state().history.past).toHaveLength(0);
  renameSelectedMarker();
  selectMarker(1);
  expect(saveSelectedMarkerName('Wrong')).toBe(false);
  renameSelectedMarker();
  setData(data);
  expect(saveSelectedMarkerName('Wrong')).toBe(false);
  renameSelectedMarker();
  selectCrop(0, 2);
  applyCrop();
  expect(state().markerRename).toBeNull();
  useSession.setState({ busy: true });
  expect(renameSelectedMarker()).toBe(false);
  expect(focusSelectedMarker()).toBe(false);
});

it('safely refuses deletion of the last remaining trajectory', () => {
  deleteSelectedMarker();
  selectMarker(0);
  const before = state();
  expect(selectedMarkerActions().delete).toBe(false);
  expect(key('Delete')).toBe(false);
  expect(deleteSelectedMarker()).toBe(false);
  expect(state()).toBe(before);
});

it('preserves playback toggles, single-frame steps, Home/End and unified history', () => {
  expect(key(' ')).toBe(true);
  expect(state().playing).toBe(true);
  key(' ');
  expect(state().playing).toBe(false);
  key('ArrowRight');
  expect(state().frame).toBe(1);
  key('ArrowRight', { repeat: true });
  expect(state().frame).toBe(2);
  key('ArrowLeft');
  expect(state().frame).toBe(1);
  key('Home');
  expect(state().frame).toBe(0);
  key('End');
  expect(state().frame).toBe(state().data!.timeline.frameCount - 1);
  expect(key('U', { ctrlKey: true, shiftKey: true })).toBe(true);
  saveSelectedMarkerName('Edited');
  key('z', { ctrlKey: true });
  expect(state().dirty).toBe(false);
  key('y', { ctrlKey: true });
  expect(state().dirty).toBe(true);
  key('z', { metaKey: true });
  expect(state().dirty).toBe(false);
  key('Z', { metaKey: true, shiftKey: true });
  expect(state().dirty).toBe(true);
});

it.each([
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  '[role="separator"]',
  '[role="menu"]',
  'dialog',
  '.event-editor',
  '.signal-pane',
  '.data-explorer',
])('protects local editing/navigation in %s', (scope) => {
  renameSelectedMarker();
  saveSelectedMarkerName('Edited');
  const before = state();
  for (const [name, mods] of [
    ['c', {}],
    ['Delete', {}],
    [' ', {}],
    ['ArrowRight', {}],
    ['U', { ctrlKey: true, shiftKey: true }],
  ] as const)
    expect(key(name, mods, scope)).toBe(false);
  expect(state()).toBe(before);
});

it('preserves application history from read-only Explorer and plot widgets', () => {
  for (const scope of ['.data-explorer', '.signal-pane', '[role="separator"]']) {
    renameSelectedMarker();
    saveSelectedMarkerName(`Edited ${scope}`);
    expect(key('z', { ctrlKey: true }, scope)).toBe(true);
    expect(state().dirty).toBe(false);
  }
  renameSelectedMarker();
  saveSelectedMarkerName('Edited');
  const before = state();
  for (const scope of [
    'input',
    'textarea',
    '[contenteditable]',
    '[role="menu"]',
    'dialog',
    '.event-editor',
  ])
    expect(key('z', { ctrlKey: true }, scope)).toBe(false);
  expect(state()).toBe(before);
});

it('protects native control activation and ignores modifiers, composition, prevented events and repeated actions', () => {
  expect(key(' ', {}, 'button')).toBe(false);
  expect(key('ArrowLeft', {}, 'button')).toBe(false);
  for (const extra of [
    { defaultPrevented: true },
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { repeat: true },
  ])
    expect(key('c', extra)).toBe(false);
  expect(key('U', { ctrlKey: true, shiftKey: true, repeat: true })).toBe(false);
  const before = state().playing;
  expect(key(' ', { repeat: true })).toBe(false);
  expect(state().playing).toBe(before);
  expect(
    handleApplicationShortcut({ key: 'c', target: null } as KeyboardEvent, {
      ...context,
      viewerActive: false,
    }),
  ).toBe(false);
});

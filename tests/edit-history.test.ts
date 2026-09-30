import { beforeEach, expect, it } from 'vitest';
import { parseC3D } from '../src/importers/c3d/importer';
import fixtures from './fixtures/c3d.json';
import {
  applyCrop,
  cancelImport,
  editSessionEvent,
  redoEdit,
  renameSessionMarker,
  renameSessionAnalog,
  restoreOriginal,
  selectCrop,
  setData,
  toggleMarker,
  undoEdit,
  useSession,
} from '../src/state/session';
import { HISTORY_LIMIT } from '../src/motion/history';
import { connectionSets, resolveConnections } from '../src/motion/connections';
import { dataSections, filterDataSections } from '../src/components/dataSections';
import { handleHistoryShortcut } from '../src/state/shortcuts';

const state = useSession.getState;
const current = () => state().data!;
beforeEach(() => {
  const data = parseC3D(
    Uint8Array.from(Buffer.from(fixtures.intelFloat, 'base64')).buffer,
    'synthetic',
  );
  data.markers.labels = ['L_ASIS', '*33'];
  setData(data);
});
it('renames labels without touching scientific arrays, selection, visibility or plot identity', () => {
  const original = current();
  toggleMarker(1);
  useSession.setState({ selected: 1, plot: 'marker:1' });
  renameSessionMarker(1, '  R_Thigh  ');
  expect(current().markers.labels).toEqual(['L_ASIS', 'R_Thigh']);
  expect(state()).toMatchObject({ selected: 1, plot: 'marker:1', dirty: true });
  expect(state().hidden.has(1)).toBe(true);
  for (const key of ['positions', 'valid', 'residuals', 'quality'] as const)
    expect(current().markers[key]).toBe(original.markers[key]);
  expect(current().analogs).toBe(original.analogs);
  expect(current().forcePlatforms).toBe(original.forcePlatforms);
  expect(filterDataSections(dataSections(current()), '*33')).toEqual([]);
  expect(filterDataSections(dataSections(current()), 'r_thigh')[0].entries[0].marker).toBe(1);
  undoEdit();
  expect(current().markers.labels).toEqual(original.markers.labels);
  expect(state().dirty).toBe(false);
  redoEdit();
  expect(current().markers.labels[1]).toBe('R_Thigh');
  expect(state().dirty).toBe(true);
});
it('validates names and records no action for cancellation-equivalent unchanged names', () => {
  for (const label of ['', '  ', '*33', 'bad\0label', 'x'.repeat(256)])
    expect(() => renameSessionMarker(0, label)).toThrow();
  renameSessionMarker(0, ' L_ASIS ');
  expect(state().history.past).toHaveLength(0);
  expect(() => renameSessionMarker(-1, 'A')).toThrow();
  renameSessionMarker(0, 'MixedCase');
  expect(current().markers.labels[0]).toBe('MixedCase');
});
it('renames analog channels with shared validation and stable signal/plot identity', () => {
  const original = current();
  useSession.setState({ plot: 'analog:0' });
  const names = original.analogs.map((a) => a.name);
  for (const label of ['', '  ', 'bad\0name', 'x'.repeat(256)])
    expect(() => renameSessionAnalog(0, label)).toThrow();
  expect(() => renameSessionAnalog(-1, 'A')).toThrow();
  if (names.length > 1) expect(() => renameSessionAnalog(0, names[1])).toThrow('already');
  renameSessionAnalog(0, ` ${names[0]} `);
  expect(state().history.past).toHaveLength(0);
  renameSessionAnalog(0, '  EMG_Right  ');
  expect(current().analogs[0].name).toBe('EMG_Right');
  expect(state().plot).toBe('analog:0');
  original.analogs.forEach((a, i) => {
    expect(current().analogs[i].signal).toBe(a.signal);
    expect(current().analogs[i].unit).toBe(a.unit);
  });
  expect(current().markers).toBe(original.markers);
  expect(current().forcePlatforms).toBe(original.forcePlatforms);
  const matches = filterDataSections(dataSections(current()), 'emg_right');
  expect(matches.find((s) => s.name === 'Analog channels')?.entries[0].analog).toBe(0);
  expect(
    dataSections(current())
      .find((s) => s.name === 'Analog channels')
      ?.entries.some((e) => e.name === names[0]),
  ).toBe(false);
  undoEdit();
  expect(current().analogs).toEqual(original.analogs);
  expect(state().dirty).toBe(false);
  redoEdit();
  expect(current().analogs[0].name).toBe('EMG_Right');
  expect(state().dirty).toBe(true);
});
it('shares history across marker, analog and event edits, with collection-local uniqueness', () => {
  const original = current();
  renameSessionAnalog(0, original.markers.labels[0]); // Names may coincide across collections.
  renameSessionMarker(0, 'Hip');
  editSessionEvent('add', -1, { label: 'Contact', time: 0, context: '' });
  undoEdit();
  undoEdit();
  expect(current().markers.labels).toEqual(original.markers.labels);
  expect(current().source.analogLabelsEdited).toBe(true);
  undoEdit();
  expect(state().dirty).toBe(false);
  redoEdit();
  renameSessionAnalog(0, 'New branch');
  expect(state().history.future).toHaveLength(0);
  selectCrop(0, 2);
  applyCrop();
  expect(current().analogs[0].name).toBe('New branch');
  expect(state().history.past).toHaveLength(0);
  renameSessionAnalog(0, 'After crop');
  undoEdit();
  expect(current().analogs[0].name).toBe('New branch');
  expect(state().dirty).toBe(true);
  restoreOriginal();
  expect(current()).toBe(original);
  renameSessionAnalog(0, 'Before load');
  setData(original);
  undoEdit();
  expect(current()).toBe(original);
  expect(state().history.future).toHaveLength(0);
});
it('supports multiple markers, sequential renames and branching without stale redo', () => {
  renameSessionMarker(0, 'A');
  renameSessionMarker(1, 'B');
  renameSessionMarker(0, 'C');
  undoEdit();
  expect(current().markers.labels).toEqual(['A', 'B']);
  undoEdit();
  expect(current().markers.labels).toEqual(['A', '*33']);
  redoEdit();
  expect(current().markers.labels).toEqual(['A', 'B']);
  renameSessionMarker(0, 'D');
  expect(state().history.future).toHaveLength(0);
  redoEdit();
  expect(current().markers.labels).toEqual(['D', 'B']);
  undoEdit();
  undoEdit();
  undoEdit();
  expect(state().dirty).toBe(false);
  expect(state().history.past).toHaveLength(0);
  undoEdit();
  expect(state().dirty).toBe(false);
});
it('bounds history without mistaking a dropped clean revision for clean data', () => {
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) renameSessionMarker(0, `Marker ${i}`);
  expect(state().history.past).toHaveLength(HISTORY_LIMIT);
  for (let i = 0; i < HISTORY_LIMIT; i++) undoEdit();
  expect(state().dirty).toBe(true);
  expect(current().markers.labels[0]).toBe('Marker 4');
});
it('clears history on new load and restoration; cancel preserves it; crop sets a dirty baseline', () => {
  const original = current();
  renameSessionMarker(0, 'A');
  cancelImport();
  expect(state().history.past).toHaveLength(1);
  selectCrop(0, 2);
  applyCrop();
  expect(state().history.past).toHaveLength(0);
  renameSessionMarker(1, 'B');
  undoEdit();
  expect(state().dirty).toBe(true);
  expect(current().markers.labels[0]).toBe('A');
  restoreOriginal();
  expect(current()).toBe(original);
  expect(state().dirty).toBe(false);
  expect(state().history.future).toHaveLength(0);
  renameSessionMarker(0, 'C');
  setData(original);
  undoEdit();
  expect(current()).toBe(original);
  expect(state().history.past).toHaveLength(0);
});
it('anchors preset links to source indices through rename, undo and crop without editing presets', () => {
  const data = current();
  data.markers.labels = ['L_ASIS', 'R_ASIS'];
  const presets = JSON.stringify(connectionSets);
  const pairs = resolveConnections(data.markers.labels, 'auto');
  renameSessionMarker(0, 'Hip');
  expect(resolveConnections(current().markers.connectionLabels!, 'auto')).toEqual(pairs);
  selectCrop(0, 2);
  applyCrop();
  expect(resolveConnections(current().markers.connectionLabels!, 'auto')).toEqual(pairs);
  expect(JSON.stringify(connectionSets)).toBe(presets);
});
it('undoes/redoes committed event CRUD with metadata and equal-time ordering intact', () => {
  const original = current();
  const fields = {
    label: 'Contact',
    time: 0.01,
    context: 'Left',
    description: 'Detail',
    subject: 'Synthetic',
  };
  editSessionEvent('add', -1, fields);
  const added = current().events;
  undoEdit();
  expect(current().events).toEqual(original.events);
  expect(state().dirty).toBe(false);
  redoEdit();
  expect(current().events).toEqual(added);
  const index = current().events.findIndex((e) => e.label === 'Contact');
  editSessionEvent('update', index, { ...fields, label: 'Edited', time: 0 });
  const edited = current().events;
  renameSessionMarker(0, 'Hip');
  undoEdit();
  undoEdit();
  expect(current().events).toEqual(added);
  redoEdit();
  expect(current().events).toEqual(edited);
  editSessionEvent('delete', 0);
  const deleted = current().events;
  undoEdit();
  expect(current().events).toEqual(edited);
  redoEdit();
  expect(current().events).toEqual(deleted);
  expect(current().markers.positions).toBe(original.markers.positions);
});
it('supports platform shortcuts, leaves native editing alone and blocks busy changes', () => {
  renameSessionMarker(0, 'A');
  const key = (key: string, extra = {}, editable = false) => {
    let prevented = false;
    const event = {
      key,
      ctrlKey: true,
      target: { closest: () => (editable ? {} : null) },
      preventDefault: () => {
        prevented = true;
      },
      ...extra,
    } as unknown as KeyboardEvent;
    handleHistoryShortcut(event);
    return prevented;
  };
  expect(key('z', {}, true)).toBe(false);
  expect(current().markers.labels[0]).toBe('A');
  expect(key('z')).toBe(true);
  expect(state().dirty).toBe(false);
  key('y');
  expect(state().dirty).toBe(true);
  key('z', { metaKey: true, ctrlKey: false });
  expect(state().dirty).toBe(false);
  key('Z', { metaKey: true, ctrlKey: false, shiftKey: true });
  expect(state().dirty).toBe(true);
  useSession.setState({ busy: true });
  expect(key('z')).toBe(false);
  renameSessionMarker(0, 'Blocked');
  expect(current().markers.labels[0]).toBe('A');
});

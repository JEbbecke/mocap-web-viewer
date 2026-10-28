import { create } from 'zustand';
import type { MotionData, Vec3 } from '../motion/types';
import type { ColumnSelection } from '../explorer/selection';
import { cropMotionData } from '../motion/crop';
import { croppedFilename } from '../exporters';
import { eventCommand, type EventFields } from '../motion/events';
import {
  emptyHistory,
  executeEdit,
  travelHistory,
  type EditCommand,
  type EditHistory,
} from '../motion/history';
import { renameMarkerCommand } from '../motion/markerLabels';
import { deleteMarkerCommand } from '../motion/markerDeletion';
import { markerIndex, markerSourceId, markerSourceIds } from '../motion/markerIdentity';
import { renameAnalogCommand } from '../motion/analogLabels';
import { renameDataCommand, type DataLabelTarget } from '../motion/dataLabels';
import { trackEvent } from '../analytics';
import { fileProperties, type FileProperties } from '../motion/fileMetadata';
import type { ExportFormat } from '../exporters/conversion';
import exampleFileUrl from '../../reference-data/example_data.h5?url&no-inline';
export type DisplayKey =
  | 'markers'
  | 'connections'
  | 'plates'
  | 'plateNumbers'
  | 'plateCoordinateSystems'
  | 'rigidBodyCoordinateSystems'
  | 'forces'
  | 'cop'
  | 'labels'
  | 'compactEventMarkers'
  | 'grid'
  | 'axes';
export type CameraPreset = 'perspective' | 'front' | 'side' | 'top';
interface Session {
  markerMenu: {
    marker: number;
    data: MotionData;
    x: number;
    y: number;
    sampleAvailable: boolean;
  } | null;
  markerRename: { marker: number; data: MotionData } | null;
  viewerReady: boolean;
  eventEditor: { index: number | 'new' } | null;
  history: EditHistory<MotionData>;
  dirty: boolean;
  data: MotionData | null;
  originalData: MotionData | null;
  sourceFile: File | null;
  cropSelection: { start: number; end: number } | null;
  operation: 'download' | 'import' | 'export';
  saved: boolean;
  busy: boolean;
  error: string | null;
  frame: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  selected: number;
  hidden: Set<number>;
  search: string;
  display: Record<DisplayKey, boolean>;
  forceScale: number; // display mm per N, never a scientific force conversion
  threshold: number;
  assumeGlobal: boolean;
  camera: { preset: CameraPreset; revision: number; point?: Vec3 };
  connectionSet: string;
  plot: string;
  explorerDataset: string;
  explorerColumns: ColumnSelection | null;
}
export const useSession = create<Session>(() => ({
  markerMenu: null,
  markerRename: null,
  viewerReady: false,
  eventEditor: null,
  history: emptyHistory(),
  dirty: false,
  data: null,
  originalData: null,
  sourceFile: null,
  cropSelection: null,
  operation: 'import',
  saved: false,
  busy: false,
  error: null,
  frame: 0,
  playing: false,
  speed: 1,
  loop: true,
  selected: 0,
  hidden: new Set(),
  search: '',
  display: {
    markers: true,
    connections: true,
    plates: true,
    plateNumbers: true,
    plateCoordinateSystems: true,
    rigidBodyCoordinateSystems: true,
    forces: true,
    cop: true,
    labels: false,
    compactEventMarkers: false,
    grid: true,
    axes: true,
  },
  forceScale: 1,
  threshold: 10,
  assumeGlobal: false,
  camera: { preset: 'perspective', revision: 0 },
  connectionSet: 'auto',
  plot: 'marker',
  explorerDataset: '',
  explorerColumns: null,
}));
export function selectPlot(plot: string) {
  useSession.setState({ plot });
}
export function togglePlot(plot: string) {
  selectPlot(useSession.getState().plot === plot ? 'none' : plot);
}
export function setFrame(frame: number) {
  const n = useSession.getState().data?.timeline.frameCount || 1;
  useSession.setState({ frame: Math.max(0, Math.min(n - 1, Math.round(frame))) });
}
export function togglePlay() {
  const s = useSession.getState();
  if (s.data)
    useSession.setState({
      playing: !s.playing,
      frame: !s.playing && s.frame === s.data.timeline.frameCount - 1 ? 0 : s.frame,
    });
}
export function setCamera(preset: CameraPreset) {
  useSession.setState((s) => ({ camera: { preset, revision: s.camera.revision + 1 } }));
}
export function setData(data: MotionData, sourceFile: File | null = null) {
  cancelImport();
  useSession.setState({
    markerMenu: null,
    markerRename: null,
    eventEditor: null,
    history: emptyHistory(),
    dirty: false,
    data,
    sourceFile,
    originalData: null,
    cropSelection: null,
    saved: false,
    busy: false,
    error: null,
    frame: 0,
    playing: false,
    selected: 0,
    hidden: new Set(),
    search: '',
    plot: 'marker',
    explorerDataset: '',
    explorerColumns: null,
    assumeGlobal: false,
    camera: { preset: 'perspective', revision: useSession.getState().camera.revision + 1 },
  });
}
export function toggleMarker(index: number) {
  useSession.setState((s) => {
    const hidden = new Set(s.hidden);
    if (hidden.has(index)) hidden.delete(index);
    else hidden.add(index);
    return { hidden };
  });
}
let active: Worker | undefined;
let exampleDownload: AbortController | undefined;
export function cancelImport() {
  exampleDownload?.abort();
  exampleDownload = undefined;
  active?.terminate();
  active = undefined;
  useSession.setState({ busy: false });
}
export async function openExampleFile() {
  if (useSession.getState().busy || useSession.getState().data) return;
  const controller = new AbortController();
  exampleDownload = controller;
  useSession.setState({ busy: true, operation: 'download', error: null, playing: false });
  try {
    const response = await fetch(exampleFileUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
    const blob = await response.blob();
    // A cancelled download must never replace a recording opened in the meantime.
    if (exampleDownload !== controller) return;
    exampleDownload = undefined;
    openFile(new File([blob], 'example_data.h5', { type: 'application/x-hdf5' }), 'bundled-demo');
  } catch (error) {
    if (controller.signal.aborted) return;
    exampleDownload = undefined;
    useSession.setState({
      busy: false,
      error: `Could not load the example file. ${error instanceof Error ? error.message : 'Please try again.'}`,
    });
  }
}
export function openFile(file: File, origin: FileProperties['origin'] = 'local') {
  cancelImport();
  if (!/\.(c3d|h5|hdf5)$/i.test(file.name)) {
    useSession.setState({ error: 'Choose a .c3d, .h5 or .hdf5 motion file.' });
    return;
  }
  useSession.setState({ busy: true, operation: 'import', error: null, playing: false });
  const worker = new Worker(new URL('../workers/import.worker.ts', import.meta.url), {
    type: 'module',
  });
  active = worker;
  const filesystem = fileProperties(file, origin);
  worker.onmessage = (event) => {
    if (active !== worker) return;
    worker.terminate();
    active = undefined;
    if (event.data.error) {
      useSession.setState({ busy: false, error: event.data.error });
    } else {
      const imported: MotionData = event.data.data;
      setData({ ...imported, source: { ...imported.source, filesystem } }, file);

      if (/\.c3d$/i.test(file.name)) {
        void trackEvent('c3d_loaded');
      } else if (/\.(h5|hdf5)$/i.test(file.name)) {
        void trackEvent('h5_loaded');
      }
    }
  };
  worker.onerror = (event) => {
    if (active !== worker) return;
    worker.terminate();
    active = undefined;
    useSession.setState({
      busy: false,
      error: `File reader failed: ${event.message || 'Please check the file format and available browser memory.'}`,
    });
  };
  worker.postMessage(file);
}

export function cancelCrop() {
  useSession.setState({ cropSelection: null, playing: false });
}
export function selectCrop(start: number, end: number) {
  const { data } = useSession.getState();
  if (
    data &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= data.timeline.frameCount
  ) {
    // Local half-open boundaries refer to the current working data, including after a crop.
    if (start === 0 && end === data.timeline.frameCount) cancelCrop();
    else useSession.setState({ cropSelection: { start, end }, playing: false });
  }
}
export function applyCrop() {
  const { data, cropSelection, originalData, busy } = useSession.getState();
  if (!data || !cropSelection || busy) return;
  try {
    const cropped = cropMotionData(data, cropSelection.start, cropSelection.end);
    useSession.setState({
      data: cropped,
      markerMenu: null,
      markerRename: null,
      eventEditor: null,
      history: emptyHistory(true),
      dirty: true,
      originalData: originalData ?? data,
      cropSelection: null,
      frame: 0,
      playing: false,
      error: null,
      saved: false,
    });
  } catch (error) {
    useSession.setState({ error: String(error) });
  }
}
export function restoreOriginal() {
  const { originalData, sourceFile, busy } = useSession.getState();
  if (busy) return;
  if (originalData) setData(originalData, sourceFile);
}
export function editSessionEvent(
  action: 'add' | 'update' | 'delete',
  index: number,
  fields?: EventFields,
) {
  const { data, busy } = useSession.getState();
  if (!data || busy) return;
  commitEdit(eventCommand(data, action, index, fields));
}
export function openSessionEvent(index: number | 'new') {
  const { data, busy } = useSession.getState();
  if (!data || busy || (index !== 'new' && !data.events[index])) return;
  useSession.setState({ eventEditor: { index }, playing: false });
  if (index !== 'new') setFrame(data.events[index].time * data.timeline.rate);
}
export function renameSessionData(target: DataLabelTarget, input: string) {
  const { data, busy } = useSession.getState();
  if (!data || busy) return;
  const command = renameDataCommand(data, target, input);
  if (command) commitEdit(command);
}
export function renameSessionMarker(marker: number, input: string) {
  const { data, busy } = useSession.getState();
  if (!data || busy) return;
  const command = renameMarkerCommand(data, marker, input);
  if (command) commitEdit(command);
}
interface DeletedMarkerView {
  id: number;
  selected: boolean;
  hidden: boolean;
  plot?: string;
  explorerDataset?: string;
  explorerColumns?: ColumnSelection | null;
}
type SessionEditCommand = EditCommand<MotionData> & { deletedMarkerView?: DeletedMarkerView };

/** Reconcile mutable UI positions by immutable identities in the same edit transaction. */
function markerViewChanges(
  before: MotionData,
  after: MotionData,
  s: Session,
  restore?: DeletedMarkerView,
): Partial<Session> {
  if (markerSourceIds(before).join(',') === markerSourceIds(after).join(',')) return {};
  const selectedId =
    s.selected < 0 || s.selected >= before.markers.labels.length
      ? -1
      : markerSourceId(before, s.selected);
  let selected = markerIndex(after, selectedId);
  const hidden = new Set(
    [...s.hidden].flatMap((index) => {
      if (index < 0 || index >= before.markers.labels.length) return [];
      const next = markerIndex(after, markerSourceId(before, index));
      return next < 0 ? [] : [next];
    }),
  );
  const exists = (reference: string) => {
    const match = /^marker:(\d+)$/.exec(reference);
    return !match || markerIndex(after, Number(match[1])) >= 0;
  };
  let plot = exists(s.plot) ? s.plot : 'none';
  let explorerDataset = exists(s.explorerDataset) ? s.explorerDataset : '';
  let explorerColumns =
    s.explorerColumns && exists(s.explorerColumns.datasetId) ? s.explorerColumns : null;
  if (restore) {
    const index = markerIndex(after, restore.id);
    if (index >= 0) {
      if (restore.selected && selected < 0) selected = index;
      if (restore.hidden) hidden.add(index);
      if (restore.plot && plot === 'none') plot = restore.plot;
      if (restore.explorerDataset && !explorerDataset) {
        explorerDataset = restore.explorerDataset;
        explorerColumns = restore.explorerColumns ?? null;
      }
    }
  }
  return { selected, hidden, plot, explorerDataset, explorerColumns };
}

export function deleteSessionMarker(marker: number) {
  const s = useSession.getState();
  if (!s.data || s.busy) return false;
  const command: SessionEditCommand = deleteMarkerCommand(s.data, marker);
  const id = markerSourceId(s.data, marker),
    reference = `marker:${id}`;
  command.deletedMarkerView = {
    id,
    selected: s.selected === marker,
    hidden: s.hidden.has(marker),
    plot: s.plot === reference ? s.plot : undefined,
    explorerDataset: s.explorerDataset === reference ? reference : undefined,
    explorerColumns: s.explorerColumns?.datasetId === reference ? s.explorerColumns : null,
  };
  commitEdit(command);
  return true;
}

export function commitEdit(command: SessionEditCommand) {
  const state = useSession.getState();
  const { data, originalData, busy, history } = state;
  if (!data || busy) return;
  const next = executeEdit(history, data, command);
  useSession.setState({
    ...markerViewChanges(data, next.value, state),
    data: next.value,
    markerMenu: null,
    markerRename: null,
    eventEditor: null,
    history: next.history,
    dirty: next.history.revision !== next.history.cleanRevision,
    originalData: originalData ?? data,
    saved: false,
    playing: false,
    error: null,
  });
}
export function renameSessionAnalog(channel: number, input: string) {
  const { data, busy } = useSession.getState();
  if (!data || busy) return;
  const command = renameAnalogCommand(data, channel, input);
  if (command) commitEdit(command);
}
export function undoEdit() {
  moveHistory('undo');
}
export function redoEdit() {
  moveHistory('redo');
}
function moveHistory(direction: 'undo' | 'redo') {
  const state = useSession.getState();
  const { data, history, busy } = state;
  if (!data || busy) return;
  const next = travelHistory(history, data, direction);
  if (next.history === history) return;
  useSession.setState({
    ...markerViewChanges(
      data,
      next.value,
      state,
      direction === 'undo'
        ? (history.past.at(-1)?.command as SessionEditCommand | undefined)?.deletedMarkerView
        : undefined,
    ),
    data: next.value,
    markerMenu: null,
    markerRename: null,
    eventEditor: null,
    history: next.history,
    dirty: next.history.revision !== next.history.cleanRevision,
    saved: false,
    playing: false,
    error: null,
  });
}
export function exportFile(target?: ExportFormat) {
  const { data, sourceFile, busy } = useSession.getState();
  if (!data || !sourceFile || busy) return;
  useSession.setState({
    busy: true,
    operation: 'export',
    error: null,
    playing: false,
    saved: false,
  });
  const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
    type: 'module',
  });
  active = worker;
  worker.onmessage = (event) => {
    if (active !== worker) return;
    worker.terminate();
    active = undefined;
    if (event.data.error) {
      useSession.setState({ busy: false, error: event.data.error });
      return;
    }
    const url = URL.createObjectURL(
      new Blob([event.data.buffer], { type: 'application/octet-stream' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download =
      target && target !== data.source.format
        ? sourceFile.name.replace(/\.(c3d|h5|hdf5)$/i, `.${target.toLowerCase()}`)
        : data.source.crop
          ? croppedFilename(sourceFile.name)
          : sourceFile.name.replace(
              /\.(c3d|h5|hdf5)$/i,
              data.source.eventsEdited ||
                data.source.markersEdited ||
                data.source.labelsEdited ||
                data.source.analogLabelsEdited ||
                Object.keys(data.source.dataLabels ?? {}).length
                ? '_edited.$1'
                : data.source.partialImport
                  ? '_exported.$1'
                  : '_copy.$1',
            );
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    useSession.setState({ busy: false, saved: true });
  };
  worker.onerror = () => {
    if (active !== worker) return;
    worker.terminate();
    active = undefined;
    useSession.setState({ busy: false, error: 'Export failed. Check available browser memory.' });
  };
  worker.postMessage({
    file: sourceFile,
    start: data.source.crop?.start ?? 0,
    end: data.source.crop?.end ?? data.timeline.frameCount,
    events: data.source.eventsEdited ? data.events : undefined,
    labels: data.source.labelsEdited || data.source.markersEdited ? data.markers.labels : undefined,
    markerIndices: data.source.markersEdited ? data.markers.sourceIndices : undefined,
    analogLabels: data.source.analogLabelsEdited ? data.analogs.map((a) => a.name) : undefined,
    dataLabels: data.source.dataLabels,
    target,
    ...(target && target !== data.source.format ? { data } : {}),
  });
}

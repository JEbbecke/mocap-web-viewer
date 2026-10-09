import { create } from 'zustand';
import type { MotionData } from '../motion/types';
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
import { renameAnalogCommand } from '../motion/analogLabels';
import { renameDataCommand, type DataLabelTarget } from '../motion/dataLabels';
import { trackEvent } from '../analytics';
import type { ExportFormat } from '../exporters/conversion';
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
  | 'grid'
  | 'axes';
export type CameraPreset = 'perspective' | 'front' | 'side' | 'top';
interface Session {
  eventEditor: { index: number | 'new' } | null;
  history: EditHistory<MotionData>;
  dirty: boolean;
  data: MotionData | null;
  originalData: MotionData | null;
  sourceFile: File | null;
  cropSelection: { start: number; end: number } | null;
  operation: 'import' | 'export';
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
  camera: { preset: CameraPreset; revision: number };
  connectionSet: string;
  plot: string;
  explorerDataset: string;
  explorerColumns: ColumnSelection | null;
}
export const useSession = create<Session>(() => ({
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
  });
  setCamera('perspective');
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
export function cancelImport() {
  active?.terminate();
  active = undefined;
  useSession.setState({ busy: false });
}
export function openFile(file: File) {
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
  worker.onmessage = (event) => {
    if (active !== worker) return;
    worker.terminate();
    active = undefined;
    if (event.data.error) {
      useSession.setState({ busy: false, error: event.data.error });
    } else {
      setData(event.data.data, file);

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

export function selectCrop(start: number, end: number) {
  const { data } = useSession.getState();
  if (
    data &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= data.timeline.frameCount
  )
    useSession.setState({ cropSelection: { start, end }, playing: false });
}
export function applyCrop() {
  const { data, cropSelection, originalData, busy } = useSession.getState();
  if (!data || !cropSelection || busy) return;
  try {
    const cropped = cropMotionData(data, cropSelection.start, cropSelection.end);
    useSession.setState({
      data: cropped,
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
export function commitEdit(command: EditCommand<MotionData>) {
  const { data, originalData, busy, history } = useSession.getState();
  if (!data || busy) return;
  const next = executeEdit(history, data, command);
  useSession.setState({
    data: next.value,
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
  const { data, history, busy } = useSession.getState();
  if (!data || busy) return;
  const next = travelHistory(history, data, direction);
  if (next.history === history) return;
  useSession.setState({
    data: next.value,
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
                data.source.labelsEdited ||
                data.source.analogLabelsEdited ||
                Object.keys(data.source.dataLabels ?? {}).length
                ? '_edited.$1'
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
    labels: data.source.labelsEdited ? data.markers.labels : undefined,
    analogLabels: data.source.analogLabelsEdited ? data.analogs.map((a) => a.name) : undefined,
    dataLabels: data.source.dataLabels,
    target,
    ...(target && target !== data.source.format ? { data } : {}),
  });
}

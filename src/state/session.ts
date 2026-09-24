import { create } from 'zustand';
import type { MotionData } from '../motion/types';
export type DisplayKey =
  'markers' | 'connections' | 'plates' | 'forces' | 'cop' | 'labels' | 'grid' | 'axes';
export type CameraPreset = 'perspective' | 'front' | 'side' | 'top';
interface Session {
  data: MotionData | null;
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
  forceScale: number;
  threshold: number;
  assumeGlobal: boolean;
  camera: { preset: CameraPreset; revision: number };
  connectionSet: string;
  plot: string;
}
export const useSession = create<Session>(() => ({
  data: null,
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
    forces: true,
    cop: true,
    labels: false,
    grid: true,
    axes: true,
  },
  forceScale: 0.001,
  threshold: 10,
  assumeGlobal: false,
  camera: { preset: 'perspective', revision: 0 },
  connectionSet: 'auto',
  plot: 'marker',
}));
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
export function setData(data: MotionData) {
  useSession.setState({
    data,
    busy: false,
    error: null,
    frame: 0,
    playing: false,
    selected: 0,
    hidden: new Set(),
    search: '',
    plot: 'marker',
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
  useSession.setState({ busy: true, error: null, playing: false });
  const worker = new Worker(new URL('../workers/import.worker.ts', import.meta.url), {
    type: 'module',
  });
  active = worker;
  worker.onmessage = (event) => {
    if (active !== worker) return;
    worker.terminate();
    active = undefined;
    if (event.data.error) useSession.setState({ busy: false, error: event.data.error });
    else setData(event.data.data);
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

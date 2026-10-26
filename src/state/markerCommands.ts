import { markerScenePosition } from '../viewer/markerPosition';
import { deleteSessionMarker, renameSessionMarker, setCamera, useSession } from './session';
import { markerDeletionIssue } from '../motion/markerDeletion';
import type { Vec3 } from '../motion/types';

export function selectedMarkerActions() {
  const s = useSession.getState();
  const available =
    !!s.data &&
    !s.busy &&
    Number.isInteger(s.selected) &&
    s.selected >= 0 &&
    s.selected < s.data.markers.labels.length;
  return {
    rename: available,
    focus: available && s.viewerReady && !!markerScenePosition(s.data!, s.frame, s.selected),
    delete: available && !markerDeletionIssue(s.data!, s.selected),
    deleteReason: available
      ? markerDeletionIssue(s.data!, s.selected)
      : 'Select an existing marker.',
  };
}

export function selectMarker(marker: number) {
  const s = useSession.getState();
  if (!s.data || !Number.isInteger(marker) || marker < 0 || marker >= s.data.markers.labels.length)
    return false;
  useSession.setState({ selected: marker, plot: 'marker', markerMenu: null, markerRename: null });
  return true;
}

export function focusSelectedMarker() {
  if (!selectedMarkerActions().focus) return false;
  const s = useSession.getState();
  const point = markerScenePosition(s.data!, s.frame, s.selected)!.toArray() as Vec3;
  useSession.setState({
    camera: { ...s.camera, point, revision: s.camera.revision + 1 },
    markerMenu: null,
  });
  return true;
}

export function fitScene() {
  const s = useSession.getState();
  if (!s.data || s.busy || !s.viewerReady) return false;
  setCamera('perspective');
  useSession.setState({ markerMenu: null });
  return true;
}

export function renameSelectedMarker() {
  if (!selectedMarkerActions().rename) return false;
  const s = useSession.getState();
  useSession.setState({
    markerRename: { marker: s.selected, data: s.data! },
    markerMenu: null,
    playing: false,
  });
  return true;
}

export function saveSelectedMarkerName(name: string) {
  const s = useSession.getState();
  if (
    !s.markerRename ||
    s.markerRename.marker !== s.selected ||
    s.markerRename.data !== s.data ||
    !selectedMarkerActions().rename
  )
    return false;
  renameSessionMarker(s.selected, name);
  return true;
}

export function deleteSelectedMarker() {
  if (!selectedMarkerActions().delete) return false;
  return deleteSessionMarker(useSession.getState().selected);
}

export function openSelectedMarkerMenu(x: number, y: number) {
  const s = useSession.getState();
  if (!selectedMarkerActions().rename || !s.viewerReady || ![x, y].every(Number.isFinite))
    return false;
  useSession.setState({
    markerMenu: {
      marker: s.selected,
      data: s.data!,
      x,
      y,
      sampleAvailable: !!markerScenePosition(s.data!, s.frame, s.selected),
    },
    markerRename: null,
  });
  return true;
}

export function closeMarkerInteractions() {
  useSession.setState({ markerMenu: null, markerRename: null });
}

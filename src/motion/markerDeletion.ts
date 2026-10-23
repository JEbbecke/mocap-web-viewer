import type { MotionData } from './types';
import type { EditCommand } from './history';
import { markerIndex, markerSourceId, markerSourceIds } from './markerIdentity';

type Values = Float32Array | Float64Array | Uint8Array | Int8Array;
const allocate = <T extends Values>(source: T, size: number): T =>
  new (source.constructor as { new (size: number): T })(size);

/** Copy contiguous sample blocks; preserve array precision and all other samples. */
function column<T extends Values>(
  source: T,
  count: number,
  frames: number,
  width: number,
  index: number,
): T {
  const result = allocate(source, frames * width);
  for (let frame = 0; frame < frames; frame++) {
    const at = (frame * count + index) * width;
    result.set(source.subarray(at, at + width), frame * width);
  }
  return result;
}
function remove<T extends Values>(
  source: T,
  count: number,
  frames: number,
  width: number,
  index: number,
): T {
  const result = allocate(source, frames * (count - 1) * width);
  for (let frame = 0; frame < frames; frame++) {
    const at = frame * count * width,
      out = frame * (count - 1) * width;
    result.set(source.subarray(at, at + index * width), out);
    result.set(source.subarray(at + (index + 1) * width, at + count * width), out + index * width);
  }
  return result;
}
function insert<T extends Values>(
  source: T,
  removed: T,
  count: number,
  frames: number,
  width: number,
  index: number,
): T {
  const result = allocate(source, frames * (count + 1) * width);
  for (let frame = 0; frame < frames; frame++) {
    const at = frame * count * width,
      out = frame * (count + 1) * width;
    result.set(source.subarray(at, at + index * width), out);
    result.set(removed.subarray(frame * width, (frame + 1) * width), out + index * width);
    result.set(source.subarray(at + index * width, at + count * width), out + (index + 1) * width);
  }
  return result;
}

export function markerDeletionIssue(data: MotionData, index: number): string | undefined {
  const count = data.markers.labels.length,
    frames = data.timeline.frameCount,
    q = data.markers.quality;
  if (!Number.isInteger(index) || index < 0 || index >= count) return 'Select an existing marker.';
  if (count <= 1)
    return 'Keep at least one marker: the recording and export formats require a marker trajectory.';
  if (data.source.markerDeletionIssue) return data.source.markerDeletionIssue;
  const ids = markerSourceIds(data);
  if (
    ids.length !== count ||
    new Set(ids).size !== count ||
    ids.some((id, i) => !Number.isSafeInteger(id) || id < 0 || (i > 0 && id <= ids[i - 1]))
  )
    return 'Marker source identities are inconsistent.';
  const lengths = [
    [data.markers.positions, frames * count * 3],
    [data.markers.valid, frames * count],
    [data.markers.residuals, frames * count],
    [q?.type, frames * count],
    [q?.cameraMasks, frames * count * (q?.cameraCount ?? 0)],
    [q?.virtual, count],
    [q?.cameraMasksKnown, count],
  ] as const;
  if (lengths.some(([array, length]) => array && array.length !== length))
    return 'Marker sample or quality dimensions are inconsistent.';
}

/** A single history action retains only the removed trajectory/quality and references. */
export function deleteMarkerCommand(data: MotionData, index: number): EditCommand<MotionData> {
  const issue = markerDeletionIssue(data, index);
  if (issue) throw new Error(issue);
  const id = markerSourceId(data, index),
    frames = data.timeline.frameCount;
  const label = data.markers.labels[index],
    count = data.markers.labels.length;
  const originalIds = data.markers.sourceIndices;
  const connection = data.markers.connectionLabels?.[index];
  const hadConnections = !!data.markers.connectionLabels;
  const editedBefore = data.source.markersEdited;
  const q = data.markers.quality;
  const removed = {
    positions: column(data.markers.positions, count, frames, 3, index),
    valid: column(data.markers.valid, count, frames, 1, index),
    residuals: data.markers.residuals && column(data.markers.residuals, count, frames, 1, index),
    type: q?.type && column(q.type, count, frames, 1, index),
    masks: q?.cameraMasks && column(q.cameraMasks, count, frames, q.cameraCount, index),
    virtual: q?.virtual?.slice(index, index + 1),
    known: q?.cameraMasksKnown?.slice(index, index + 1),
  };
  const memberships = data.rigidBodies?.map((body) =>
    body.markers.flatMap((name, at) => (name === label ? [{ at, name }] : [])),
  );
  const change = (current: MotionData, undo: boolean): MotionData => {
    const ids = markerSourceIds(current),
      found = markerIndex(current, id);
    if (current.timeline.frameCount !== frames || (undo ? found !== -1 : found === -1))
      throw new Error('Marker history no longer matches this recording.');
    const at = undo ? index : found,
      n = current.markers.labels.length;
    const transform = <T extends Values>(array: T, saved: T, width = 1, frameCount = frames) =>
      undo
        ? insert(array, saved, n, frameCount, width, at)
        : remove(array, n, frameCount, width, at);
    const labels = [...current.markers.labels];
    const sourceIndices = [...ids];
    if (undo) {
      labels.splice(at, 0, label);
      sourceIndices.splice(at, 0, id);
    } else {
      labels.splice(at, 1);
      sourceIndices.splice(at, 1);
    }
    const markers: MotionData['markers'] = {
      ...current.markers,
      labels,
      sourceIndices,
      positions: transform(current.markers.positions, removed.positions, 3),
      valid: transform(current.markers.valid, removed.valid),
      ...(removed.residuals
        ? { residuals: transform(current.markers.residuals!, removed.residuals) }
        : {}),
    };
    if (undo && !originalIds) delete markers.sourceIndices;
    if (current.markers.connectionLabels) {
      markers.connectionLabels = [...current.markers.connectionLabels];
      if (undo) markers.connectionLabels.splice(at, 0, connection!);
      else markers.connectionLabels.splice(at, 1);
    }
    if (undo && !hadConnections) delete markers.connectionLabels;
    if (current.markers.quality) {
      const quality = { ...current.markers.quality };
      if (removed.type) quality.type = transform(quality.type!, removed.type);
      if (removed.masks)
        quality.cameraMasks = transform(quality.cameraMasks!, removed.masks, quality.cameraCount);
      if (removed.virtual) quality.virtual = transform(quality.virtual!, removed.virtual, 1, 1);
      if (removed.known)
        quality.cameraMasksKnown = transform(quality.cameraMasksKnown!, removed.known, 1, 1);
      markers.quality = quality;
    }
    return {
      ...current,
      markers,
      source: { ...current.source, markersEdited: undo ? editedBefore : true },
      ...(memberships
        ? {
            rigidBodies: current.rigidBodies?.map((body, bodyIndex) => {
              if (!memberships[bodyIndex].length) return body;
              const members = [...body.markers];
              if (undo)
                for (const member of memberships[bodyIndex])
                  members.splice(member.at, 0, member.name);
              else
                for (const member of [...memberships[bodyIndex]].reverse())
                  members.splice(member.at, 1);
              return { ...body, markers: members };
            }),
          }
        : {}),
    };
  };
  return {
    description: `Delete marker ${label}`,
    apply: (current) => change(current, false),
    revert: (current) => change(current, true),
  };
}

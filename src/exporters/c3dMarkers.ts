import { parseC3D } from '../importers/c3d/importer';
import { labels, number, readParameters } from '../importers/c3d/parameters';
import {
  c3dMarkerDeletionIssue,
  POINT_REFERENCE_LISTS,
  POINT_SCALARS,
  pointTextBase,
} from '../importers/c3d/markerMetadata';
import { validateMarkerSubset } from '../motion/markerIdentity';
import { editC3DParameters } from './c3dParameters';
import { writeC3DLabels, writeC3DText } from './c3dLabels';

/** Remove raw point records, never normalize/requantize surviving points or analogs. */
export function writeC3DMarkerSelection(
  source: ArrayBuffer,
  indices: number[],
  editedLabels?: string[],
): ArrayBuffer {
  const motion = parseC3D(source, 'source.c3d');
  const count = motion.markers.labels.length;
  validateMarkerSubset(indices, count);
  if (editedLabels && editedLabels.length !== indices.length)
    throw new Error('C3D labels must match retained source columns.');
  if (indices.length === count)
    return editedLabels ? writeC3DLabels(source, editedLabels) : source.slice(0);
  const input = new DataView(source),
    { params, little } = readParameters(input);
  const issue = c3dMarkerDeletionIssue(params, count);
  if (issue) throw new Error(issue);
  const width = number(params, 'POINT:SCALE', input.getFloat32(12, little)) < 0 ? 4 : 2;
  const frames = motion.timeline.frameCount;
  const analogBytes =
    (width * motion.analogs.length * (motion.analogs[0]?.signal.rate ?? 0)) / motion.timeline.rate;
  const oldStride = count * 4 * width + analogBytes;
  const dataStart = (number(params, 'POINT:DATA_START', input.getUint16(16, little)) - 1) * 512;
  const sampleEnd = dataStart + frames * oldStride;
  if (new Uint8Array(source, sampleEnd).some((value) => value !== 0))
    throw new Error(
      'C3D contains undocumented trailing records; marker deletion export stopped to avoid data loss.',
    );

  const editor = editC3DParameters(source, 'POINT');
  const usedKind = params.get('POINT:USED')?.storage?.kind ?? 2;
  const used = new Uint8Array(usedKind);
  const usedView = new DataView(used.buffer);
  if (usedKind === 4) usedView.setFloat32(0, indices.length, little);
  else if (usedKind === 2) usedView.setUint16(0, indices.length, little);
  else if (usedKind === 1) usedView.setUint8(0, indices.length);
  else throw new Error('Unsupported POINT:USED storage.');
  editor.parameter('USED', usedKind, [], used);
  for (const [key, p] of params) {
    if (!key.startsWith('POINT:')) continue;
    const name = key.slice(6),
      storage = p.storage!;
    if (POINT_SCALARS.has(name) || POINT_REFERENCE_LISTS.has(name) || pointTextBase(name)) continue;
    if (p.dimensions.at(-1) === count && (storage.kind !== -1 || p.dimensions.length > 1)) {
      const stride = storage.bytes / count;
      const raw = new Uint8Array(stride * indices.length);
      indices.forEach((index, i) =>
        raw.set(new Uint8Array(source, storage.offset + index * stride, stride), i * stride),
      );
      editor.parameter(name, storage.kind, [...p.dimensions.slice(0, -1), indices.length], raw);
    }
  }
  let metadata = editor.finish();
  const storedNames = labels(params, 'POINT:LABELS');
  const rawNames = Array.from(
    { length: count },
    (_, i) => storedNames[i] || motion.markers.labels[i],
  );
  const removedNames = new Set(rawNames.filter((_, index) => !indices.includes(index)));
  const keptLabels = editedLabels ?? indices.map((index) => motion.markers.labels[index]);
  metadata = writeC3DLabels(metadata, keptLabels);
  const renamed = new Map(indices.map((index, i) => [rawNames[index], keptLabels[i]]));
  if ([...params.keys()].some((key) => key.startsWith('POINT:DESCRIPTIONS'))) {
    const descriptions = labels(params, 'POINT:DESCRIPTIONS');
    metadata = writeC3DText(
      metadata,
      indices.map((index) => descriptions[index] ?? ''),
      'POINT',
      'DESCRIPTIONS',
    );
  }
  for (const name of POINT_REFERENCE_LISTS)
    if (params.has(`POINT:${name}`))
      metadata = writeC3DText(
        metadata,
        (params.get(`POINT:${name}`)!.values as string[])
          .filter((value) => !removedNames.has(value))
          .map((value) => renamed.get(value) ?? value),
        'POINT',
        name,
      );

  const relocated = new DataView(metadata);
  const nextStart =
    (number(readParameters(relocated).params, 'POINT:DATA_START', relocated.getUint16(16, little)) -
      1) *
    512;
  const stride = indices.length * 4 * width + analogBytes;
  const output = new Uint8Array(Math.ceil((nextStart + frames * stride) / 512) * 512);
  output.set(new Uint8Array(metadata, 0, nextStart));
  for (let frame = 0; frame < frames; frame++) {
    const from = nextStart + frame * oldStride,
      to = nextStart + frame * stride;
    indices.forEach((index, marker) =>
      output.set(
        new Uint8Array(metadata, from + index * 4 * width, 4 * width),
        to + marker * 4 * width,
      ),
    );
    output.set(
      new Uint8Array(metadata, from + count * 4 * width, analogBytes),
      to + indices.length * 4 * width,
    );
  }
  new DataView(output.buffer).setUint16(2, indices.length, little);
  return output.buffer;
}

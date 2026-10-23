import { labels as parameterLabels, number, readParameters } from '../importers/c3d/parameters';
import { POINT_REFERENCE_LISTS } from '../importers/c3d/markerMetadata';
import { editC3DParameters } from './c3dParameters';

/** POINT/ANALOG:LABELS, LABELS2, ... are consecutive source columns. */
export function writeC3DLabels(
  source: ArrayBuffer,
  labels: string[],
  group: 'POINT' | 'ANALOG' | 'FORCE_PLATFORM' = 'POINT',
) {
  const view = new DataView(source);
  const { params, little } = readParameters(view);
  let count = number(params, `${group}:USED`, group === 'POINT' ? view.getUint16(2, little) : 0);
  if (group === 'POINT' && params.get('POINT:USED')?.storage?.kind === 2) count &= 65535;
  if (labels.length !== count)
    throw new Error(`C3D ${group} label count does not match source columns.`);
  if (labels.some((label) => !label.length)) throw new Error('C3D labels require nonempty text.');
  let output = writeC3DText(source, labels, group, 'LABELS');
  const previous = parameterLabels(params, 'POINT:LABELS');
  if (group === 'POINT' && previous.length === count) {
    for (const name of POINT_REFERENCE_LISTS) {
      const parameter = params.get(`POINT:${name}`);
      if (parameter?.storage?.kind !== -1) continue;
      const values = (parameter.values as string[]).map((value) => {
        const index = previous.indexOf(value);
        return index >= 0 && previous.lastIndexOf(value) === index ? labels[index] : value;
      });
      if (values.some((value, i) => value !== parameter.values[i]))
        output = writeC3DText(output, values, 'POINT', name);
    }
  }
  return output;
}

/** Segmented text metadata shares C3D's string and record-size limits. */
export function writeC3DText(source: ArrayBuffer, labels: string[], group: string, base: string) {
  const { params } = readParameters(new DataView(source));
  const encoded = labels.map((label) => new TextEncoder().encode(label));
  if (encoded.some((label) => label.length > 255 || label.includes(0)))
    throw new Error('C3D labels require 1–255 UTF-8 bytes without null characters.');
  const editor = editC3DParameters(source, group);
  const written = new Set<string>();
  let offset = 0,
    segment = 1;
  while (offset < labels.length) {
    // Signed 16-bit record offsets also limit capacity; allow maximum descriptions.
    let count = 0,
      width = 1;
    while (offset + count < labels.length && count < 255) {
      const nextWidth = Math.max(width, encoded[offset + count].length);
      if (nextWidth * (count + 1) > 32000) break;
      width = nextWidth;
      count++;
    }
    const name = segment === 1 ? base : `${base}${segment}`;
    const raw = new Uint8Array(width * count).fill(32);
    for (let i = 0; i < count; i++) raw.set(encoded[offset + i], i * width);
    editor.parameter(name, -1, [width, count], raw);
    written.add(name);
    offset += count;
    segment++;
  }
  for (const key of params.keys()) {
    const name = key.slice(group.length + 1);
    if (
      key.startsWith(`${group}:`) &&
      new RegExp(`^${base}(?:\\d+)?$`).test(name) &&
      !written.has(name)
    )
      editor.remove(name);
  }
  if (!labels.length) editor.parameter(base, -1, [1, 0], new Uint8Array());
  return editor.finish();
}

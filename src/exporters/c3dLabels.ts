import { number, readParameters } from '../importers/c3d/parameters';
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
  const encoded = labels.map((label) => new TextEncoder().encode(label));
  if (encoded.some((label) => !label.length || label.length > 255 || label.includes(0)))
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
    const name = segment === 1 ? 'LABELS' : `LABELS${segment}`;
    const raw = new Uint8Array(width * count).fill(32);
    for (let i = 0; i < count; i++) raw.set(encoded[offset + i], i * width);
    editor.parameter(name, -1, [width, count], raw);
    written.add(name);
    offset += count;
    segment++;
  }
  for (const key of params.keys()) {
    const name = key.slice(group.length + 1);
    if (key.startsWith(`${group}:`) && /^LABELS(?:\d+)?$/.test(name) && !written.has(name))
      editor.remove(name);
  }
  return editor.finish();
}

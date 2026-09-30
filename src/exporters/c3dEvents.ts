import { editC3DParameters } from './c3dParameters';
import { number, readParameters } from '../importers/c3d/parameters';
import type { MotionEvent } from '../motion/types';

/** Rebuild only owned EVENT records; copy other records (including descriptions/locks) verbatim. */
export function writeC3DEvents(source: ArrayBuffer, events: MotionEvent[], origin: number) {
  const input = new DataView(source);
  const { params, little } = readParameters(input);
  const used = number(params, 'EVENT:USED', 0);
  if (used > 255 || events.length > 255 || [...params.keys()].some((k) => /^EVENT:.*\d+$/.test(k)))
    throw new Error('Segmented C3D events are unsupported for editing.');
  const encoder = new TextEncoder();
  const { parameter, finish, replacements } = editC3DParameters(source, 'EVENT');
  const count = events.length;
  const countBytes = new Uint8Array(2);
  new DataView(countBytes.buffer).setInt16(0, count, little);
  parameter('USED', 2, [], countBytes);
  const times = new Uint8Array(count * 8),
    tv = new DataView(times.buffer);
  events.forEach((e, i) => {
    const absolute = e.time + origin;
    if (!Number.isFinite(absolute)) throw new Error('Invalid event time.');
    const minutes = Math.floor(absolute / 60);
    tv.setFloat32(i * 8, minutes, little);
    tv.setFloat32(i * 8 + 4, absolute - minutes * 60, little);
  });
  parameter('TIMES', 4, [2, count], times);
  for (const [name, field] of [
    ['LABELS', 'label'],
    ['CONTEXTS', 'context'],
    ['DESCRIPTIONS', 'description'],
    ['SUBJECTS', 'subject'],
  ] as const) {
    const strings = events.map((e) => encoder.encode(e[field] ?? ''));
    const width = Math.max(1, ...strings.map((s) => s.length));
    if (width > 255) throw new Error('C3D event text exceeds 255 bytes.');
    const raw = new Uint8Array(width * count).fill(32);
    strings.forEach((s, i) => raw.set(s, i * width));
    parameter(name, -1, [width, count], raw);
  }
  // Preserve opaque row metadata by original row identity, including icons and flags.
  for (const [key, p] of params) {
    if (!key.startsWith('EVENT:') || replacements.has(key.slice(6))) continue;
    if (!used || !p.dimensions.length || p.dimensions.at(-1)! < used) continue;
    const s = p.storage!,
      capacity = p.dimensions.at(-1)!;
    const stride = s.bytes / capacity;
    const raw = new Uint8Array(stride * count).fill(s.kind === -1 ? 32 : 0);
    events.forEach((e, i) => {
      if (e.sourceIndex !== undefined && e.sourceIndex >= 0 && e.sourceIndex < used)
        raw.set(new Uint8Array(source, s.offset + e.sourceIndex * stride, stride), i * stride);
      else if (!['EVENT:ICON_IDS', 'EVENT:GENERIC_FLAGS'].includes(key))
        throw new Error(`Cannot invent metadata for a new event: ${key}.`);
    });
    parameter(key.slice(6), s.kind, [...p.dimensions.slice(0, -1), count], raw);
  }
  const result = new Uint8Array(finish());
  const out = new DataView(result.buffer);
  // Edited events use the full-label parameter representation; clear stale header duplicates.
  out.setUint16(300, 0, little);
  result.fill(0, 304, 394);
  result.fill(32, 396, 468);
  return result.buffer;
}

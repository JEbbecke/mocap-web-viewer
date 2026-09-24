export interface Parameter {
  dimensions: number[];
  values: number[] | string[];
  storage?: { kind: number; offset: number; bytes: number };
}
export type Parameters = Map<string, Parameter>;
export function readParameters(view: DataView): {
  params: Parameters;
  little: boolean;
  start: number;
} {
  if (view.byteLength < 512 || view.getUint8(1) !== 80) throw new Error('Invalid C3D header.');
  const start = (view.getUint8(0) - 1) * 512;
  if (start < 512 || start + 4 > view.byteLength) throw new Error('Invalid C3D parameter block.');
  const processor = view.getUint8(start + 3);
  if (processor === 85)
    throw new Error('DEC/VAX C3D floating point is not supported. Re-export as Intel C3D.');
  if (processor !== 84 && processor !== 86)
    throw new Error(`Unsupported C3D processor ${processor}.`);
  const little = processor === 84,
    groups = new Map<number, string>();
  const records: { group: number; name: string; parameter: Parameter }[] = [];
  const limit = Math.min(view.byteLength, start + view.getUint8(start + 2) * 512);
  const text = (at: number, n: number) =>
    new TextDecoder('utf-8')
      .decode(new Uint8Array(view.buffer, view.byteOffset + at, n))
      .replace(/\0/g, '')
      .trim();
  let pos = start + 4;
  while (pos + 2 <= limit) {
    const length = Math.abs(view.getInt8(pos++)),
      id = view.getInt8(pos++);
    if (!length || !id) break;
    if (pos + length + 2 > limit) throw new Error('Truncated C3D parameter name.');
    const name = text(pos, length).toUpperCase();
    pos += length;
    const offsetAt = pos,
      jump = view.getInt16(pos, little);
    pos += 2;
    const end = jump === 0 ? limit : offsetAt + jump;
    if (end < pos || end > limit) throw new Error('Corrupt C3D parameter offset.');
    if (id < 0) groups.set(-id, name);
    else {
      if (pos + 2 > end) throw new Error('Truncated C3D parameter.');
      const kind = view.getInt8(pos++),
        ndims = view.getUint8(pos++);
      if (pos + ndims > end || ![-1, 1, 2, 4].includes(kind))
        throw new Error('Unsupported or corrupt C3D parameter type.');
      const dimensions = Array.from({ length: ndims }, () => view.getUint8(pos++));
      const count = dimensions.reduce((a, b) => a * b, 1),
        bytes = count * Math.abs(kind);
      if (pos + bytes > end) throw new Error('Truncated C3D parameter data.');
      let values: number[] | string[];
      if (kind === -1) {
        const width = dimensions[0] || 1;
        values = Array.from({ length: count / width }, (_, i) => text(pos + i * width, width));
      } else
        values = Array.from({ length: count }, (_, i) =>
          kind === 1
            ? view.getInt8(pos + i)
            : kind === 2
              ? view.getInt16(pos + 2 * i, little)
              : view.getFloat32(pos + 4 * i, little),
        );
      records.push({
        group: id,
        name,
        parameter: {
          dimensions,
          values,
          storage: { kind, offset: pos, bytes },
        },
      });
    }
    if (jump === 0) break;
    pos = end;
  }
  const params: Parameters = new Map();
  for (const r of records)
    if (groups.has(r.group)) params.set(`${groups.get(r.group)}:${r.name}`, r.parameter);
  return { params, little, start };
}
export const nums = (p: Parameters, key: string): number[] =>
  (p.get(key)?.values as number[]) || [];
export const strings = (p: Parameters, key: string): string[] =>
  (p.get(key)?.values as string[]) || [];
export const number = (p: Parameters, key: string, fallback: number): number =>
  nums(p, key)[0] ?? fallback;
export function labels(p: Parameters, key: string): string[] {
  const result = [...strings(p, key)];
  for (let i = 2; p.has(`${key}${i}`); i++) result.push(...strings(p, `${key}${i}`));
  return result;
}

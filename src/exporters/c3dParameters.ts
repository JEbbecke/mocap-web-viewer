import { number, readParameters } from '../importers/c3d/parameters';

/** Rebuild selected parameters; retain unrelated raw records and scientific bytes. */
export function editC3DParameters(source: ArrayBuffer, groupName: string) {
  const input = new DataView(source);
  const { params, little, start } = readParameters(input);
  const encoder = new TextEncoder();
  const records: { id: number; name: string; bytes: Uint8Array }[] = [];
  let pos = start + 4;
  const limit = start + input.getUint8(start + 2) * 512;
  while (pos + 2 <= limit) {
    const n = Math.abs(input.getInt8(pos)),
      id = input.getInt8(pos + 1);
    if (!n || !id) break;
    const jumpAt = pos + 2 + n;
    const jump = input.getInt16(jumpAt, little);
    const end = jump ? jumpAt + jump : limit;
    const name = new TextDecoder().decode(new Uint8Array(source, pos + 2, n)).toUpperCase();
    records.push({ id, name, bytes: new Uint8Array(source.slice(pos, end)) });
    pos = end;
    if (!jump) break;
  }
  let group = -(records.find((r) => r.id < 0 && r.name === groupName)?.id ?? 0);
  const make = (id: number, name: string, payload: Uint8Array) => {
    const bytes = new Uint8Array(name.length + 4 + payload.length);
    const view = new DataView(bytes.buffer);
    bytes[0] = name.length;
    view.setInt8(1, id);
    bytes.set(encoder.encode(name), 2);
    if (payload.length + 2 > 32767) throw new Error('C3D parameter exceeds record capacity.');
    view.setInt16(name.length + 2, payload.length + 2, little);
    bytes.set(payload, name.length + 4);
    return { id, name, bytes };
  };
  if (!group) {
    group =
      Array.from({ length: 127 }, (_, i) => i + 1).find(
        (id) => !records.some((r) => Math.abs(r.id) === id),
      ) ?? 0;
    if (!group) throw new Error('No free C3D parameter group ID.');
    records.push(make(-group, groupName, new Uint8Array([0])));
  }
  const replacements = new Map<string, Uint8Array>();
  const parameter = (name: string, kind: number, dims: number[], raw: Uint8Array) => {
    const previous = params.get(`${groupName}:${name}`)?.storage;
    const descriptionAt = previous ? previous.offset + previous.bytes : 0;
    const description = previous
      ? new Uint8Array(source, descriptionAt, 1 + input.getUint8(descriptionAt))
      : new Uint8Array([0]);
    const payload = new Uint8Array(2 + dims.length + raw.length + description.length);
    payload[0] = kind & 255;
    payload[1] = dims.length;
    payload.set(dims, 2);
    payload.set(raw, 2 + dims.length);
    payload.set(description, 2 + dims.length + raw.length);
    const record = make(group, name, payload).bytes;
    const oldRecord = records.find((r) => r.id === group && r.name === name);
    if (oldRecord) record[0] = oldRecord.bytes[0];
    replacements.set(name, record);
  };
  const finish = () => {
    const outputRecords = records.map((r) => {
      const replacement = r.id === group ? replacements.get(r.name) : undefined;
      if (replacement) {
        replacements.delete(r.name);
        return replacement;
      }
      return r.bytes;
    });
    outputRecords.push(...replacements.values());
    const size = 4 + outputRecords.reduce((n, r) => n + r.length, 0) + 2;
    const blocks = Math.ceil(size / 512);
    if (blocks > 255) throw new Error('C3D parameter section exceeds 255 blocks.');
    const oldData = (number(params, 'POINT:DATA_START', input.getUint16(16, little)) - 1) * 512;
    const newData = Math.max(oldData, start + blocks * 512);
    const result = new Uint8Array(newData + source.byteLength - oldData);
    result.set(new Uint8Array(source, 0, start));
    result.set(new Uint8Array(source, start, 4), start);
    result[start + 2] = blocks;
    pos = start + 4;
    for (const record of outputRecords) {
      result.set(record, pos);
      // Explicitly terminate each record; the final zero record ends the section.
      const nameLength = Math.abs(new DataView(record.buffer, record.byteOffset).getInt8(0));
      const jump = record.length - 2 - nameLength;
      if (jump > 32767) throw new Error('C3D parameter record exceeds capacity.');
      new DataView(result.buffer).setInt16(pos + 2 + nameLength, jump, little);
      pos += record.length;
    }
    result.set(new Uint8Array(source, oldData), newData);
    const out = new DataView(result.buffer);
    out.setUint16(16, newData / 512 + 1, little);
    const relocated = readParameters(out).params.get('POINT:DATA_START');
    if (relocated) {
      const s = relocated.storage!;
      if (s.kind === 2) out.setUint16(s.offset, newData / 512 + 1, little);
      else if (s.kind === 4) out.setFloat32(s.offset, newData / 512 + 1, little);
      else throw new Error('Unsupported POINT:DATA_START type.');
    }
    return result.buffer;
  };
  const remove = (name: string) => {
    const index = records.findIndex((r) => r.id === group && r.name === name);
    if (index >= 0) records.splice(index, 1);
  };
  return { parameter, finish, remove, replacements };
}

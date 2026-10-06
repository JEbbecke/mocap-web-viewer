import type * as H5 from 'h5wasm';

type Library = typeof H5;
const undefinedAddress = 0xffffffffffffffffn;
const text = (value: string) => new TextEncoder().encode(value);
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const integer = (value: number | bigint, size: 2 | 4 | 8) => {
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  if (size === 8) view.setBigUint64(0, BigInt(value), true);
  else if (size === 4) view.setUint32(0, Number(value), true);
  else view.setUint16(0, Number(value), true);
  return bytes;
};
const padded = (bytes: Uint8Array) => join(bytes, new Uint8Array((8 - (bytes.length % 8)) % 8));
const message = (type: number, data: Uint8Array) => {
  const body = padded(data);
  if (body.length > 65535) throw new Error('H5 boolean template message is too large.');
  return join(integer(type, 2), integer(body.length, 2), new Uint8Array(4), body);
};
const header = (messages: Uint8Array[]) => {
  const body = join(...messages);
  return join(
    new Uint8Array([1, 0]),
    integer(messages.length, 2),
    integer(1, 4),
    integer(body.length, 4),
    new Uint8Array(4),
    body,
  );
};

/** A narrow, synthetic HDF5 template writer, not a parser or scientific serializer.
 * h5wasm 0.10.3 cannot construct enums. Seed only empty boolean datasets and
 * boolean attributes, then let HDF5 itself copy/write all source data.
 * Uses the documented v0 superblock / v1 object headers, compact links and
 * FALSE/TRUE int8 enum. No source binary bytes, participant values or fixed
 * participant paths are embedded. See HDF Group file-format sections IV.A.3.
 */
export function booleanTemplate(h5: Library, input: H5.File): Uint8Array | undefined {
  // Enum v1, two members; signed int8 base; padded names, then member values.
  const datatype = new Uint8Array([
    0x18, 2, 0, 0, 1, 0, 0, 0, 0x10, 8, 0, 0, 1, 0, 0, 0, 0, 0, 8, 0, 70, 65, 76, 83, 69, 0, 0, 0,
    84, 82, 85, 69, 0, 0, 0, 0, 0, 1,
  ]);
  const dataspace = (shape: number[], maximum?: number[]) =>
    join(
      new Uint8Array([1, shape.length, maximum ? 1 : 0, 0, 0, 0, 0, 0]),
      ...shape.map((n) => integer(n, 8)),
      ...(maximum ? maximum.map((n) => integer(n < 0 ? undefinedAddress : n, 8)) : []),
    );
  const check = (meta: H5.Dataset['metadata'], path: string) => {
    const members = meta.enum_type?.members;
    if (
      !meta.signed ||
      meta.size !== 1 ||
      !members ||
      Object.keys(members).length !== 2 ||
      members.FALSE !== 0 ||
      members.TRUE !== 1
    )
      throw new Error(`${path}: unsupported boolean enum layout.`);
  };
  type Entry = {
    path: string;
    group: boolean;
    messages: Uint8Array[];
    children: string[];
    address: number;
  };
  const entries: Entry[] = [];
  let needed = false;
  const collect = (entity: H5.Group | H5.Dataset, depth = 0) => {
    if (depth > 32) throw new Error('H5 hierarchy is too deep or contains cyclic links.');
    const group = entity instanceof h5.Group;
    const boolDataset = !group && entity.metadata.type === 8;
    if (!group && !boolDataset) return;
    const entry: Entry = { path: entity.path, group, messages: [], children: [], address: 0 };
    entries.push(entry);
    for (const [name, attr] of Object.entries(entity.attrs)) {
      if (attr.metadata.type !== 8) continue;
      check(attr.metadata, `${entity.path}@${name}`);
      const shape = attr.shape;
      if (!shape) throw new Error(`${entity.path}@${name}: null boolean dataspace.`);
      const values = attr.value;
      const bytes = Uint8Array.from(
        typeof values === 'number' ? [values] : (values as ArrayLike<number>),
      );
      if (bytes.length !== shape.reduce((a, b) => a * b, 1))
        throw new Error(`${entity.path}@${name}: invalid boolean attribute dimensions.`);
      const encodedName = join(text(name), new Uint8Array(1));
      // Attribute v3 declares UTF-8 and has no internal padding.
      entry.messages.push(
        message(
          12,
          join(
            new Uint8Array([3, 0]),
            integer(encodedName.length, 2),
            integer(datatype.length, 2),
            integer(dataspace(shape).length, 2),
            new Uint8Array([1]),
            encodedName,
            datatype,
            dataspace(shape),
            bytes,
          ),
        ),
      );
      needed = true;
    }
    if (group) {
      entry.messages.unshift(
        message(
          2,
          join(new Uint8Array(2), integer(undefinedAddress, 8), integer(undefinedAddress, 8)),
        ),
        message(10, new Uint8Array(2)),
      );
      for (const key of entity.keys()) {
        const child = entity.get(key);
        if (
          child instanceof h5.Group ||
          (child instanceof h5.Dataset && child.metadata.type === 8)
        ) {
          entry.children.push(child.path);
          collect(child, depth + 1);
        }
      }
    } else {
      needed = true;
      check(entity.metadata, entity.path);
      const rank = entity.shape?.length;
      if (rank === undefined || rank === 0)
        throw new Error(`${entity.path}: unsupported boolean dataset rank.`);
      const shape = new Array<number>(rank).fill(0);
      // Chunked v3 layout, initially unallocated v1 B-tree; HDF5 allocates on write.
      const chunks = entity.metadata.chunks ?? new Array<number>(rank).fill(1);
      const maximum = entity.metadata.maxshape ?? new Array<number>(rank).fill(-1);
      entry.messages.unshift(
        message(1, dataspace(shape, maximum)),
        message(3, datatype),
        message(
          8,
          join(
            new Uint8Array([3, 2, rank + 1]),
            integer(undefinedAddress, 8),
            ...chunks.map((n) => integer(n, 4)),
            integer(1, 4),
          ),
        ),
      );
      if (entity.filters.some((filter) => filter.id !== 1))
        throw new Error(`${entity.path}: unsupported boolean filter pipeline.`);
      if (entity.filters.length)
        entry.messages.push(
          message(
            11,
            join(
              new Uint8Array([2, entity.filters.length]),
              ...entity.filters.map((filter) =>
                join(
                  integer(filter.id, 2),
                  integer(1, 2),
                  integer(filter.cd_values.length, 2),
                  ...filter.cd_values.map((v) => integer(v, 4)),
                ),
              ),
            ),
          ),
        );
    }
  };
  collect(input);
  if (!needed) return;
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const encode = (entry: Entry) =>
    header([
      ...entry.messages,
      ...entry.children.map((path) => {
        const name = text(path.split('/').at(-1)!);
        return message(
          6,
          join(
            new Uint8Array([1, 0x11, 1]),
            integer(name.length, 2),
            name,
            integer(byPath.get(path)!.address, 8),
          ),
        );
      }),
    ]);
  let end = 96;
  for (const entry of entries) {
    entry.address = end;
    end += encode(entry).length;
  }
  const superblock = join(
    new Uint8Array([137, 72, 68, 70, 13, 10, 26, 10, 0, 0, 0, 0, 0, 8, 8, 0]),
    integer(4, 2),
    integer(16, 2),
    new Uint8Array(4),
    integer(0, 8),
    integer(undefinedAddress, 8),
    integer(end, 8),
    integer(undefinedAddress, 8),
    integer(0, 8),
    integer(96, 8),
    new Uint8Array(24),
  );
  return join(superblock, ...entries.map(encode));
}

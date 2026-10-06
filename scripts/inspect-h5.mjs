// Read-only, privacy-safe schema inventory: never print/store participant values.
import * as h5 from 'h5wasm/node';
import { resolve } from 'node:path';
await h5.ready;
const file = new h5.File(
  resolve(process.argv[2] ?? 'reference-data/authoritative_reference.h5'),
  'r',
);
const publicAttribute =
  /^(SchemaVersion|SamplingFrequency|FrameStep|Unit|Units|unit_force|unit_moment|unit_position|CoordinateSystem|FreeMomentFrame|ResidualStatus|Scope)$/;
const normalize = (v) =>
  typeof v === 'bigint'
    ? String(v)
    : ArrayBuffer.isView(v) || Array.isArray(v)
      ? Array.from(v, normalize)
      : v;
let objects = 0;
function visit(entity, depth = 0) {
  if (depth > 32) throw new Error('Hierarchy too deep or cyclic');
  const row = { path: entity.path, kind: entity.type, attributes: {} };
  for (const [key, attr] of Object.entries(entity.attrs))
    row.attributes[key] = {
      dtype: attr.dtype,
      shape: attr.shape,
      ...(publicAttribute.test(key) ? { value: normalize(attr.value) } : { value: '[redacted]' }),
      metadata: attr.metadata,
    };
  if (entity instanceof h5.Dataset)
    Object.assign(row, {
      shape: entity.shape,
      dtype: entity.dtype,
      metadata: entity.metadata,
      filters: entity.filters,
      dimensions: entity.get_dimension_labels(),
    });
  console.log(JSON.stringify(row));
  objects++;
  if (entity instanceof h5.Group)
    for (const key of entity.keys()) {
      const child = entity.get(key);
      if (!(child instanceof h5.Group) && !(child instanceof h5.Dataset))
        throw new Error('Unsupported link or named type in schema inventory');
      visit(child, depth + 1);
    }
}
try {
  visit(file);
  console.log(JSON.stringify({ objects, valuesRedacted: true }));
} finally {
  file.close();
}

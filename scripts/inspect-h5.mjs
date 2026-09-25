// Local, read-only inventory. Values may be private; output belongs in ignored .local.
import * as h5 from 'h5wasm/node';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
await h5.ready;
const file = new h5.File(
  resolve(process.argv[2] ?? 'reference-data/authoritative_reference.h5'),
  'r',
);
const normalize = (v) =>
  typeof v === 'bigint'
    ? v.toString()
    : ArrayBuffer.isView(v)
      ? Array.from(v, normalize)
      : Array.isArray(v)
        ? v.map(normalize)
        : v;
const inventory = [];
function visit(entity, depth = 0) {
  if (depth > 32) throw new Error('Hierarchy too deep or cyclic');
  const row = { path: entity.path, kind: entity.type, attributes: {} };
  for (const [key, a] of Object.entries(entity.attrs))
    row.attributes[key] = {
      dtype: a.dtype,
      shape: a.shape,
      metadata: a.metadata,
      value: normalize(a.value),
    };
  if (entity instanceof h5.Dataset) {
    Object.assign(row, {
      shape: entity.shape,
      dtype: entity.dtype,
      metadata: entity.metadata,
      filters: entity.filters,
      dimensions: entity.get_dimension_labels(),
    });
    const value = entity.value;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint')
      row.value = normalize(value);
    else if (value != null) {
      row.preview = normalize(value.slice(0, 16));
      if (ArrayBuffer.isView(value)) {
        let min = Infinity,
          max = -Infinity,
          nonfinite = 0;
        for (const v of value) {
          const n = Number(v);
          if (!Number.isFinite(n)) nonfinite++;
          else {
            min = Math.min(min, n);
            max = Math.max(max, n);
          }
        }
        Object.assign(row, { min, max, nonfinite });
      }
    }
  }
  inventory.push(row);
  if (entity instanceof h5.Group)
    for (const key of entity.keys()) {
      const child = entity.get(key);
      if (!(child instanceof h5.Group) && !(child instanceof h5.Dataset))
        inventory.push({ path: `${entity.path}/${key}`, kind: child?.type });
      else visit(child, depth + 1);
    }
}
try {
  visit(file);
} finally {
  file.close();
}
mkdirSync('.local', { recursive: true });
writeFileSync('.local/h5-inventory.json', JSON.stringify(inventory, null, 2));
for (const row of inventory)
  console.log(
    row.path,
    row.kind,
    JSON.stringify(row.shape ?? ''),
    JSON.stringify(row.dtype ?? ''),
    'attrs:',
    Object.entries(row.attributes ?? {})
      .map(([k, v]) => `${k}:${JSON.stringify(v.dtype)}${JSON.stringify(v.shape)}`)
      .join(' '),
  );

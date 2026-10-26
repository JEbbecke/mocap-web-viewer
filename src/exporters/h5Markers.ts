import type { H5Node } from '../importers/h5/schema';
import {
  POINT_REFERENCE_LISTS,
  POINT_SCALARS,
  pointTextBase,
} from '../importers/c3d/markerMetadata';

/** Select a known axis without numeric coercion, preserving typed and bigint values. */
export function selectMarkerAxis<T extends ArrayLike<unknown>>(
  value: T,
  shape: number[],
  axis: number,
  indices: number[],
): T {
  const inner = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
  const outer = shape.slice(0, axis).reduce((a, b) => a * b, 1);
  const result = (
    Array.isArray(value)
      ? new Array(outer * indices.length * inner)
      : new (value.constructor as { new (length: number): T })(outer * indices.length * inner)
  ) as T;
  const target = result as { [index: number]: unknown };
  for (let row = 0; row < outer; row++)
    indices.forEach((index, i) => {
      const from = (row * shape[axis] + index) * inner,
        to = (row * indices.length + i) * inner;
      for (let component = 0; component < inner; component++)
        target[to + component] = value[from + component];
    });
  return result;
}

export interface MarkerAttributeUpdate {
  value: unknown;
  shape?: number[];
}
export function h5MarkerMetadata(
  input: H5Node,
  count: number,
  indices: number[],
  labels: string[],
) {
  const attributes = new Map<string, MarkerAttributeUpdate>();
  const skipGroups = new Set<string>();
  const labeled = input.get?.('Trajectories/Labeled') as H5Node;
  for (const [name, attr] of Object.entries(labeled.attrs ?? {})) {
    if (['Labels', 'NumLabeled', 'Unit', 'ResidualStatus'].includes(name)) continue;
    if (attr.shape?.[0] === count && (Array.isArray(attr.value) || ArrayBuffer.isView(attr.value)))
      attributes.set(`/Trajectories/Labeled@${name}`, {
        value: selectMarkerAxis(attr.value as ArrayLike<unknown>, attr.shape, 0, indices),
        shape: [indices.length, ...attr.shape.slice(1)],
      });
  }
  const point = input.get?.('MetaData/C3DParameters/POINT') as H5Node | undefined;
  if (!point) return { attributes, skipGroups };
  const text = (name: string) => {
    const value = (point.get?.(name) as H5Node | undefined)?.attrs?.value?.value;
    return Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : [];
  };
  for (const base of ['LABELS', 'DESCRIPTIONS']) {
    if (!point.get?.(base)) continue;
    const values = [...text(base)];
    for (let segment = 2; point.get?.(`${base}${segment}`); segment++) {
      values.push(...text(`${base}${segment}`));
      skipGroups.add(`/MetaData/C3DParameters/POINT/${base}${segment}`);
    }
    attributes.set(`/MetaData/C3DParameters/POINT/${base}@value`, {
      value: base === 'LABELS' ? labels : indices.map((index) => values[index] ?? ''),
      shape: [indices.length],
    });
  }
  const oldNames = [...text('LABELS')];
  for (let segment = 2; point.get?.(`LABELS${segment}`); segment++)
    oldNames.push(...text(`LABELS${segment}`));
  if (!oldNames.length) {
    const value = labeled.attrs?.Labels?.value;
    oldNames.push(
      ...(Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : []),
    );
  }
  const removedNames = new Set(oldNames.filter((_, i) => !indices.includes(i)));
  const renamed = new Map(indices.map((index, i) => [oldNames[index], labels[i]]));
  for (const name of point.keys?.() ?? []) {
    const entity = point.get?.(name) as H5Node;
    const attr = entity.attrs?.value;
    if (!attr) continue;
    const key = `/MetaData/C3DParameters/POINT/${name}@value`;
    if (name === 'USED') {
      const old = attr.value;
      const value =
        ArrayBuffer.isView(old) || Array.isArray(old)
          ? selectMarkerAxis(old as ArrayLike<unknown>, [1], 0, [0])
          : old;
      if (ArrayBuffer.isView(value) || Array.isArray(value))
        (value as unknown as { [index: number]: unknown })[0] =
          typeof (value as ArrayLike<unknown>)[0] === 'bigint'
            ? BigInt(indices.length)
            : indices.length;
      attributes.set(key, {
        value:
          ArrayBuffer.isView(value) || Array.isArray(value)
            ? value
            : typeof old === 'bigint'
              ? BigInt(indices.length)
              : indices.length,
        shape: attr.shape ?? undefined,
      });
    } else if (POINT_REFERENCE_LISTS.has(name)) {
      const value = text(name)
        .filter((name) => !removedNames.has(name))
        .map((name) => renamed.get(name) ?? name);
      attributes.set(key, { value, shape: [value.length] });
    } else if (
      !POINT_SCALARS.has(name) &&
      !pointTextBase(name) &&
      attr.shape?.at(-1) === count &&
      (ArrayBuffer.isView(attr.value) || Array.isArray(attr.value))
    ) {
      attributes.set(key, {
        value: selectMarkerAxis(
          attr.value as ArrayLike<unknown>,
          attr.shape,
          attr.shape.length - 1,
          indices,
        ),
        shape: [...attr.shape.slice(0, -1), indices.length],
      });
    }
  }
  return { attributes, skipGroups };
}

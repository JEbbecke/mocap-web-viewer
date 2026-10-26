import type { H5Node } from './schema';
import {
  POINT_REFERENCE_LISTS,
  POINT_SCALARS,
  pointTextBase,
  pointTextSegmentationIssue,
} from '../c3d/markerMetadata';

/** Marker-axis metadata must be established before offering a structural edit. */
export function h5MarkerDeletionIssue(root: H5Node, count: number): string | undefined {
  const labeled = root.get?.('Trajectories/Labeled') as H5Node | undefined;
  if (!labeled) return 'The source marker collection is unavailable.';
  for (const name of labeled.keys?.() ?? []) {
    if (name === 'Time') continue;
    const entity = labeled.get?.(name) as H5Node;
    if (!entity.shape || entity.shape[0] !== count)
      return `Trajectories/Labeled/${name}: cannot establish its marker axis for deletion.`;
  }
  for (const [name, attribute] of Object.entries(labeled.attrs ?? {})) {
    if (['Labels', 'NumLabeled', 'Unit', 'ResidualStatus'].includes(name)) continue;
    const type = (attribute as { metadata?: { type: number } }).metadata?.type;
    if (attribute.shape?.[0] === count && type === 8)
      return `Trajectories/Labeled@${name}: per-marker enum attributes cannot be resized safely.`;
  }
  const bodies = root.get?.('RigidBodies') as H5Node | undefined;
  const raw = labeled.attrs?.Labels?.value;
  const labels = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).map((name) =>
    String(name).trim(),
  );
  for (const key of bodies?.keys?.() ?? []) {
    const body = bodies!.get?.(key) as H5Node;
    if (
      [...(body.keys?.() ?? []), ...Object.keys(body.attrs ?? {})].some((name) =>
        /Marker(?:Indices|IDs|Ids)$/i.test(name),
      )
    )
      return `RigidBodies/${key}: undocumented marker indices prevent trajectory deletion.`;
    const members = (body.get?.('Markers') as H5Node | undefined)?.value;
    if (
      Array.isArray(members) &&
      labels.some(
        (name, i) =>
          labels.indexOf(name) !== i && members.some((member) => String(member).trim() === name),
      )
    )
      return `RigidBodies/${key}: duplicate source labels make marker membership ambiguous.`;
  }
  const parameters = root.get?.('MetaData/C3DParameters') as H5Node | undefined;
  for (const groupName of parameters?.keys?.() ?? []) {
    if (!/MARKER|SEGMENT|MODEL/.test(groupName)) continue;
    const group = parameters!.get?.(groupName) as H5Node;
    for (const name of group.keys?.() ?? []) {
      const raw = (group.get?.(name) as H5Node)?.attrs?.value?.value;
      const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
      if (values.some((value) => typeof value === 'string' && labels.includes(value.trim())))
        return `MetaData/C3DParameters/${groupName}/${name}: undocumented marker dependencies prevent trajectory deletion.`;
    }
  }
  const point = root.get?.('MetaData/C3DParameters/POINT') as H5Node | undefined;
  if (point) {
    const segmentation = pointTextSegmentationIssue(point.keys?.() ?? []);
    if (segmentation) return segmentation;
    const stored = (point.get?.('USED') as H5Node | undefined)?.attrs?.value?.value;
    if (stored !== undefined) {
      const used =
        Array.isArray(stored) || ArrayBuffer.isView(stored)
          ? (stored as ArrayLike<unknown>)[0]
          : stored;
      if (Number(used) !== count)
        return 'Embedded POINT count does not align with the labeled trajectory collection.';
    }
    const pointNames: unknown[] = [];
    for (let segment = 1; ; segment++) {
      const parameter = point.get?.(segment === 1 ? 'LABELS' : `LABELS${segment}`) as
        H5Node | undefined;
      if (!parameter) break;
      const value = parameter.attrs?.value?.value;
      pointNames.push(...(Array.isArray(value) ? value : typeof value === 'string' ? [value] : []));
    }
    if (
      pointNames.length &&
      (pointNames.length !== count ||
        pointNames.some((name, i) => String(name).trim() !== String(labels[i]).trim()))
    )
      return 'Embedded POINT labels do not align with the labeled trajectory columns.';
  }
  if (point)
    for (const name of point.keys?.() ?? []) {
      const value = (point.get?.(name) as H5Node)?.attrs?.value;
      if (!value || POINT_SCALARS.has(name) || pointTextBase(name)) continue;
      const path = `MetaData/C3DParameters/POINT/${name}`;
      if (POINT_REFERENCE_LISTS.has(name)) {
        if (!Array.isArray(value.value) || value.value.some((v) => typeof v !== 'string'))
          return `${path}: marker reference layout is unsupported for deletion.`;
        if (
          labels.some(
            (label, i) => labels.indexOf(label) !== i && (value.value as unknown[]).includes(label),
          )
        )
          return `${path}: duplicate source labels make marker references ambiguous.`;
      } else {
        if (/\d+$/.test(name))
          return `${path}: custom segmented marker metadata cannot be deleted safely.`;
        if (Array.isArray(value.value) && value.value.some((v) => labels.includes(v)))
          return `${path}: undocumented marker references prevent trajectory deletion.`;
        if (value.shape && value.shape.length > 1 && value.shape.at(-1) !== count)
          return `${path}: cannot establish the marker metadata axis.`;
      }
    }
}

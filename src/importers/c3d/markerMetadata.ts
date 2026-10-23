import { labels, type Parameters } from './parameters';

export const POINT_REFERENCE_LISTS = new Set([
  'ANGLES',
  'SCALARS',
  'FORCES',
  'REACTIONS',
  'POWERS',
  'MARKERS',
]);
export const POINT_SCALARS = new Set([
  'USED',
  'SCALE',
  'RATE',
  'DATA_START',
  'FRAMES',
  'LONG_FRAMES',
  'UNITS',
  'X_SCREEN',
  'Y_SCREEN',
  'ORIGINAL_LAST_FRAME',
  'MOVIE_ID',
  'MOVIE_DELAY',
  'TYPE_GROUPS',
  'ANGLE_UNITS',
  'SCALAR_UNITS',
  'FORCE_UNITS',
  'REACTION_UNITS',
  'POWER_UNITS',
]);
export const pointTextBase = (name: string) => /^(LABELS|DESCRIPTIONS)(?:\d+)?$/.exec(name)?.[1];
export function pointTextSegmentationIssue(names: string[]): string | undefined {
  for (const base of ['LABELS', 'DESCRIPTIONS']) {
    const segments = names
      .filter((name) => pointTextBase(name) === base)
      .map((name) => (name === base ? 1 : Number(name.slice(base.length))))
      .sort((a, b) => a - b);
    if (names.includes(`${base}1`) || segments.some((segment, index) => segment !== index + 1))
      return `POINT:${base}: noncontiguous marker text segmentation cannot be rewritten safely.`;
  }
}

/** Reject unresolved references instead of leaving source metadata pointing at removed columns. */
export function c3dMarkerDeletionIssue(params: Parameters, count: number): string | undefined {
  const segmentation = pointTextSegmentationIssue(
    [...params.keys()].filter((key) => key.startsWith('POINT:')).map((key) => key.slice(6)),
  );
  if (segmentation) return segmentation;
  const names = labels(params, 'POINT:LABELS');
  for (const [key, p] of params) {
    const [group, name] = key.split(':');
    if (group === 'POINT') {
      if (pointTextBase(name) || POINT_SCALARS.has(name)) continue;
      if (POINT_REFERENCE_LISTS.has(name)) {
        if (p.storage?.kind !== -1)
          return `${key}: marker reference layout is unsupported for deletion.`;
        if (
          names.some(
            (label, i) => names.indexOf(label) !== i && p.values.some((value) => value === label),
          )
        )
          return `${key}: duplicate source labels make marker references ambiguous.`;
        continue;
      }
      if (/\d+$/.test(name))
        return `${key}: custom segmented marker metadata cannot be deleted safely.`;
      if (p.storage?.kind === -1 && p.values.some((value) => names.includes(String(value))))
        return `${key}: undocumented marker references prevent trajectory deletion.`;
      if (p.dimensions.length > 1 && p.dimensions.at(-1) !== count && p.storage?.kind !== -1)
        return `${key}: cannot establish the marker metadata axis.`;
    } else if (
      /MARKER|SEGMENT|MODEL/.test(group) &&
      p.storage?.kind === -1 &&
      p.values.some((value) => names.includes(String(value)))
    )
      return `${key}: undocumented marker dependencies prevent trajectory deletion.`;
  }
  const descriptions = labels(params, 'POINT:DESCRIPTIONS');
  if (descriptions.length > count) return 'POINT:DESCRIPTIONS has more rows than source markers.';
}

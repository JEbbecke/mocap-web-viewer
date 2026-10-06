/** Conservative OpenSim Gait2392 coordinate convention. Exact names only;
 * custom coordinates and all ID variables require explicit source units.
 * https://github.com/opensim-org/opensim-models/tree/master/Pipelines/Gait2392_Simbody
 */
const rotations = new Set([
  'pelvis_tilt',
  'pelvis_list',
  'pelvis_rotation',
  'lumbar_extension',
  'lumbar_bending',
  'lumbar_rotation',
  ...['l', 'r'].flatMap((side) =>
    [
      'hip_flexion',
      'hip_adduction',
      'hip_rotation',
      'knee_angle',
      'ankle_angle',
      'subtalar_angle',
      'mtp_angle',
    ].map((name) => `${name}_${side}`),
  ),
]);
export function modelCoordinateType(name: string) {
  if (rotations.has(name)) return 'rotation' as const;
  if (['pelvis_tx', 'pelvis_ty', 'pelvis_tz'].includes(name)) return 'translation' as const;
}

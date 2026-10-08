# Local coordinate systems

The right-sidebar **Display** tab offers **Force platform coordinate systems**
and **Rigid body coordinate systems** for the corresponding loaded categories.
Both default on and are independent scene layers. They remain available for
inspection when other geometry layers are hidden. A category with no objects
has no coordinate-system control; objects without a valid pose have no axes.

These helpers are optional display aids. They do not edit MotionData, calibration,
coordinate definitions, dirty state, undo/redo or C3D/H5 exports. Enabled helpers
appear in image/video exports through the shared scene and display updates.

Each helper uses Three.js `AxesHelper`: positive X red, Y green and Z blue, with
100 mm axes defined by `LOCAL_COORDINATE_AXIS_LENGTH_MM`. Only positions and
lengths cross the existing 0.001 scene-units/mm boundary. Rotations keep lab XYZ;
the viewer does not transpose matrices, remap axes or flip a plate's normal to
face the camera. Helpers do not intercept marker picking.

## Force-platform frames and origins

- Declared global `Position`/`Rotation` poses take priority. `Position` is the
  frame anchor and `Rotation` is the stored row-major local-to-global matrix.
  The measurement origin is `Position - Rotation × d`, where `d` is interpreted
  according to the declared force-platform type. The result is not projected
  onto the plate surface.
- C3D plates without an explicit pose use the existing scientific `plateBasis`
  convention: X follows corner 2 to corner 1, Z follows the cross product with
  corner 4 to corner 1, and Y completes the right-handed basis. The frame anchor
  is the surface centre (mean of four corners), matching the surface-moment/COP
  frame used by C3D import. The helper is translated to the sensor origin:
  `surface centre - plateBasis × d`.
- H5 corners alone do not establish local-axis ordering. Without a complete
  declared global pose, the helper is omitted. Confirming unresolved force/COP
  samples as already global does not establish a local frame.

The [C3D ORIGIN specification](https://www.c3d.org/HTML/Documents/forceplatformorigin.htm)
defines different meanings for these components:

| Declared type   | Sensor-to-surface displacement `d`  | Origin interpretation                                                                                                 |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| TYPE-1 / TYPE-3 | `[0, 0, Origin[2]]`                 | Only depth locates the measurement origin. TYPE-3 X/Y describe transducer spacing and must not translate the axes.    |
| TYPE-2 / TYPE-4 | `[Origin[0], Origin[1], Origin[2]]` | The full vector points from the measurement origin to the surface centre; invert it to locate the measurement origin. |

See [TYPE-3](https://www.c3d.org/HTML/Documents/type31.htm),
[TYPE-2](https://www.c3d.org/HTML/Documents/type24.htm) and
[TYPE-4](https://www.c3d.org/HTML/Documents/type43.htm). C3D import currently
supports types 2/3/4; the depth rule also covers a declared TYPE-1 H5 pose.
For a horizontal TYPE-3 plate, transducer spacing cannot cause lateral movement.
For a tilted plate, the depth displacement follows the plate's local normal.

Both importers retain the source components in `ForcePlatform.origin`, in mm.
The source type is retained separately in `ForcePlatform.type`: directly from
C3D `FORCE_PLATFORM:TYPE`, or H5's embedded
`MetaData/C3DParameters/FORCE_PLATFORM/TYPE`, matched by original plate identity.
Recovering H5 type does not require complete channel/calibration definitions or
original mm units. A verified C3D definition can also supply type provenance.
The existing C3D legacy sign normalization remains unchanged; the rendering
subtraction expresses vector direction, not a second calibration/sign correction.

Missing/zero origin data leave the helper at its anchor. A nonzero ORIGIN without
established type semantics is omitted rather than guessed. Malformed arrays or
nonfinite components used by that type hide the helper. Already-global corners,
forces and COP are unchanged. Displacements are recomputed from the anchor each
update, so repeated frames or toggles cannot accumulate translation.

Moving poses use their own geometry clocks, independent of force sampling,
at the same physical time as the plate surface. Applied crops use the existing
cropped/rebased series; unapplied selections do not change the data. Position
sampling follows existing display interpolation. Valid rotation endpoints use
quaternion spherical interpolation for fractional media times, preserving an
orthonormal local frame rather than interpolating matrix entries into a shear.
No interpolation crosses invalid poses and no pose is extrapolated.

Nonfinite positions, missing rotations, degenerate C3D corners, non-orthonormal
matrices and reflections hide the helper. An invalid explicit pose never falls
back to an invented orientation from its corners.

## Rigid-body poses and origins

Rigid-body helpers use `MotionData.rigidBodies[].position` as the defined local
origin and the columns of its stored row-major `rotation` as directed XYZ axes
in lab space. The visualization treats this matrix as local-to-lab and applies it
directly, without transposing or reconstructing an orientation from member
markers. Position/rotation follow their current series clocks, including crops
and fractional media times. Missing/nonfinite positions or rotations, improper
matrices and unavailable times hide the helper; a single recorded body frame
is not extrapolated as a static pose.

The current H5 schema carries no body-parent hierarchy, and existing validation
has not independently established source parent-frame conventions. This display
interpretation requires Position/Rotation to be lab poses; it does not establish
or convert a vendor's parent-relative convention. Verify that convention against
the authoritative producer before relying on these axes for such recordings.
See [existing scientific limits](OPEN_QUESTIONS.md).

## Lifecycle and validation

Plate helpers belong to the existing `Plates` object collection. They are created
once per loaded object, updated through `useScientificFrame`, hidden by toggles,
and disposed with the object's resources. `RigidBodies` owns its pose helpers
through the same lifecycle; no separate body meshes or marker-derived model are
introduced. Camera bounds include recorded body positions. Image export renders this same scene;
video's existing isolated snapshot resolves the same helpers and updates their
poses with frozen visibility. No media-specific helpers are created.

Focused tests cover asymmetric rotations, translated origins, invalid/gapped
poses, independent geometry clocks, crops, visibility, scientific export bytes,
state/history safety, helper reuse/disposal and video-scene isolation. Browser
smoke uses invented H5 poses and broad content checks; generated media and reports
remain ignored/local.

# Scientific units and rendering

`MotionData.units` records a single application convention, defined in
`src/motion/units.ts`:

| Quantity                                                                 | Internal / displayed unit            |
| ------------------------------------------------------------------------ | ------------------------------------ |
| Marker XYZ, nonnegative spatial residuals                                | mm                                   |
| Plate corners, position, sensor origin/offset, COP, rigid-body positions | mm                                   |
| Force                                                                    | N                                    |
| Moment and free moment (Tz)                                              | Nm (N·m)                             |
| Time and events                                                          | seconds relative to recording origin |
| Analog / EMG / other named signals                                       | Their own declared units             |
| Rotation matrices / quality flags / frame indices                        | Dimensionless / codes / indices      |

Negative residuals remain an invalid sentinel; NaN remains unavailable. Angles,
voltages and opaque model outputs are not converted as distances. Lab XYZ axes,
force signs and coordinate-frame guards are unchanged.

## Import boundaries

H5 markers use `Trajectories/Labeled@Unit`; legacy missing units assume mm with
a warning. Plate geometry and COP use `unit_position`, forces use `unit_force`,
and moments/Tz independently use `unit_moment`. Body positions use their `Unit`,
falling back to the marker unit. Supported distances are mm, cm and m.
The authoritative reference was checked read-only: its distances are mm, forces N,
and moments/Tz Nmm. Thus spatial values pass through unchanged and Nmm moments
are converted to Nm by 0.001. Its measurements are never used as synthetic fixtures.

C3D `POINT:UNITS` is required: mm/cm/m normalize to mm using factors 1/10/1000.
Point scale and residual decoding precede distance normalization. Corners and
sensor origin use the point length unit. Unsupported or missing point units fail
explicitly, rather than silently relabelling data.

Force calculations retain the source length unit until after calibration and
surface-moment/COP calculation (including type-3 COP polynomials). Type 2 uses
scaled force/moment channels; type 3 uses eight scaled force channels; type 4
applies its calibration matrix to scaled analog inputs. Explicit N/kN and
Nm/Nmm/Ncm channel units are honored for type 2/3 before wrench transport.
Analog arrays themselves are unchanged. Missing physical channel units use the
C3D convention: force (N by default, or `FORCE_PLATFORM:UNITS`) and force × point
length for moments. A legacy V label on type 2/3 produces a warning and retains
the existing C3D/ezc3d assumption that ANALOG:SCALE includes calibration. Such a
label cannot establish whether a malformed file really contains uncalibrated
voltages; acquisition calibration must be verified in that case. Other unsupported
physical units omit the affected platform with a warning, retaining analog data.

Type-4 matrix outputs must use force × POINT length for the moment rows, regardless
of the input voltage labels. Force is normalized to N; source-length moments are
converted independently to Nm; COP/corners/origin are normalized to mm. No moment
is multiplied by the spatial mm factor alone.

These conventions follow the C3D documentation for
[force-channel scaling](https://www.c3d.org/HTML/Documents/calculatingscalevaluesforforceplates.htm),
[analog units](https://www.c3d.org/HTML/Documents/analogunits.htm),
[calibration matrices](https://www.c3d.org/HTML/Documents/forceplatformcalmatrix.htm)
and [origin units](https://www.c3d.org/HTML/Documents/forceplatformorigin.htm).

## Crop, editing and export

Cropping slices normalized arrays at each signal's clock; it does not rescale
samples, static geometry, forces, moments or analog data. Event edits change only
event fields and retain the existing seconds/frame mapping.

Exports are source-preserving, not serializers of rendered coordinates. They
receive the immutable original File plus the crop interval and edited events.
H5 copies raw datasets with their unit attributes; C3D copies raw point/analog
records with their original unit, scale and calibration parameters. A normal
mm source therefore follows source mm → internal mm → exported mm. A metre
source follows source m → internal mm, while export retains the original m
values and m metadata. Full-range unedited downloads preserve source bytes;
synthetic reconstruction/crop/event tests additionally check raw values and units.
There is no cross-format export or coordinate editing serializer.

## Viewer and UI

Inspector and plots consume scientific mm directly; moment plots remain Nm and
force plots N. `src/viewer/scale.ts` converts temporary positions and lengths at
the rendering boundary: 1000 mm occupies one scene unit. Marker instances, links,
labels, plate buffers/poses, COP and camera bounds all use this same scale. Data
arrays are never mutated. Existing scene camera distances, clipping, orbit limits,
marker radii and the 20-unit grid retain their physical sizes (a 20 m grid).

The arrow setting is a visual length in **mm/N**, default 1. A 500 N force draws
a 500 mm arrow (0.5 scene units). Its origin is the scaled COP; its direction and
the force threshold use unchanged N values. This is not a force-unit conversion.

## Audit and regression coverage

The previous `metres()` helper converted H5/C3D spatial data to m at import;
MotionData, inspector, plots and Three.js all shared that convention. H5 moments
used independent declared-unit normalization; C3D moments used force × source
length to Nm. Exports already copied raw source values. The fix changes the
scientific distance convention and isolates rendering scale while retaining Nm.

`tests/units.test.ts` checks 1234.5 mm, residuals, corners/origin, COP, forces,
moments/Tz, mm/cm/m C3D sources, explicit moment channels, types 3/4, H5 mm/Nmm and
m/Nm, crop, event edits, raw exported values/metadata and re-imports. Existing
moving-plate, lifecycle, compressed-H5, binary-encoding and event tests remain.
The authoritative H5 test reads only; export and browser lifecycle checks use
synthetic H5 files. Private SI oracle comparisons convert expected comparison
units explicitly without rewriting the oracle or loosening physical tolerances.

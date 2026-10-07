# Institute H5: current authoritative schema

The ignored, read-only `reference-data/authoritative_reference.h5` was recursively
inspected on 6 October 2026. It defines the only supported institute H5 layout.
No participant values are documented. `scripts/inspect-h5.mjs` produces a
redacted structural inventory; private values must not enter logs or fixtures.

## Fresh H5 from C3D

C3D→H5 export creates the current unversioned institute hierarchy from normalized
MotionData, with nested MetaData/Project and FileInfo, float64 trajectories and
residuals, explicit clocks, expanded Events and available Analog/ForcePlates.
Spatial values are mm, force N, and internal Nm moment/free moment values become
declared Nmm. The unspecified trajectory fourth row is NaN; optional missing
groups are not fabricated. Known subject metadata and minimal conversion
provenance are mapped without embedding C3D parameter trees or local filesystem
paths. Existing H5→H5 export retains its original source-preserving layout.
See [cross-format compatibility](CROSS_FORMAT_EXPORT.md) for exact mappings,
H5→C3D losses, sampling guards, validated original force-channel reuse and the
derived TYPE-2 fallback.

H5→C3D stores imported subject/project/file/location and coordinate descriptions
in versioned C3D `JE_METADATA` parameters. Embedded `MetaData/C3DParameters`
can supply original TYPE-2/3/4 channel mappings and analog encoding, but reuse
requires reconstruction checks against current signals and float32 output.
Compatible current H5 data can reuse original plates and analog channels;
missing or incompatible definitions fall back independently per plate.
Unimported raw parameter trees are not copied to the new C3D.

## Current layout

```text
/
  Analog/{Data,Time}
  EMG/{Data,Time}
  Events/{Context,Description,Frame,GenericFlag,IconID,Name,Subject,Time}
  ForcePlates/<index>/{COP,Corners,Force,Moment,Origin,Position,Rotation,Time,Tz}
  IDResults/{Data,Time}
  IKResults/{Data,Time}
  MetaData/{Project,FileInfo,Location,C3DParameters}
  RigidBodies/<index>/{Markers,Position,Rotation}
  Trajectories/Labeled/{Data,Residuals,Time,Type,Virtual}
  CustomFields
```

There is no root or group SchemaVersion in the current reference. Its identifying
layout is nested metadata and expanded event columns, with independent stream
frame extents. `institute-current` is an internal layout identifier, not an
invented H5 version. Explicit SchemaVersion attributes and obsolete Location/Offset
plate layouts are rejected. Export preserves current source semantics.

Current nested MetaData/Project or MetaData/FileInfo identifies the layout. Labelled
trajectories, matching labels, a declared Unit and a valid point rate are required.
Other data collections are optional. CameraMasks and CameraMasksKnown are absent
from the reference; generic optional quality/boolean infrastructure remains tested. No compound datasets,
root attributes or dimension labels were observed; CustomFields is empty.

M = markers, F = point frames, C = channels, S = a stream's own samples, E = events.

| Path                                      | Dtype / shape         | Units and clock                                              | Application support / crop / export                                                                   |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Trajectories/Labeled/Data                 | float64 [M,4,F]       | XYZ in Unit, currently mm; fourth row opaque                 | Float64 canonical mm, 3D/plots; rename Labels; slice last axis; preserve raw values                   |
| Trajectories/Labeled/Residuals            | float64 [M,F]         | Spatial unit; negative invalid, NaN unavailable              | Quality/validity; finite XYZ remains valid with unknown residual; slice last axis                     |
| Trajectories/Labeled/Type                 | int8 [M,F]            | Codes unknown                                                | Structured quality; slice last axis                                                                   |
| Trajectories/Labeled/Virtual              | bool enum [M]         | FALSE/TRUE with signed int8 base                             | Static quality flag; preserve enum                                                                    |
| Trajectories/Labeled/Time                 | float64 [F]           | Absolute seconds; regular point clock                        | Recording origin; slice without source-time rebasing                                                  |
| {Analog,EMG}/Data                         | float64 [C,S]         | Per-channel Units, independent SamplingFrequency/Time        | Scalar plots; EMG maps Channels to analog identities and shares equal arrays; slice own clock         |
| {Analog,EMG}/Time                         | float64 [S]           | Absolute seconds, own sample frames                          | Synchronization; slice and update sample/frame extents                                                |
| ForcePlates/<index>/{Force,Moment,COP,Tz} | float64 [3,S]         | Declared N/Nmm/mm/Nmm                                        | Internal N/Nm/mm/Nm; vector plots and existing force/COP rendering; slice own clock                   |
| ForcePlates/<index>/Corners               | float64 [3,4,S]       | Global mm, force or point geometry grid                      | Moving outline; slice own geometry clock; preserve corner order                                       |
| ForcePlates/<index>/Position              | float64 [3,S]         | Global mm                                                    | Structured/rendering pose; slice own geometry clock                                                   |
| ForcePlates/<index>/Rotation              | float64 [3,3,S]       | Dimensionless local-to-global matrices                       | Pose; slice own geometry clock; never rotate global vectors again                                     |
| ForcePlates/<index>/Origin                | float64 [3,1]         | Sensor offset, position unit                                 | Static; never translate already-global corners by this offset                                         |
| ForcePlates/<index>/Time                  | float64 [S]           | Absolute seconds, independent force grid                     | Synchronization; slice                                                                                |
| RigidBodies/<index>/Markers               | UTF-8 [members]       | Membership names                                             | Static metadata; update matching renamed marker references                                            |
| RigidBodies/<index>/Position              | float64 [3,F]         | Unit; marker grid by sample count                            | mm position signals; slice point grid while retaining body's own frame origin                         |
| RigidBodies/<index>/Rotation              | float64 [3,3,F]       | Parent convention unknown                                    | Structured orientation; slice point grid                                                              |
| {IKResults,IDResults}/Data                | float64 [variables,S] | Labels, optional time row; per-variable units absent         | Catalog/counts and rename; Data Explorer reads local sample pages; retain independent results on crop |
| {IKResults,IDResults}/Time                | float64 [S]           | Independent processing clock; no declared trial relationship | Preserve without forced alignment; no new plots or invented offset                                    |
| Events/{Name,Context,Description,Subject} | UTF-8 [E]             | Parallel metadata                                            | Timeline/editor; preserve text/whitespace; CRUD and time-based row crop                               |
| Events/Time                               | float64 [E]           | Absolute trial seconds                                       | Relative seconds internally; preserve untouched values exactly                                        |
| Events/Frame                              | int64 [E]             | Absolute zero-based source point frame                       | Preserve on label edit/crop; recompute only after time edit                                           |
| Events/{GenericFlag,IconID}               | int64 [E]             | Flags/icons                                                  | Follow source row identity; new event defaults zero                                                   |

Floating datasets are little-endian float64. Text is variable-length UTF-8.
Boolean attributes and datasets retain their enum type, not plain integer storage.

### Absent and empty optional data

Optional current-schema categories may be omitted or empty when no corresponding
data were recorded. They are unavailable in MotionData, Data and Data Explorer;
no channels, labels or warnings are invented. Required labelled trajectories,
units, point rate and the nested metadata layout remain required. Populated
optional data must have consistent dimensions, labels, units and clocks.

| Category                                  | Valid empty representation                                                                                                                                                      | Populated validation                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Analog / EMG                              | Missing group/Data with no channel metadata; empty group; Data `[0,0]` or `[0,S]` with zero/missing Labels; `[C,0]` with C matching nonblank Labels                             | Numeric `[C,S]`, C nonblank Labels and Units, valid rate/clock; supplied Channels, Time and counts must match                                    |
| IK / ID                                   | Same channel-axis rules as Analog/EMG; empty results have no catalog                                                                                                            | Numeric rank-two layout, matching Labels/counts and supplied Units/Time/rate; per-variable units may be undeclared and clocks remain independent |
| Force platforms                           | Missing/empty collection or child; all Force/Moment/COP `[3,0]`, with other supplied datasets also empty                                                                        | All three `[3,S]` vectors, matching samples, declared position/force/moment units and a valid clock; partial plates fail                         |
| Plate geometry / free moment              | Missing, or zero-sample Corners `[3,4,0]`, Position `[3,0]`, Rotation `[3,3,0]`, Origin `[3,0]`, Tz `[3,0]`                                                                     | Documented axes and established static/point/force geometry grid; malformed populated arrays fail                                                |
| Events                                    | Missing/empty group, or all eight columns `[0]`                                                                                                                                 | All eight one-dimensional columns with matching rows; valid times, frames, flags and icons                                                       |
| Rigid bodies                              | Missing/empty collection or child; Position `[3,0]` and empty/absent Rotation/Markers                                                                                           | Position `[3,F]`, declared Unit, matching marker grid/counts and optional Rotation `[3,3,F]`                                                     |
| Residuals / quality                       | Missing or zero-length arrays at the documented rank; axes must match their marker/frame dimensions or be zero, e.g. Residuals/Type `[M,0]`, flags `[0]`, CameraMasks `[M,0,F]` | Exact marker/frame/flag/camera axes; malformed arrays fail                                                                                       |
| Subject / project / provenance / location | Missing attributes/subgroups, empty arrays/text or unavailable values use existing hidden-field conventions                                                                     | Descriptive metadata remain opaque and source-preserved; at least MetaData/Project or MetaData/FileInfo must still exist                         |

For channel matrices, rank-one `[0]` is invalid; rank-two `[0,0]` is empty.
`[N,0]` still declares N channel identities, so zero/missing Labels is inconsistent
unless N is zero. Empty-string Labels are not a zero-label array. Missing labels
are valid only with zero channels. h5wasm 0.10.3 returns zero-length attributes
as empty typed arrays, including Labels/Units; the importer recognizes these as
zero entries. A supplied Time grid must match the sample axis even for `[0,S]`.
An empty Time vector accompanying real samples remains an error.

Fresh C3D-to-H5 export omits unavailable Analog/EMG/ForcePlates/model/body groups
and writes the complete zero-row Events layout. Source-format H5 export preserves
valid empty source structures and their metadata. Cropping retains an entire
empty channel category, including any `[0,S]` acquisition grid, rather than
slicing Time alone. Empty quality arrays with a retained marker-frame axis, such
as CameraMasks `[M,0,F]`, resize that axis on crop without inventing samples.
No EMG category or conversion-loss warning is fabricated.

### Current attributes and metadata

- Trajectories: NumFrames, StartFrame, EndFrame (inclusive), SamplingFrequency.
  Labeled: Labels, NumLabeled, Unit, ResidualStatus.
- Analog/EMG: Channels (int64 vectors), Labels/Units (UTF-8 vectors), NumSamples,
  StartFrame/EndFrame (int64), SamplingFrequency (float64).
- Plates: Name, CoordinateSystem, FreeMomentFrame, NumSamples, SamplingFrequency,
  StartFrame, EndFrame, FrameStep, unit_force, unit_moment, unit_position.
  FrameStep=1 in this reference; no SchemaVersion.
- Bodies: Name, NumSamples, Unit, StartFrame, EndFrame; no separate Time/rate.
  Their source frame origin can differ from Trajectories and survives cropping.
- IK/ID: Labels, NumSamples, Metadata. Metadata is opaque processing text, never
  evaluated as Python. IK's inDegrees=yes does not establish units for all
  variables: translations and rotations differ. ID units remain unknown.
- MetaData/Project: SubjectID, SubjectGroup, Age, Sex, BodyHeight, BodyMass,
  Condition, Project, ProjectPI (strings, including numeric-looking values).
- MetaData/FileInfo: FileCreationLocal, FileCreationUTC, LastUpdate, OriginalFiles,
  PathFile. These are provenance; retain their original history on crop.
- MetaData/Location: Lat, Lon; unavailable/Unknown values stay hidden.
- MetaData/C3DParameters: nested acquisition/provenance for ANALOG, POINT, EVENT,
  EVENT_CONTEXT, FORCE_PLATFORM, MANUFACTURER, PROCESSING, SEG and TRIAL.
  Parameter groups have description, is_locked (boolean enum), type (int64) and
  value (typed scalar/vector/matrix attribute); **METADATA** has DESCRIPTION and
  IS_LOCKED. Preserve this hierarchy and dtype. These are original C3D records,
  not a second live Events collection. Matching POINT/ANALOG label aliases are
  updated when live labels change; unrelated provenance remains unchanged.

Scientific data, descriptive metadata, original provenance and internal layout
information stay separate. File Info reads nested current metadata. Data/File Info never expose raw hierarchy JSON.

### Units, timing and uncertainty

Canonical data remain mm/N/Nm/seconds; source Nmm moments convert independently
to Nm. Raw H5 export retains source numerical values and matching units; rendering
scale and lab-to-scene conventions never enter scientific serialization.
Global plate vectors are not rotated twice. Handedness, compass directions, body
parent convention and Type codes cannot be established from this file alone.

Point and analog/force clocks have different rates. Half-open crop intervals
include all high-rate subframes and retain absolute source timestamps and frames.
Each stream updates its own sample/frame extents, including plate FrameStep.
IK/ID have independent clocks; no alignment shift or model units are fabricated.
Their catalogs retain opaque processing metadata and angular declarations.

### Preservation policy

Unchanged export is byte-identical. Modified export retains supported hierarchy,
primitive and boolean dtypes, labels, encodings, scientific values and provenance.
Unknown temporal meaning blocks crop explicitly. Arbitrary compound/reference/
opaque types, link identity, named types and unsupported filter pipelines remain
limitations of modified export. Irregular marker clocks are unsupported by
regular-frame playback. See [H5_VALIDATION.md](H5_VALIDATION.md) for current results.

## Boolean preservation

Modified exports preserve supported h5py FALSE/TRUE enum datasets and attributes.
Empty synthetic templates supply the enum types that h5wasm cannot construct;
they contain no trial samples. Optional combinations remain covered by tests.
Chunk dimensions and maximum extents are storage details, distinguished from values.

## Moving force plates (confirmed by the format owner)

`Corners[3,4,frames]` contains global corner coordinates at each geometry frame.
It can use the point grid independently of the higher-rate force Time dataset.
`Position` is the origin in global XYZ; `Rotation` maps local axes to the global
frame. `Origin` gives the sensor offset below the plate plane. Static Position
and Rotation arrays (without a time dimension) are also accepted.

Rendering samples the global corners directly in physical time. Position and
Rotation orient and place the identifier on the surface; Origin is not applied
again as a translation of already-global corners. Camera framing includes the
full plate trajectory. Surface depth bias avoids interference with the ground
grid. Cropping slices point-rate geometry on the point clock, even when the
same plate also has a separate force-rate Time array. Pose data are never used
to infer that unresolved force vectors are global.

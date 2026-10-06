# Institute H5: current authoritative schema

The ignored, read-only `reference-data/authoritative_reference.h5` was recursively
inspected on 6 October 2026. It replaces the previous reference described below.
No participant values are documented. `scripts/inspect-h5.mjs` produces a
redacted structural inventory; private values must not enter logs or fixtures.

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
invented H5 version. Explicit versions take precedence; the previous versioned
layout and older Location/Offset plate layouts remain supported. Export preserves
the imported layout without silently reinterpreting old semantics.

Only labelled trajectories, matching labels and a valid point rate are required.
Other groups are optional. CameraMasks and CameraMasksKnown are absent from the
current reference and remain optional for older files. No compound datasets,
root attributes or dimension labels were observed; CustomFields is empty.

M = markers, F = point frames, C = channels, S = a stream's own samples, E = events.

| Path                                      | Dtype / shape         | Units and clock                                              | Application support / crop / export                                                           |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Trajectories/Labeled/Data                 | float64 [M,4,F]       | XYZ in Unit, currently mm; fourth row opaque                 | Float64 canonical mm, 3D/plots; rename Labels; slice last axis; preserve raw values           |
| Trajectories/Labeled/Residuals            | float64 [M,F]         | Spatial unit; negative invalid, NaN unavailable              | Quality/validity; finite XYZ remains valid with unknown residual; slice last axis             |
| Trajectories/Labeled/Type                 | int8 [M,F]            | Codes unknown                                                | Structured quality; slice last axis                                                           |
| Trajectories/Labeled/Virtual              | bool enum [M]         | FALSE/TRUE with signed int8 base                             | Static quality flag; preserve enum                                                            |
| Trajectories/Labeled/Time                 | float64 [F]           | Absolute seconds; regular point clock                        | Recording origin; slice without source-time rebasing                                          |
| {Analog,EMG}/Data                         | float64 [C,S]         | Per-channel Units, independent SamplingFrequency/Time        | Scalar plots; EMG maps Channels to analog identities and shares equal arrays; slice own clock |
| {Analog,EMG}/Time                         | float64 [S]           | Absolute seconds, own sample frames                          | Synchronization; slice and update sample/frame extents                                        |
| ForcePlates/<index>/{Force,Moment,COP,Tz} | float64 [3,S]         | Declared N/Nmm/mm/Nmm                                        | Internal N/Nm/mm/Nm; vector plots and existing force/COP rendering; slice own clock           |
| ForcePlates/<index>/Corners               | float64 [3,4,S]       | Global mm, force or point geometry grid                      | Moving outline; slice own geometry clock; preserve corner order                               |
| ForcePlates/<index>/Position              | float64 [3,S]         | Global mm                                                    | Structured/rendering pose; slice own geometry clock                                           |
| ForcePlates/<index>/Rotation              | float64 [3,3,S]       | Dimensionless local-to-global matrices                       | Pose; slice own geometry clock; never rotate global vectors again                             |
| ForcePlates/<index>/Origin                | float64 [3,1]         | Sensor offset, position unit                                 | Static; never translate already-global corners by this offset                                 |
| ForcePlates/<index>/Time                  | float64 [S]           | Absolute seconds, independent force grid                     | Synchronization; slice                                                                        |
| RigidBodies/<index>/Markers               | UTF-8 [members]       | Membership names                                             | Static metadata; update matching renamed marker references                                    |
| RigidBodies/<index>/Position              | float64 [3,F]         | Unit; marker grid by sample count                            | mm position signals; slice point grid while retaining body's own frame origin                 |
| RigidBodies/<index>/Rotation              | float64 [3,3,F]       | Parent convention unknown                                    | Structured orientation; slice point grid                                                      |
| {IKResults,IDResults}/Data                | float64 [variables,S] | Labels, optional time row; per-variable units absent         | Catalog/counts and rename; samples remain in immutable source; crop independent clock         |
| {IKResults,IDResults}/Time                | float64 [S]           | Independent processing clock; no declared trial relationship | Preserve without forced alignment; no new plots or invented offset                            |
| Events/{Name,Context,Description,Subject} | UTF-8 [E]             | Parallel metadata                                            | Timeline/editor; preserve text/whitespace; CRUD and time-based row crop                       |
| Events/Time                               | float64 [E]           | Absolute trial seconds                                       | Relative seconds internally; preserve untouched values exactly                                |
| Events/Frame                              | int64 [E]             | Absolute zero-based source point frame                       | Preserve on label edit/crop; recompute only after time edit                                   |
| Events/{GenericFlag,IconID}               | int64 [E]             | Flags/icons                                                  | Follow source row identity; new event defaults zero                                           |

Floating datasets are little-endian float64. Text is variable-length UTF-8.
Boolean attributes and datasets retain their enum type, not plain integer storage.

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
information stay separate. File Info reads nested metadata, with flat legacy
fallback. Data/File Info never expose raw hierarchy JSON.

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

## Previous authoritative layout (retained compatibility)

The following inventory records the previous reference inspected on 25 September 2026. Current inspection prints structure with private values redacted and does
not create metadata dumps. Neither reference belongs in Git.

## Observed hierarchy

```text
/
  Analog/{Data,Time}
  EMG/{Data,Time}
  Events/{Description,Frame,Name,Time}
  ForcePlates/{0,1}/{COP,Corners,Force,Moment,Origin,Position,Rotation,Time,Tz}
  IDResults/{Data,Time}
  IKResults/{Data,Time}
  MetaData/Location
  RigidBodies/{0,1}/{Markers,Position,Rotation}
  Trajectories/Labeled/{CameraMasks,CameraMasksKnown,Data,Residuals,Time,Type,Virtual}
  CustomFields
```

There are no compound datasets, references, dimension labels, unlabeled trajectories or root attributes in this example. CustomFields is empty. Optional groups are not made mandatory based on one example.

## Datasets and application mapping

All paths below are relative to `/`. M=42 markers, F=225 frames, A=1800 analog/force samples, K=95 model samples. Floating datasets are little-endian float64. Text is variable-length UTF-8. Boolean datasets are HDF5 FALSE/TRUE enums with signed int8 base, not plain integers. Frame is int64; Type is int8.

| Full path (braces enumerate datasets)           | Shape      | Meaning, units, timing                                                | Application use                                                               | Edit/export policy                                             |
| ----------------------------------------------- | ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Trajectories/Labeled/Data                       | M,4,F      | XYZ in mm, fourth component retained without reinterpretation; 120 Hz | Markers in mm, 3D and XYZ plots                                               | Crop last axis; export original float64                        |
| Trajectories/Labeled/Residuals                  | M,F        | mm; negative invalid, NaN unavailable per ResidualStatus              | Quality/validity; NaN alone does not hide finite markers                      | Crop last axis                                                 |
| Trajectories/Labeled/Type                       | M,F        | Codes; meanings not established                                       | Source quality metadata                                                       | Crop last axis                                                 |
| Trajectories/Labeled/CameraMasks                | M,7,F      | Boolean camera contributions                                          | Source quality metadata                                                       | Crop last axis, preserve enum                                  |
| Trajectories/Labeled/{CameraMasksKnown,Virtual} | M          | Boolean marker flags                                                  | Source quality metadata                                                       | Static                                                         |
| Trajectories/Labeled/Time                       | F          | Trial-clock seconds, 120 Hz                                           | UI origin and synchronization                                                 | Slice; retain absolute timestamps                              |
| {Analog,EMG}/Data                               | channels,A | Per-channel Units, 960 Hz                                             | Scalar plots, literal units (EMG is not assumed volts)                        | Crop by own clock                                              |
| {Analog,EMG}/Time                               | A          | Trial-clock seconds                                                   | Synchronization                                                               | Slice                                                          |
| ForcePlates/{0,1}/{Force,Moment,COP,Tz}         | 3,A        | N, Nmm, mm, Nmm; 960 Hz                                               | Force, moment, COP, free-moment plots; force/COP in 3D                        | Crop last axis, no display coordinates exported                |
| ForcePlates/{0,1}/Corners                       | 3,4,A      | Ordered plate corners, mm                                             | Plate outlines, mm                                                            | Crop last axis even when repeated                              |
| ForcePlates/{0,1}/Position                      | 3,A        | Plate position, mm                                                    | Structured geometry                                                           | Crop last axis                                                 |
| ForcePlates/{0,1}/Rotation                      | 3,3,A      | Matrices, dimensionless                                               | Structured geometry                                                           | Crop last axis                                                 |
| ForcePlates/{0,1}/Origin                        | 3,1        | Sensor offset, position unit                                          | Structured geometry                                                           | Static                                                         |
| ForcePlates/{0,1}/Time                          | A          | Trial-clock seconds                                                   | Synchronization                                                               | Slice                                                          |
| {IKResults,IDResults}/Data                      | 28,K       | Labelled outputs including time; per-channel units absent             | Data variable catalog and File Info counts, excluding labelled time; no plots | Crop own time interval, possibly empty                         |
| {IKResults,IDResults}/Time                      | K          | Independent seconds, approximately 120 Hz                             | Ignored by viewer for now; no alignment warnings                              | No fabricated alignment                                        |
| RigidBodies/{0,1}/Markers                       | 2          | UTF-8 membership                                                      | Body metadata; labels are not necessarily valid marker references             | Static                                                         |
| RigidBodies/{0,1}/Position                      | 3,F        | Unit=mm; marker grid inferred from count and no separate clock        | Position signals, mm                                                          | Crop marker axis                                               |
| RigidBodies/{0,1}/Rotation                      | 3,3,F      | Matrices; parent frame not stated                                     | Structured body data                                                          | Crop marker axis                                               |
| Events/{Name,Description}                       | events     | UTF-8 parallel rows                                                   | Timeline and editor                                                           | Add/edit/delete with original row identity                     |
| Events/Time                                     | events     | Absolute trial-clock seconds                                          | Subtract recording origin for UI                                              | Add origin on export                                           |
| Events/Frame                                    | events     | int64 zero-based source point frames per Scope                        | Retain original row                                                           | Update only on time edit; cropping filters without renumbering |

Only markers and their sampling information are required by the viewer. All other groups and quality fields are optional. Unknown source content is backed by the original immutable File for export, not copied into React state.

## Attributes

Unedited source attributes are retained, including their supported types and string
encoding. Crops update temporal counts; label edits update the relevant `Labels`
or `Name` attributes and can change string storage to fit the complete new text.
See [data-label export mappings](MARKER_EDITING.md) for collection/source identities.

- Trajectories: EndFrame, NumFrames, SamplingFrequency, StartFrame. Inclusive source range 88-312. Time starts at StartFrame/120. UI duration is last minus first point time; crop includes all eight subframes per retained point frame.
- Labeled: Labels, NumLabeled, ResidualStatus, Unit.
- Analog/EMG: Channels (int64 array), Labels, NumSamples (int64), SamplingFrequency (float64), Units.
- Each plate: CoordinateSystem=1, FreeMomentFrame=global, Name, NumSamples, SamplingFrequency, SchemaVersion=2, unit_force, unit_moment, unit_position.
- Events: SchemaVersion=1; Scope explicitly declares trial clock, zero-based source point frames and seconds. No context or subject column exists; the editor must not silently discard those fields.
- IK/ID: Labels, NumSamples, Metadata. Metadata is opaque text, including Python dictionary syntax; never evaluate it. Its embedded nRows is original processing metadata, not a live dataset count.
- RigidBodies: SchemaVersion=1. Each body: Name, NumSamples, Unit.
- MetaData: Age, BodyHeight, BodyMass, Condition, FileCreationLocal, FileCreationUTC, LastUpdate, OriginalFiles, PathFile, Project, ProjectPI, Sex, SubjectID. Location: Lat, Lon. Values are strings, including numeric-looking fields; values are private and excluded here.

## Timing, coordinates and uncertainty

Point/analog/force clocks agree at 120/960 Hz. IK/ID times are approximately 3.825-4.608 seconds, entirely outside the point interval 0.7333-2.6083 seconds. Data and File Info read dataset shapes and labels for variable names/counts, excluding the labelled time row; their signals and clocks are not interpreted or plotted. Raw source data remains available for export. Do not force-align them. Cropping uses absolute time and yields empty model streams for this example.

The reference marks forces and free moments global. Lab XYZ is retained; scientific normalization is mm/N/Nm (source Nmm moments convert independently to Nm) and the viewer is Z-up. No compass directions or lab handedness can be established from this file alone. Corner order is preserved. Global vectors must not be rotated again. Body parent convention and Type codes remain unestablished.

See [unit policy](UNITS.md) for canonical units, H5/C3D boundaries and rendering-only scale. Spatial mm values remain mm on import and source-preserving export.

## Previous implementation gaps and preservation

Previously explicit clocks were ignored; NaN residuals hid finite markers; Corners and vector Tz were lost to display. EMG, bodies and model signals were absent, events disabled, crop export rejected the populated schema and boolean enums. Legacy Location/Offset and scalar Tz remain supported when present. Old converter zero rotations retain their documented warning/convention.

Unchanged export preserves source bytes. Event edits alter only event rows. Label edits update the chosen collection's `Labels` or group `Name`, preserving group paths and source row identity. Crop changes only recognized temporal datasets and frame/sample counts. Supported unknown datasets/attributes survive unchanged, label-only and event-only export. Unknown temporal meaning must produce a specific crop error, rather than silent misalignment; MetaData subtrees are static.

The sibling older Python reader expects Location/Offset and cannot validate this reference. The installed reader also expects Location/Offset and fails on the unmodified authoritative file; it cannot currently serve as a compatibility oracle. It was not modified. Validation results and technical limits are documented in H5_VALIDATION.md.

## Boolean type preservation

Modified exports preserve the h5py boolean enum exactly. `createH5Output` now generates a generic template containing only the source's boolean datasets and attributes; `writeCroppedH5` then fills those datasets and copies the complete source tree. All seven nonempty optional combinations are tested, with no added absent fields. Templates contain no trial samples and preserve supported boolean attribute shapes/values and dataset storage parameters. Chunk dimensions / maximum extents are storage differences, explicitly classified in the independent h5py report.

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
same plate also has a separate force-rate Time array. Legacy placeholder poses
are not used as global geometry.

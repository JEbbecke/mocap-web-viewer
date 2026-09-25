# Institute H5: authoritative schema

Inspected locally, read-only, 25 September 2026. `scripts/inspect-h5.mjs` traverses the entire file, saving a private inventory of every path, shape, dtype, attribute, encoding, compression, dimension label and numerical summary to ignored `.local/h5-inventory.json`. Neither that inventory nor the reference belongs in Git. No network parsing is used.

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

| Full path (braces enumerate datasets)           | Shape      | Meaning, units, timing                                                | Application use                                                   | Edit/export policy                                             |
| ----------------------------------------------- | ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Trajectories/Labeled/Data                       | M,4,F      | XYZ in mm, fourth component retained without reinterpretation; 120 Hz | Markers in metres, 3D and XYZ plots                               | Crop last axis; export original float64                        |
| Trajectories/Labeled/Residuals                  | M,F        | mm; negative invalid, NaN unavailable per ResidualStatus              | Quality/validity; NaN alone does not hide finite markers          | Crop last axis                                                 |
| Trajectories/Labeled/Type                       | M,F        | Codes; meanings not established                                       | Source quality metadata                                           | Crop last axis                                                 |
| Trajectories/Labeled/CameraMasks                | M,7,F      | Boolean camera contributions                                          | Source quality metadata                                           | Crop last axis, preserve enum                                  |
| Trajectories/Labeled/{CameraMasksKnown,Virtual} | M          | Boolean marker flags                                                  | Source quality metadata                                           | Static                                                         |
| Trajectories/Labeled/Time                       | F          | Trial-clock seconds, 120 Hz                                           | UI origin and synchronization                                     | Slice; retain absolute timestamps                              |
| {Analog,EMG}/Data                               | channels,A | Per-channel Units, 960 Hz                                             | Scalar plots, literal units (EMG is not assumed volts)            | Crop by own clock                                              |
| {Analog,EMG}/Time                               | A          | Trial-clock seconds                                                   | Synchronization                                                   | Slice                                                          |
| ForcePlates/{0,1}/{Force,Moment,COP,Tz}         | 3,A        | N, Nmm, mm, Nmm; 960 Hz                                               | Force, moment, COP, free-moment plots; force/COP in 3D            | Crop last axis, no display coordinates exported                |
| ForcePlates/{0,1}/Corners                       | 3,4,A      | Ordered plate corners, mm                                             | Plate outlines, metres                                            | Crop last axis even when repeated                              |
| ForcePlates/{0,1}/Position                      | 3,A        | Plate position, mm                                                    | Structured geometry                                               | Crop last axis                                                 |
| ForcePlates/{0,1}/Rotation                      | 3,3,A      | Matrices, dimensionless                                               | Structured geometry                                               | Crop last axis                                                 |
| ForcePlates/{0,1}/Origin                        | 3,1        | Sensor offset, position unit                                          | Structured geometry                                               | Static                                                         |
| ForcePlates/{0,1}/Time                          | A          | Trial-clock seconds                                                   | Synchronization                                                   | Slice                                                          |
| {IKResults,IDResults}/Data                      | 28,K       | Labelled outputs including time; per-channel units absent             | Ignored by viewer for now; no signals or import notes             | Crop own time interval, possibly empty                         |
| {IKResults,IDResults}/Time                      | K          | Independent seconds, approximately 120 Hz                             | Ignored by viewer for now; no alignment warnings                  | No fabricated alignment                                        |
| RigidBodies/{0,1}/Markers                       | 2          | UTF-8 membership                                                      | Body metadata; labels are not necessarily valid marker references | Static                                                         |
| RigidBodies/{0,1}/Position                      | 3,F        | Unit=mm; marker grid inferred from count and no separate clock        | Position signals, metres                                          | Crop marker axis                                               |
| RigidBodies/{0,1}/Rotation                      | 3,3,F      | Matrices; parent frame not stated                                     | Structured body data                                              | Crop marker axis                                               |
| Events/{Name,Description}                       | events     | UTF-8 parallel rows                                                   | Timeline and editor                                               | Add/edit/delete with original row identity                     |
| Events/Time                                     | events     | Absolute trial-clock seconds                                          | Subtract recording origin for UI                                  | Add origin on export                                           |
| Events/Frame                                    | events     | int64 zero-based source point frames per Scope                        | Retain original row                                               | Update only on time edit; cropping filters without renumbering |

Only markers and their sampling information are required by the viewer. All other groups and quality fields are optional. Unknown source content is backed by the original immutable File for export, not copied into React state.

## Attributes

All source attributes are retained, including their types and string encoding.

- Trajectories: EndFrame, NumFrames, SamplingFrequency, StartFrame. Inclusive source range 88-312. Time starts at StartFrame/120. UI duration is last minus first point time; crop includes all eight subframes per retained point frame.
- Labeled: Labels, NumLabeled, ResidualStatus, Unit.
- Analog/EMG: Channels (int64 array), Labels, NumSamples (int64), SamplingFrequency (float64), Units.
- Each plate: CoordinateSystem=1, FreeMomentFrame=global, Name, NumSamples, SamplingFrequency, SchemaVersion=2, unit_force, unit_moment, unit_position.
- Events: SchemaVersion=1; Scope explicitly declares trial clock, zero-based source point frames and seconds. No context or subject column exists; the editor must not silently discard those fields.
- IK/ID: Labels, NumSamples, Metadata. Metadata is opaque text, including Python dictionary syntax; never evaluate it. Its embedded nRows is original processing metadata, not a live dataset count.
- RigidBodies: SchemaVersion=1. Each body: Name, NumSamples, Unit.
- MetaData: Age, BodyHeight, BodyMass, Condition, FileCreationLocal, FileCreationUTC, LastUpdate, OriginalFiles, PathFile, Project, ProjectPI, Sex, SubjectID. Location: Lat, Lon. Values are strings, including numeric-looking fields; values are private and excluded here.

## Timing, coordinates and uncertainty

Point/analog/force clocks agree at 120/960 Hz. IK/ID times are approximately 3.825-4.608 seconds, entirely outside the point interval 0.7333-2.6083 seconds. The viewer currently ignores both groups completely: no signals, validation or import notes. Raw source data remains available for export. Do not force-align them. Cropping uses absolute time and yields empty model streams for this example.

The reference marks forces and free moments global. Lab XYZ is retained; display normalization is metres/N/Nm and the viewer is Z-up. No compass directions or lab handedness can be established from this file alone. Corner order is preserved. Global vectors must not be rotated again. Body parent convention and Type codes remain unestablished.

## Previous implementation gaps and preservation

Previously explicit clocks were ignored; NaN residuals hid finite markers; Corners and vector Tz were lost to display. EMG, bodies and model signals were absent, events disabled, crop export rejected the populated schema and boolean enums. Legacy Location/Offset and scalar Tz remain supported when present. Old converter zero rotations retain their documented warning/convention.

Unchanged export should preserve source bytes. Event edits should alter only event rows. Crop changes only recognized temporal datasets and frame/sample counts. Unknown datasets/attributes survive unchanged and event-only export. Unknown temporal meaning must produce a specific crop error, rather than silent misalignment; MetaData subtrees are static.

The sibling older Python reader expects Location/Offset and cannot validate this reference. The installed reader also expects Location/Offset and fails on the unmodified authoritative file; it cannot currently serve as a compatibility oracle. It was not modified. Validation results and technical limits are documented in H5_VALIDATION.md.

## Boolean type preservation

Modified exports preserve the h5py boolean enum exactly. `createH5Output` selects an empty synthetic template containing only the quality enum datasets present in the source; `writeCroppedH5` then fills those datasets and copies the complete source tree. All seven nonempty optional combinations are tested, with no added absent fields. Templates have extensible dimensions and no trial values. Chunk dimensions / maximum extents are storage differences, explicitly classified in the independent h5py report.

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

# File Info metadata

File Info is a curated inspector with File & Recording, Acquisition and Data
sections. Subject & Trial, Project & Provenance and Location appear only when
meaningful embedded values exist. It shows event counts; the timeline remains
the event editing interface, while Data also supports event navigation. Raw source
trees are retained internally and source-preserving export is unchanged.

The Display tab contains visibility and force-display controls; individual
platform cards and their signal shortcuts have been removed. Choose force,
moment and COP signals directly in the signal inspector. The [Data tab](DATA_BROWSER.md)
also provides force-signal shortcuts and individual collection entries.

Importers populate optional `MotionData.source.info`. Formatting and current
recording counts live in `components/fileInfoSections.ts`; React renders those
rows without knowing H5 paths or C3D parameter conventions. Cropping updates
frame/duration/event counts through current MotionData while keeping embedded
creation/provenance facts. Rates come from the actual analog and force series:
identical rate sets share one row, otherwise separate rows list every distinct
rate. C3D type summaries describe declared `FORCE_PLATFORM:TYPE` entries; the
force-platform count describes successfully imported platforms. Unsupported
platforms still produce their existing import warnings.

## Institute H5 mappings

- Current `MetaData/Project`: SubjectID, SubjectGroup, Age, Sex, BodyHeight,
  BodyMass, Condition, Project and ProjectPI. Current `MetaData/FileInfo`:
  OriginalFiles, PathFile, FileCreationLocal, FileCreationUTC and LastUpdate.
- `MetaData/Location`: Lat and Lon, including valid zero coordinates.
- `Trajectories@GlobalCoordinateSystem`: displayed only when supplied; the
  renderer's Z-up convention is not treated as an embedded coordinate system.
- Date uses FileCreationLocal, falling back to FileCreationUTC. ISO timestamps
  are spaced for readability without changing precision or timezone. Original
  source strings remain intact.
- Body names come from normalized rigid bodies. EMG count comes only from the
  dedicated EMG group, not analog labels. IK/ID presence and variable counts come
  from `Data` dataset shapes and aligned Labels, excluding labelled time rows;
  File Info displays variable counts without loading model samples. Source-backed
  samples and their clocks are available in Data Explorer and the plot panes;
  confirmed aligned results crop with the trial, while independent results remain intact.

Metadata values retain their source units: numeric height/mass/age do not acquire
assumed cm/kg/years. If a matching `FieldUnit` or `FieldUnits` attribute exists,
it is carried separately and shown literally. OriginalFiles accepts actual
string arrays, JSON arrays or flat quoted lists without evaluating code;
other strings remain literal. Commas in single filenames are not separators.

## Conservative C3D mappings

`FORCE_PLATFORM:TYPE` supplies type/count summaries. `MANUFACTURER:COMPANY`,
`SOFTWARE` and singleton `VERSION_LABEL`/`VERSION` identify the source application.
Processor, endianness and screen axes are not user-facing scientific metadata.
No C3D creation date or lab coordinate system is inferred from ambiguous parameters
or browser file timestamps.

SUBJECT/SUBJECTS is application-specific. Only explicit singleton fields are
mapped: SUBJECTID/SUBJECT_ID/ID, AGE, SEX, BODYHEIGHT/BODY_HEIGHT/HEIGHT,
BODYMASS/BODY_MASS/MASS and CONDITION. A matching `_UNIT`/`_UNITS` parameter is
preserved literally. SUBJECTS:NAMES or SUBJECT:NAME is labelled Subject name,
not Subject ID. For multiple subjects, only names are shown; no demographic
association is invented. WEIGHT, date of birth and numeric sex-code semantics
are not reinterpreted. See the C3D documentation for
[SUBJECTS](https://www.c3d.org/HTML/Documents/thesubjectsgroup.htm) and
[MANUFACTURER](https://www.c3d.org/HTML/Documents/manufacturercompany.htm).

Converted H5→C3D files also carry the versioned `JE_METADATA` mapping for imported
subject values/units, project/file/location facts and explicit coordinate
descriptions. Valid fields restore `source.info` without inventing subject
associations; compatible SUBJECT parameters remain a fallback for malformed or
unsupported extension versions. Other C3D readers may expose these custom
parameters without displaying them as File Info. See
[metadata parameters and limits](CROSS_FORMAT_EXPORT.md#recording-metadata-in-c3d).

## Display and validation

Empty values, null/undefined/NaN, empty arrays/objects and placeholder strings
Unknown/N/A/NA are omitted from metadata rows. Numeric zero is preserved. Long
values wrap within the panel and have complete-value tooltips. More than three
list entries use a compact expandable summary. The raw source remains unchanged.

Synthetic tests cover optional/missing metadata, zero values, multiple source
files, mixed rates/types, crops, model-result summaries and conservative C3D
mapping. Browser checks cover layout, no raw JSON/event list, and existing
timeline/event functionality.

Validated QTM-style type-2/3 V channel labels no longer generate an acquisition
unit warning. This removes only the message: ANALOG:SCALE calibration, type-4
matrix handling, N forces, Nm moments, mm COP and raw analog values are unchanged.
Unsupported types/units, missing channels and malformed calibration remain
validation failures or import warnings.

The compact TRIAL overview above the tabs reuses these normalized fields and
clock formatting. Condition supplies the primary identity when available;
otherwise the source filename is used. Subject ID (or subject name), group and
embedded creation time appear only when meaningful. Creation time is labelled
Created and never comes from browser open time or file modification time.
Basenames and single-line text with tooltips keep the overview compact. Marker
selection, plots, editing and Explorer coordinates remain available.

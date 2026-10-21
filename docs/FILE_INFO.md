# File Info metadata

File & Recording contains the original browser File name and byte size alongside
the format and current recording dimensions. Dates & Provenance distinguishes
embedded timestamps from original filesystem dates. Filesystem creation dates are unavailable
through the standard File API. Fetched demo bytes have a known size but no original
filesystem timestamps; generated File dates and HTTP headers are not used as
substitutes. Sizes use decimal KB/MB/GB and exact-byte tooltips in both workspaces.
Missing timestamps show `Not available`; malformed nonempty fields show
`Invalid timestamp` with the original value and source in the tooltip. Offset and
timezone-naive timestamps retain their original precision and meaning.

File Info has four main sections: File & Recording, Acquisition, Data, and
Dates & Provenance. Subject & Trial is a subsection of File & Recording; Location
is a subsection of Acquisition. Data retains all eight category counts, including
zeros. Dates & Provenance contains Embedded file metadata, Filesystem metadata,
and available Provenance. The source of filesystem facts is a secondary note.
It shows event counts; the timeline remains
the event editing interface, while Data also supports event navigation. Raw source
trees are retained internally and source-preserving export is unchanged.

| Previous display                                                                             | Consolidated location                                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| File properties: name/size; File & Recording: File/Format/Frames/Duration/Source first frame | File & Recording, once per property                                    |
| Subject & Trial                                                                              | File & Recording → Subject & Trial                                     |
| Location                                                                                     | Acquisition → Location                                                 |
| Embedded metadata; generic Date; provenance Created local/Created UTC/Last updated           | Dates & Provenance → Embedded file metadata                            |
| Filesystem dates and metadata source                                                         | Dates & Provenance → Filesystem metadata, with a secondary source note |
| Project/Project PI/Original files/Source path                                                | Dates & Provenance → Provenance                                        |

The former generic Date is the parser's alias of embedded creation, not a separate
acquisition date. A single original input and source path share an Original source
row only when their complete absolute paths match exactly; both labeled fields
remain in Details. Basename-only matches, relative paths, different full paths and
multiple original files remain separate. All original files are retained. Paths show their
basenames initially; keyboard-accessible chevrons integrated into property rows expose full paths in a
full-width area beneath each property. Copy buttons copy each exact original
timestamp or path and report success or clipboard failure.
Property expansions are independent and survive Inspector tab and workspace
switches for the current file. Opening a new file resets them. Clicking exact
values or Copy never toggles the property.

File Info main headings (including Subject & Trial when present) use `#B1DFE1`;
nested metadata headings use `#C1CED7`. Shared, scoped color tokens also apply to
Explorer metadata headings without changing its wider table layout.

Timestamps use the shared `08 Oct 2026, 14:01:31` formatter, with UTC or an explicit
offset when supplied. The narrow inspector places date and time on separate,
right-aligned lines with tabular numerals. Subdued metadata headings and source
notes keep the values prominent. Full-width details and tooltips retain original fractional
seconds, text and offsets. Only creation fields with explicit, known offsets and
exactly equal instants (including fractional precision) share one Created row.
Timezone-naive local fields are never assigned an offset. In the reference H5,
the local timezone is unspecified and local/UTC fractional seconds differ, so
the two creation fields remain separately labelled. Independent JE_METADATA:CREATED
and CREATED_LOCAL fields also remain explicitly distinguishable.
The trial header selects the first valid embedded creation row from this same
presentation model (original first, UTC when needed). It never uses filesystem
modification dates or invents a C3D creation date.

Explorer reuses these sections and formatting. A Section column distinguishes
subsections where needed. Selecting or copying a metadata cell returns exact
source values, including full paths and timestamp precision. Additional coordinate
and schema details remain available. Native one-based C3D first-frame numbering
is in Schema; the shared recording summary uses the normalized zero-based index.

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
- Embedded creation uses FileCreationLocal and FileCreationUTC without guessing
  their equivalence. Original source strings remain intact.
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

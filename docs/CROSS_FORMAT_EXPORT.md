# Cross-format export

Open **Export** next to **Open file** in the header and choose **Export C3D** or
**Export H5** to export the current recording. The source format is listed first
and marked **(source)**. Same-format export uses the existing source-preserving path immediately.
Cross-format export first shows **Will export**, **Changed or omitted**, and any
errors. The **Changed or omitted** list shows changed representations before
omissions; concrete compatibility issues are reported without repeating a generic
raw-tree omission notice. Accepted surveyed-corner deviations and omitted H5
event-frame provenance/icons/flags do not get separate warnings. The introductory
format-differences notice and this mapping still apply. Errors disable exporting.
Review the report and choose **Export C3D/H5**, or use Cancel/Escape to leave the
recording unchanged. Export is disabled while a crop selection is awaiting Crop
or Cancel crop, and while an import/export is running.

Conversion uses the current edited/cropped MotionData. Format selection, review
and export do not enter undo history or change scientific arrays/dirty state.
The immutable source file stays intact. Cross-format names replace the extension:
`trial.c3d` → `trial.h5`, `trial.h5/hdf5` → `trial.c3d`. Same-format names keep
`_copy`, `_edited` or `_cropped` as before. Processing and export are local.
**Export prepared** means the browser received the generated file; it does not
confirm a completed disk save or clear Modified.

## Four export paths

| Path      | Writer and preservation                                                                                                                                                                                    | Main limits                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3D → C3D | Source-preserving: unchanged output is byte-identical; modified output copies raw point/analog records, encoding, units, calibration and unrelated parameters, updating selected frames, labels and events | Supported C3D encodings only; guarded baseline intervals, EVENT dimensions, parameter capacity and unknown trailing records; proprietary temporal parameters need review                                   |
| H5 → H5   | Source-preserving: unchanged output is byte-identical; modified output copies the institute hierarchy and supported raw dtypes/attributes, slicing known clocks and applying label/event edits             | Unknown temporal datasets or unsupported HDF5 storage/types can block modified export; chunks/maxshape and unused string padding can change                                                                |
| C3D → H5  | Fresh current institute schema from normalized imported data, with float64 trajectories/analogs, global force quantities, events, explicit clocks and limited subject/provenance metadata                  | Unimported camera bits, raw/vendor parameter trees and acquisition representation are not copied; the fourth trajectory component is NaN; the legacy institute reader does not support this current layout |
| H5 → C3D  | Fresh Intel/IEEE float32 C3D, current labels/events, compatible analogs, validated original TYPE-2/3/4 plates or a per-plate TYPE-2 fallback, plus JE_METADATA                                             | Aligned regular grids and capacity limits; no moving/unresolved plates; residual quantization, possible COP/free-moment loss, omitted quality/bodies/models and unrelated raw trees                        |

Same-format limits are detailed in [cropping/export](CROPPING_EXPORT.md).
The matrix below describes conversion of supported imported fields; it does not
promise preservation of all source file contents or universal reader compatibility.

## Implemented compatibility matrix

**Full** describes supported normalized values, not a lossless copy of the source
file. **Transform** changes representation/units. **Partial** is a reported
limitation. **None** means there is no established mapping.

| Data                                               | C3D → H5                                                                                                                                          | H5 → C3D                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marker XYZ / labels                                | Full: float64 `[markers,4,frames]`, XYZ in mm                                                                                                     | Transform: IEEE float32 XYZ in mm; labels up to 255 UTF-8 bytes                                                                                                                    |
| Residuals / validity                               | Full: separate float64 residuals; negative for invalid points                                                                                     | Partial: validity retained; residuals quantized to a reported packed-byte step; unknown magnitudes become zero                                                                     |
| Point quality                                      | Partial: fourth component unspecified/NaN; unimported camera bits omitted                                                                         | None: Type, Virtual and camera-quality fields omitted                                                                                                                              |
| Source frames / point rate                         | Full: zero-based StartFrame, inclusive EndFrame and actual rate                                                                                   | Transform: raw C3D first frame = MotionData firstFrame + 1; extended TRIAL fields; rate must fit float32 exactly                                                                   |
| Analog values / labels / units / rate              | Full: channel-major float64 values and explicit Time                                                                                              | Transform: float32 samples with verified original effective scale/offset when available, otherwise identity encoding; one aligned integer point-rate multiple required             |
| Force / surface-centre moment / COP                | Full: global N / Nmm / mm matching the current schema                                                                                             | Partial: validated original TYPE-2/3/4 definitions reuse existing channels; derived TYPE-2 fallback reports differing stored COP                                                   |
| Free moment                                        | Full: source vector/scalar with declared moment unit                                                                                              | Partial: original definitions retain compatible reconstructed free moment; derived fallback reports differing values or unverified scalar conventions                              |
| Corners / sensor origin / pose                     | Full: available normalized geometry/offsets in mm                                                                                                 | Partial: static float32 corners retained within geometry tolerances; original origin/calibration retained for reused definitions; fallback origin is zero; pose provenance omitted |
| Events                                             | Full: label/context/description/subject; relative times become absolute Time and source Frame                                                     | Transform: existing EVENT serializer retains current label/time/context/description/subject; max 255 events and 255 UTF-8 bytes per text field                                     |
| Event provenance / flags / icons                   | Current imported values where available; new flags/icons default zero                                                                             | None: original H5 event-frame provenance and icons/flags omitted; current timing retained                                                                                          |
| EMG                                                | No dedicated group inferred from analog names; actual channels remain Analog                                                                      | Partial: mapped channels retained once; compatible dedicated scalar EMG becomes analog; grouping/aliases and incompatible clocks omitted with warnings                             |
| Rigid bodies                                       | Standard supported C3D imports have none                                                                                                          | None: omitted, never fabricated as markers/analogs                                                                                                                                 |
| IK / ID                                            | Standard supported C3D imports have none                                                                                                          | None: results, units and processing metadata omitted, never fabricated as POINT data                                                                                               |
| Subject metadata                                   | Partial: known singleton ID/group/age/sex/height/mass/condition and units; names are not reinterpreted as IDs                                     | Full: known subject values/units in JE_METADATA, including group, arrays and long fields; compatible singleton SUBJECT fields also written                                         |
| Project / file / location / acquisition provenance | Partial: input format, original basename and conversion software; existing project/file/location details, parameter trees and local paths omitted | Full: imported project/file/location fields in JE_METADATA; raw hierarchy and unimported processing/acquisition details omitted                                                    |
| Coordinate metadata                                | Only an explicit known description is copied; screen axes are not a lab convention                                                                | Full: explicit coordinate description in JE_METADATA; scientific lab XYZ unchanged; unresolved plate frames cannot be converted                                                    |

## Units, clocks and limits

Fresh H5 files use the current unversioned institute layout: nested
`MetaData/Project` and `MetaData/FileInfo`, Trajectories/Labeled, expanded Events,
and Analog/ForcePlates where present. No raw C3D parameter tree is embedded.
Positions, residuals, COP and corners are **mm**, force **N**, and internal **Nm**
moment/free-moment values are multiplied by 1000 and declared **Nmm**. The fourth
trajectory component is unspecified and becomes NaN. Optional absent groups stay
absent; missing demographic values are not invented. Provenance contains only the
input format, basename and conversion software. See [H5 schema](H5_FORMAT.md).

H5 Time datasets use the current source origin plus each stream's relative clock.
H5→C3D preserves the zero-based internal source frame and uses the C3D
first-frame/rate origin for event timestamps. An H5 absolute origin that differs
from that convention is reported as changed; relative timing stays aligned.
No interpolation, resampling, padding, filtering or render transforms occur.

C3D rates must fit float32 exactly. General analog channels must be scalar, share
one grid, start with the first point, have regular timestamps and cover every
point-rate subframe. Invalid general analog grids **block** conversion. Unsupported
dedicated EMG and force grids are **omitted with warnings**. There are at most
**255 analog channels including six appended channels per fallback plate**;
parameter sections and browser output buffers also have checked capacity limits.

H5→C3D reports float32 sample precision and packed residual precision. Unknown
residuals, omitted trajectory quality fields and event whitespace trimming are
reported when applicable. Event flags/icons and original frame provenance are
omitted without a dedicated warning. UTF-8 text follows the existing C3D writer convention;
vendor reader support varies. Imported recording metadata uses the documented
custom parameter mapping below; raw H5 hierarchy is not embedded.

### Recording metadata in C3D

C3D permits [custom parameter groups](https://www.c3d.org/HTML/Documents/c3dgroupsandparameters.htm).
H5 → C3D writes the imported, curated recording facts into **JE_METADATA**,
with character parameter **VERSION = 1**. JE Motion Lab restores these fields
on C3D import; other readers can inspect the parameters, but may not display
this application-specific mapping automatically.

| Imported field                                                  | JE_METADATA parameter                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Subject ID / name / group                                       | SUBJECT_ID / SUBJECT_NAME / SUBJECT_GROUP                                     |
| Subject age / sex / height / mass / condition                   | SUBJECT_AGE / SUBJECT_SEX / SUBJECT_HEIGHT / SUBJECT_MASS / SUBJECT_CONDITION |
| Project / principal investigator                                | PROJECT / PROJECT_PI                                                          |
| Original files / stored source path                             | ORIGINAL_FILES / SOURCE_PATH                                                  |
| File creation local / UTC / last update                         | CREATED_LOCAL / CREATED_UTC / LAST_UPDATED                                    |
| Location latitude / longitude                                   | LATITUDE / LONGITUDE                                                          |
| Explicit lab coordinate description                             | COORDINATES                                                                   |
| Curated creation text / manufacturer / software, when available | CREATED / MANUFACTURER / SOFTWARE                                             |

Each value/units field is JSON `{"values":["..."],"unit":"..."}`; absent
units are omitted. The last two rows use JSON strings. Arrays, units, long text,
Unicode and whitespace are retained exactly as imported, without inventing a
subject association or converting demographic units. Existing source paths are
retained when present in the embedded metadata; no browser or workspace path is
added. Compatible singleton subject fields also use the existing SUBJECT mapping
(SUBJECTID, NAME, AGE, SEX, BODYHEIGHT, BODYMASS, CONDITION and `_UNITS`).
JE_METADATA supplies the complete values when reading these converted files.

JSON uses ASCII escapes for whitespace and non-ASCII characters, split into
ordered character-array chunks of at most 240 bytes. Concatenate the array entries
before JSON parsing. Large arrays continue in numbered parameters (e.g.
SUBJECT_CONDITION, SUBJECT_CONDITION2, SUBJECT_CONDITION3) using the existing
writer's 32,000-byte record budget. The 255-block parameter-section limit still
applies; overflow fails export instead of truncating metadata. Unknown versions
and malformed fields are ignored on import; existing SUBJECT facts remain usable.
Same-format C3D edits/crops preserve these custom parameters.

This mapping covers the normalized fields listed above. Raw parameter trees,
unimported H5 datasets, IK/ID processing details and hardware calibration remain
outside this metadata mapping and are reported separately when relevant.

### Original force-platform channels

When H5 embeds `MetaData/C3DParameters`, conversion first tries the original
TYPE-2/3/4 definition for each plate. Explicit FORCE_PLATFORM:CHANNEL assignments
identify existing analog streams; labels are never used to guess a mapping.
HDF5 attribute dimensions/order are decoded into C3D parameter order. The current
implementation requires original POINT units mm and FORCE_PLATFORM units N;
other original unit conventions use the derived fallback.

Reuse requires stationary compatible geometry and matching current force,
moment, COP and available free moment on the same sample grid. The importer
retains original channel identities; crop and label edits preserve them. Missing,
ambiguous, unsupported or stale definitions fall back independently per plate.
The same checks are repeated using the actual float32 metadata and decoded
sample encoding before reuse is accepted. Source comparisons use absolute limits
of 1e-6 N/Nm and 1e-4 mm plus 1e-7 relative error. Encoded comparisons allow
1e-5 N/Nm and 1e-3 mm plus 1e-6 relative error, including matching NaN validity.
No force threshold, filtering or resampling is applied during these checks.

Validated original TYPE, CHANNEL, ORIGIN, CORNERS, TYPE-4 CAL_MATRIX and TYPE-3
FPCOPPOLY are written. Mixed files use an eight-row CHANNEL mapping with zero
padding for six-channel plates. Existing compatible corrected COP/free moment
is reconstructed from these definitions; it does not receive the fallback's
stored-COP omission warning. Readers must support the original plate type and
COP correction parameters to reproduce those derived quantities.

H5 analog values are already scaled. When the original SCALE/OFFSET encoding can
be represented and verified, samples are inversely encoded before C3D writing;
the C3D reader applies the scale/offset exactly once. GEN_SCALE is normalized to
1 and the effective channel scales are stored. Negative source offsets are
rebased to zero for float-reader compatibility, with decoded values rechecked.
If that encoding cannot be verified, physical float32 samples with identity
scaling are used, and force-platform reuse must still pass the encoded checks.
No original scaling factor is applied a second time to the H5 values.

The authoritative H5 reuses types `[3,3,4,3,3]` and all existing 56 analog channels.
Its original COP polynomial restores plate 1's corrected COP/free moment.
No 30 additional force channels are needed. This recording is checked read-only;
its data are not committed or deployed as a fixture.

### Derived force-plate fallback

The C3D specification supports processed six-axis **TYPE-2** channels with
identity scaling: see [TYPE](https://www.c3d.org/HTML/Documents/forceplatformtype.htm),
[CHANNEL](https://www.c3d.org/HTML/Documents/forceplatformchannel.htm) and
[CORNERS](https://www.c3d.org/HTML/Documents/forceplatformcorners.htm).
This is a derived representation, not a claim about original hardware or raw
acquisition. Original analog channels remain; six derived channels with unique
names and N/Nmm units are appended for each supported plate.

Ordered global corners establish the plate basis. Global force and surface-centre
moment are rotated into that basis, with moment converted to Nmm. ORIGIN and ZERO
are zero. Independent readers reconstruct global force, moment, COP and free
moment from these channels and corners. Preflight verifies float32 geometry/wrench
reconstruction against the COP implied by the source force and moment. Degenerate,
moving, unresolved or incompatible force/moment plates are omitted with their
reason shown. For these fallback plates, original offsets, pose and acquisition calibration are
not reconstructed. This warning applies only to the plates that use the fallback.

Stored H5 COP is not independently encoded in the C3D. When it differs from the
surface-centre force/moment reconstruction, the plate remains included and a
warning identifies the omitted stored COP, differing sample count and maximum
finite difference in mm. This includes corrected or smoothed COP; conversion
does not infer which processing was used. Readers reconstruct COP from the
unchanged force/moment channels (subject to float32 storage precision). At zero
normal force that reconstruction is undefined, even if the H5 stores finite COP.

Stored free moment is also compared with the reconstruction using the new COP.
Differing values, unsupported scalar conventions or derived-series clocks are
reported as omitted without discarding an otherwise compatible plate. Source
COP/Tz arrays are never changed. Use H5 source-format export to preserve them.

### Surveyed corner geometry

C3D CORNERS records the measured global positions in the prescribed quadrant
order. The published definition gives no numerical exact-rectangle tolerance.
The exporter retains those positions and their order, subject to float32 storage;
it does not fit a new rectangle, flatten a corner or silently reorder the plate.
The same corner-edge construction used by
[ezc3d](https://github.com/pyomeca/ezc3d/blob/Release_1.7.0/src/modules/ForcePlatforms.cpp#L243)
provides an orthonormal plate basis, and the four-corner centroid supplies its
translation. This avoids changing the reference used for force/moment/COP.

The following are conservative JE Motion Lab export limits, not C3D requirements:

| Metric                                                        | Maximum accepted deviation                |
| ------------------------------------------------------------- | ----------------------------------------- |
| Any corner angle from 90 degrees                              | 1 degree                                  |
| Separation of the two diagonal midpoints                      | 1% of the shortest edge, capped at 5 mm   |
| Fourth corner distance from the plane through the other three | 0.5% of the shortest edge, capped at 2 mm |

Limits use edge-relative distances rather than absolute lab coordinates.
Nonfinite, degenerate, crossed/nonconvex or incorrectly ordered corners remain
unsupported; geometry beyond these limits is omitted with measured deviations
and limits in the report. Encoded float32 corners must also pass. Accepted
nonideal geometry produces no geometry warning; the float32 COP
reconstruction check remains active. These limits admit the authoritative plates
3 and 4 without modifying their corners. Acceptance by ezc3d is validated; other
vendor readers may impose stricter assumptions.

## Architecture, validation and remaining scope

`exporters/conversion.ts` produces a reusable report and a plan referencing the
current buffers. `semanticH5.ts` and `semanticC3D.ts` create fresh files in the
export worker and repeat the guards. Same-format calls retain `c3d.ts`/`h5.ts` and
the original File. Only cross-format requests clone MotionData buffers into the
short-lived worker; current arrays are never transferred/detached or changed.
The output buffer transfers back as a Blob for local export through the browser. Cancellation
terminates the worker. Peak memory includes the input clone and output file.

`tests/cross-format.test.ts` covers both directions, units, clocks, nonzero and
extended frames, validity/residuals, edits, undo/redo, crop, geometry, source-format
regressions, EMG, corrected COP/free-moment reconstruction and omission/error
reports. The Chromium suite exercises both real conversion workers, exports,
re-import, metadata restored in File Info, corrected-COP warnings and plate retention, mixed channel reuse/fallback, Data Explorer values,
cancelled review, blocked incompatible sampling and unchanged analytics/storage
behavior.

After tests, run `python scripts/validate-cross-format.py` in an environment with
numpy, h5py and ezc3d. It reads generated synthetic files under ignored
`.local/cross-format-validation/`, compares supported samples and prints aggregate
counts. Independent checks cover ordinary, tilted/oblique, cropped/edited,
extended-frame, metadata-rich and corrected-COP/surveyed-corner files. The metadata
case verifies 18 named JSON parameters against imported H5 attributes. A native
TYPE-2/3/4 pair checks existing channel reuse, calibration, original analog encoding
and corrected COP/free moment without added force channels. The corrected case compares against the
force/moment-based reconstruction rather than the deliberately omitted stored
COP/Tz. To check the
local authoritative recording read-only, run
`JE_VALIDATE_REFERENCE=1 npm test -- tests/cross-format.test.ts` (in PowerShell,
set `$env:JE_VALIDATE_REFERENCE = '1'` first). The current check verifies 56 analog channels, original plate definitions and
force/moment/COP/free moment for all five plates. Its generated C3D stays in ignored
`.local/authoritative-force-export.c3d`; no private values enter test assertions.
The installed older institute Python reader still requires
legacy `Location`/`Offset` and cannot read the current `Corners` schema; it was
left unchanged. See [existing reader limitations](H5_VALIDATION.md). ezc3d's known
positive float-residual decoding discrepancy is documented in
[VALIDATION.md](VALIDATION.md); JE Motion Lab residual checks follow the C3D standard.

These checks cover tested synthetic cases, not every vendor variant, very-low-load
COP or arbitrarily large file. Review the conversion report and retain the original
recording/source-format export. Files, filenames, scientific values, metadata and
reports are not uploaded or included in analytics. Existing event-only payloads
and source-format fidelity remain unchanged.

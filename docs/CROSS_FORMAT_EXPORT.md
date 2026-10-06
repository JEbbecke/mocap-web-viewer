# Cross-format export

Choose **Export format** beside **Export** to download the current recording as
**C3D** or current institute **H5**. Each newly loaded file defaults to its source
format. Same-format export uses the existing source-preserving path immediately.
Cross-format export first shows **Will export**, **Omitted or changed**, and any
errors. Errors disable downloading. Review the report and choose **Download
C3D/H5**, or use Cancel/Escape to leave the recording unchanged.

Conversion uses the current edited/cropped MotionData. Format selection, review
and download do not enter undo history or change scientific arrays/dirty state.
The immutable source file stays intact. Cross-format names replace the extension:
`trial.c3d` → `trial.h5`, `trial.h5/hdf5` → `trial.c3d`. Same-format names keep
`_copy`, `_edited` or `_cropped` as before. Processing and downloads are local.

## Implemented compatibility matrix

**Full** describes supported normalized values, not a lossless copy of the source
file. **Transform** changes representation/units. **Partial** is a reported
limitation. **None** means there is no established mapping.

| Data                                    | C3D → H5                                                                                                      | H5 → C3D                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marker XYZ / labels                     | Full: float64 `[markers,4,frames]`, XYZ in mm                                                                 | Transform: IEEE float32 XYZ in mm; labels up to 255 UTF-8 bytes                                                                                                                         |
| Residuals / validity                    | Full: separate float64 residuals; negative for invalid points                                                 | Partial: validity retained; residuals quantized to a reported packed-byte step; unknown magnitudes become zero                                                                          |
| Point quality                           | Partial: fourth component unspecified/NaN; unimported camera bits omitted                                     | None: Type, Virtual and camera-quality fields omitted                                                                                                                                   |
| Source frames / point rate              | Full: zero-based StartFrame, inclusive EndFrame and actual rate                                               | Transform: raw C3D first frame = MotionData firstFrame + 1; extended TRIAL fields; rate must fit float32 exactly                                                                        |
| Analog values / labels / units / rate   | Full: channel-major float64 values and explicit Time                                                          | Transform: physical float32 values, identity scale/offset; one aligned integer point-rate multiple required                                                                             |
| Force / surface-centre moment / COP     | Full: global N / Nmm / mm matching the current schema                                                         | Partial: stationary six-axis TYPE-2 force/moment channels; readers reconstruct COP; differing stored COP is omitted with a warning                                                      |
| Free moment                             | Full: source vector/scalar with declared moment unit                                                          | Partial: readers reconstruct free moment from the wrench and reconstructed COP; differing stored vectors or unverified scalar conventions are omitted with warnings                     |
| Corners / sensor origin / pose          | Full: available normalized geometry/offsets in mm                                                             | Partial: static approximately rectangular float32 corners retained with deviation warnings; derived plates have zero sensor offset; original offset/pose/calibration provenance omitted |
| Events                                  | Full: label/context/description/subject; relative times become absolute Time and source Frame                 | Transform: existing EVENT serializer retains current label/time/context/description/subject; max 255 events and 255 UTF-8 bytes per text field                                          |
| Event provenance / flags / icons        | Current imported values where available; new flags/icons default zero                                         | None: original H5 event-frame provenance and icons/flags omitted; current timing retained                                                                                               |
| EMG                                     | No dedicated group inferred from analog names; actual channels remain Analog                                  | Partial: mapped channels retained once; compatible dedicated scalar EMG becomes analog; grouping/aliases and incompatible clocks omitted with warnings                                  |
| Rigid bodies                            | Standard supported C3D imports have none                                                                      | None: omitted, never fabricated as markers/analogs                                                                                                                                      |
| IK / ID                                 | Standard supported C3D imports have none                                                                      | None: results, units and processing metadata omitted, never fabricated as POINT data                                                                                                    |
| Subject metadata                        | Partial: known singleton ID/group/age/sex/height/mass/condition and units; names are not reinterpreted as IDs | Partial: existing SUBJECT scalar ID/name/age/sex/height/mass/condition and units; group/multiple/overlong fields omitted                                                                |
| Project / file / acquisition provenance | Partial: input format, original basename and conversion software; parameter trees and local paths omitted     | None: richer hierarchy, processing/acquisition provenance, project and location metadata omitted                                                                                        |
| Coordinate metadata                     | Only an explicit known description is copied; screen axes are not a lab convention                            | Partial: scientific lab XYZ unchanged, textual descriptions omitted; unresolved plate frames cannot be converted                                                                        |

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
**255 analog channels including six appended channels per derived plate**;
parameter sections and browser output buffers also have checked capacity limits.

H5→C3D reports float32 sample precision and packed residual precision. Unknown
residuals, unsupported quality/provenance fields and event whitespace trimming are
reported when applicable. UTF-8 text follows the existing C3D writer convention;
vendor reader support varies. No custom groups are invented to encode H5 hierarchy.

### Derived force plates

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
reason shown. Original offsets, pose and acquisition calibration are not reconstructed.

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

The following are conservative JE Motion export limits, not C3D requirements:

| Metric                                                        | Maximum accepted deviation                |
| ------------------------------------------------------------- | ----------------------------------------- |
| Any corner angle from 90 degrees                              | 1 degree                                  |
| Separation of the two diagonal midpoints                      | 1% of the shortest edge, capped at 5 mm   |
| Fourth corner distance from the plane through the other three | 0.5% of the shortest edge, capped at 2 mm |

Limits use edge-relative distances rather than absolute lab coordinates.
Nonfinite, degenerate, crossed/nonconvex or incorrectly ordered corners remain
unsupported; geometry beyond these limits is omitted with measured deviations
and limits in the report. Encoded float32 corners must also pass. Accepted
nonideal geometry gets a per-plate warning, and the existing float32 COP
reconstruction check remains active. These limits admit the authoritative plates
3 and 4 without modifying their corners. Acceptance by ezc3d is validated; other
vendor readers may impose stricter assumptions.

## Architecture, validation and remaining scope

`exporters/conversion.ts` produces a reusable report and a plan referencing the
current buffers. `semanticH5.ts` and `semanticC3D.ts` create fresh files in the
export worker and repeat the guards. Same-format calls retain `c3d.ts`/`h5.ts` and
the original File. Only cross-format requests clone MotionData buffers into the
short-lived worker; current arrays are never transferred/detached or changed.
The output buffer transfers back for a local Blob download. Cancellation
terminates the worker. Peak memory includes the input clone and output file.

`tests/cross-format.test.ts` covers both directions, units, clocks, nonzero and
extended frames, validity/residuals, edits, undo/redo, crop, geometry, source-format
regressions, EMG, corrected COP/free-moment reconstruction and omission/error
reports. The Chromium suite exercises both real conversion workers, downloads,
re-import, corrected-COP warnings and plate retention, Data Explorer values,
cancelled review, blocked incompatible sampling and unchanged analytics/storage
behavior.

After tests, run `python scripts/validate-cross-format.py` in an environment with
numpy, h5py and ezc3d. It reads generated synthetic files under ignored
`.local/cross-format-validation/`, compares supported samples and prints aggregate
counts. Independent checks cover ordinary, tilted/oblique, cropped/edited,
extended-frame and corrected-COP/surveyed-corner files. The corrected case compares against the
force/moment-based reconstruction rather than the deliberately omitted stored
COP/Tz. To check the
local authoritative recording read-only, run
`JE_VALIDATE_REFERENCE=1 npm test -- tests/cross-format.test.ts` (in PowerShell,
set `$env:JE_VALIDATE_REFERENCE = '1'` first). Its generated C3D stays in ignored
`.local/authoritative-force-export.c3d`; no private values enter test assertions.
The installed older institute Python reader still requires
legacy `Location`/`Offset` and cannot read the current `Corners` schema; it was
left unchanged. See [existing reader limitations](H5_VALIDATION.md). ezc3d's known
positive float-residual decoding discrepancy is documented in
[VALIDATION.md](VALIDATION.md); JE Motion residual checks follow the C3D standard.

These checks cover tested synthetic cases, not every vendor variant, very-low-load
COP or arbitrarily large file. Review the conversion report and retain the original
recording/source-format export. Files, filenames, scientific values, metadata and
reports are not uploaded or included in analytics. Existing event-only payloads
and source-format fidelity remain unchanged.

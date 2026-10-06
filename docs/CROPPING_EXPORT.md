# Cropping and local Export

Open a recording and drag the two handles on the timeline slider to select the crop start and end. The highlighted interval is included; the thin white line indicates playback position. Click or drag the track to scrub, preview with Play, then choose **Crop** beside the timeline. Open **Export** next to **Open file** in the header and choose a format to export. Handle readouts show source frames, times and selected duration without editable frame fields or a separate panel. Focus a handle and use arrow keys for single-frame adjustments, Page Up/Down for ten frames, or Home/End for its allowed limits. Handles cannot cross. **Cancel crop** restores the full selection; **Restore original** returns to the imported recording, including after several crops. Export filenames default to `name_cropped.c3d`, `name_cropped.h5` or `name_cropped.hdf5`; the original file is never overwritten.

## One interval convention

`cropMotionData(data, start, end)` accepts zero-based **array boundaries** `[start, end)`, with `0 <= start < end <= frameCount`. A single-frame crop is valid. The end handle represents an exclusive boundary and may be one past the final frame. Slider readouts use source frame numbers: raw one-based C3D numbering, or stored H5 numbering. These are distinct from the playback slider's ordinal frames. Both handles and the playhead share the full recording-interval time axis.

The selected physical interval is `[start / pointRate, end / pointRate)`. At 200 Hz, `[100, 300)` contains 200 point frames and covers one second; a synchronized 2000 Hz channel contributes samples `[1000, 3000)`, exactly 2000 samples. No interpolation, filtering or requantization is performed.

`timeline.duration` retains the viewer's existing **last point timestamp**, `(frameCount - 1) / rate`. The crop summary explicitly displays the **recording interval**, `frameCount / rate`. A 200-frame crop at 200 Hz therefore has point timestamps 0 through 0.995 s and an interval length of 1.000 s, including analog subframes before the exclusive end. This distinction is intentional.

Each `Series` is cropped using explicit `times` when present, otherwise its own `rate` and `startTime`: select sample timestamps within the interval, retain their values, and subtract the crop start from the time origin. Integer sample boundaries tolerate only floating-point arithmetic noise. Static plate geometry remains static. Dynamic geometry, forces, moments, COP and free moment use their own time axes. There is no extrapolation beyond available source samples.

## Frame origins and events

Both formats preserve original source frame numbering. `MotionData.timeline.firstFrame` increases by `start`; viewer time starts again at zero. For C3D, `MotionData.firstFrame` is raw C3D `firstFrame - 1`. Header first/last fields and existing `POINT:FRAMES`, `POINT:LONG_FRAMES`, `TRIAL:ACTUAL_START_FIELD` and `TRIAL:ACTUAL_END_FIELD` are updated. Extended TRIAL fields remain authoritative above frame 65535; header fields saturate at 65535. The importer handles unsigned POINT frame counts and extended counts.

H5 `Trajectories.StartFrame` increases by `start`, `EndFrame` is the inclusive last source frame, and `NumFrames` is the new count. Keeping numbering follows the institute converter's existing zero-based C3D origin and avoids losing acquisition provenance. The authoritative H5 stores trial-clock Time datasets. Export slices them without rebasing absolute timestamps. UI time is relative to the current marker origin. Legacy streams lacking Time retain regular-grid behavior; undocumented timing attributes are rejected instead of ignored.

C3D events outside the half-open interval are removed. Inside events retain their labels, contexts, auxiliary event arrays and absolute source timestamps in the file. The importer subtracts the new frame origin, yielding relative cropped event times. Standard header events are filtered separately, preserving their display flags and short labels. Filtering snaps float32 timestamp representation noise at crop boundaries (relative tolerance `1e-7`, scaled by absolute source time). `EVENT:USED` is authoritative; allocated event arrays keep their dimensions, retained records are compacted and unused entries cleared.

Versioned H5 Events use absolute Time and source Frame rows. Cropping filters every event column and retains original source frames; imported UI times are relative to the cropped recording. Populated unknown event schemas still block crop export.

## Source-preserving exporters

The session retains the local immutable `File` and, after the first crop, label edit or event edit, the original `MotionData`. Undo/redo stores up to 100 small reversible label/event commands; it does not retain full recording snapshots per action. Cropping creates independent typed arrays and a cumulative source interval, clears history and establishes a modified baseline. Restore original discards crops and all label/event edits. See [data labels and history](MARKER_EDITING.md) for lifecycle rules.

Same-format export sends the `File`, cumulative boundaries, current edited labels and any edited events to a short-lived worker. It does not serialize normalized viewer coordinates back into source values. Export supports source-file cropping, label renaming and event editing; it does not perform arbitrary scientific-data editing. Cross-format export uses separate semantic writers and a compatibility review; see [conversion mappings and limits](CROSS_FORMAT_EXPORT.md). Unchanged export is also available and returns the original bytes. Export filenames use `_cropped` after a crop, `_edited` for label/event edits without a crop, and `_copy` for unchanged data. Export preserves edit history and the Modified indicator; preparing an export does not replace the imported source.

**C3D:** the existing browser implementation is a custom DataView parser; no installed C3D library provides writing. Export copies selected interleaved binary point/analog records and retains unrelated parameter records. Integer/float encoding, endianness, packed validity/residual/camera information, analog offset/scale, units, force calibration, descriptions, locked parameters and opaque vendor groups remain intact. Known temporal fields, events and explicitly edited labels are updated. Label/event edits can rebuild and grow the parameter section, relocating data without changing its bytes. No-op export is byte-identical. Existing scientific force calculations are unchanged; raw force channels and their calibration parameters are preserved together.

C3D export limits:

- Import restrictions still apply: DEC/VAX and nonstandard rotation records are unsupported.
- Segmented event arrays (more than 255 events or continuation parameters) and malformed event dimensions are rejected.
- Marker/analog/force-platform labels support 255 UTF-8 bytes per name and continuation parameters within record/block capacity. Optional `FORCE_PLATFORM:LABELS` names round-trip in JE Motion Lab; other readers may display platform numbers instead.
- A crop excluding any active `FORCE_PLATFORM:ZERO` baseline frames is rejected: recalculating with a partial baseline or disabling it would change force interpretation in other readers. `[0,0]` and inactive reversed ranges require no baseline interval.
- Nonzero undocumented records beyond the standard padded data section are rejected. Ordinary trailing padding is regenerated.
- Unknown vendor parameters are preserved byte-for-byte but cannot be interpreted or temporally adjusted. Vendor-specific temporal parameters require manual review. No arbitrary vendor-specific time series are claimed to be supported.

**H5:** the worker copies the existing hierarchy using source values and dtypes. It crops marker trajectories, residuals, Type, camera masks, analog/EMG, force/moment/COP/vector free moment, plate geometry, rigid bodies and model results with an established trial-clock relationship. Current independent IK/ID results are retained unchanged when their relation to trial time is unspecified. Static flags, origin offsets and provenance remain unchanged; matching membership and label aliases follow marker renames. Absolute timestamps and original sample/frame attribute dtypes are retained. Original source attributes are exposed as structured metadata; its hierarchy snapshot describes the original file until export/reimport.

Label edits update the selected collection's `Labels` or group `Name`, matching rigid-body references and nested POINT/ANALOG label aliases. Source group paths and channel/variable row identities stay fixed; IK/ID time rows are excluded from renaming. String storage can widen or become variable-length to preserve the complete label. Numeric datasets, clocks, calibration and unrelated metadata retain their values during label-only export.

H5 export limits:

- Explicit clocks support nonaligned and irregular signal samples. Legacy streams without clocks require crop boundaries aligned to their sample grids.
- Current streams with sample frame metadata can retain a fractional offset from the point grid even without Time; their own StartFrame/EndFrame preserve non-integer rate ratios. Body frame metadata remains independent of the marker source first frame.
- Legacy model streams use the supported absolute-time crop convention and become empty outside the selected interval. Current independent result clocks have no declared trial relationship; Data, Time, NumSamples and opaque processing metadata remain unchanged. No alignment shift is invented.
- Boolean quality datasets and nested provenance attributes retain their FALSE/TRUE int8 enum type. A small generic synthetic template writer seeds the source's groups/boolean fields; HDF5 itself writes their values. It contains no reference bytes or fixed participant paths, and absent optional fields stay absent.
- Edited outputs use fresh storage layout. Current boolean chunks/compression/maxshape are retained; cropped primitive chunks/maxshape may shrink. Unused variable-length string padding can change without altering UTF-8 text. Numeric precision, values, shape conventions, UTF-8 encoding, units and dtypes remain intact for the authoritative schema. Compression is preserved where supported; storage layout is not a scientific value.
- Unknown primitive content survives unchanged, label-only and event-only exports. Unknown nonempty datasets outside MetaData block crop unless timing is classified. Unsupported compound/reference/opaque types, arbitrary enums, null dataspaces, named types and links are not promised for modified export; exports stop when these cannot be copied. Hard-link identity is not guaranteed.
- Legacy sample-major vectors cropped to exactly three samples use component-major orientation to disambiguate [3,3], with physical components preserved.
- A full-range export with no label or event edits returns the exact original bytes, including opaque content.

The original Python H5 `save_data` copies a template then replaces owned streams, but leaves Events and unknown time series untouched. Its C3D `slice_c3d` uses an inclusive end and reconstructs selected groups. This implementation deliberately uses one half-open interval throughout and preserves more raw content; it does not reproduce stale temporal metadata or discard vendor groups.

## Validation and privacy

`tests/crop.test.ts` covers no-op and cropped C3D/H5 re-imports, integer/float/endianness variants, missing markers and residuals, source immutability, repeated crops, physical-time counts, offsets, first/last frames, extended frame origins, parameter/header events, baseline guards, all force quantities, dynamic geometry, Type and static metadata. Synthetic fixtures contain no participant measurements. Optional private tests compare every cropped signal against `cropMotionData` for both local C3D trials and both H5 variants; nothing is committed or deployed from those files.

`npm run test:browser` exercises actual worker exports, default export names, restoration, re-import and frame counts for both formats, while checking runtime errors, network requests and storage. Export itself uses a local Blob for export and sends no analytics event; re-importing an exported file sends a successful-load event. Production CSP permits connections to the application origin and the Cloudflare analytics origin. The smoke check intercepts analytics locally, validates event-only payloads and permits only the visit flag in session storage; no recording data leaves the browser. See [analytics and network behavior](ANALYTICS.md). Import/export workers are terminated on completion/cancellation, releasing WASM and input/output working memory.

Current authoritative-file results, independent h5py comparisons, browser worker tests and the installed Python reader limitation are recorded in [H5_VALIDATION.md](H5_VALIDATION.md).

Format references: [C3D frame counts](https://www.c3d.org/HTML/Documents/readingtheframecount.htm), [TRIAL fields](https://www.c3d.org/HTML/Documents/thetrialgroup.htm), [force baseline semantics](https://www.c3d.org/HTML/Documents/forceplatformzero.htm), [institute H5 schema](H5_FORMAT.md).

See [event visualization and editing](EVENT_EDITING.md) for immutable event operations, relative-second timing, C3D serialization and current and previous supported institute H5 event layouts.

## Unit preservation

Cropping slices scientific values in mm (positions, residuals, geometry and COP), N (force) and Nm (moments). Analog units, rotations and event seconds are unchanged. Export copies original scientific records and their unit metadata together: mm sources stay mm; supported cm/m sources retain their source units on disk and normalize to mm on re-import. No GPU coordinates are exported. See [unit policy](UNITS.md) and `tests/units.test.ts` for known-value round trips.

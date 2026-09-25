# Cropping and local Export

Open a recording and drag the two handles on the timeline slider to select the crop start and end. The highlighted interval is included; the thin white line indicates playback position. Click or drag the track to scrub, preview with Play, then choose **Crop** and **Export** beside the timeline. Handle readouts show source frames, times and selected duration without editable frame fields or a separate panel. Focus a handle and use arrow keys for single-frame adjustments, Page Up/Down for ten frames, or Home/End for its allowed limits. Handles cannot cross. **Cancel crop** restores the full selection; **Restore original** returns to the imported recording, including after several crops. Downloads default to `name_cropped.c3d`, `name_cropped.h5` or `name_cropped.hdf5`; the original file is never overwritten.

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

The session retains the local immutable `File` and, after the first crop, the original `MotionData`. Only original and current datasets are retained; there is no undo stack. Cropping creates independent typed arrays and a cumulative source interval. Export sends just the `File` and cumulative boundaries to a short-lived worker. It does not serialize normalized metre/Float32 viewer coordinates back into source values. Export supports source-file cropping and event editing; it does not perform arbitrary scientific-data editing or C3D/H5 conversion. Unchanged export is also available and returns the original bytes.

**C3D:** the existing browser implementation is a custom DataView parser; no installed C3D library provides writing. Export copies the original header/parameter region and selected interleaved binary point/analog frame records. Integer/float encoding, endianness, packed validity/residual/camera information, analog offset/scale, units, labels, force calibration, descriptions, locked parameters and opaque vendor groups remain intact. Only known temporal fields/events change. No-op export is byte-identical. Existing scientific force calculations are unchanged; raw force channels and their calibration parameters are preserved together.

C3D export limits:

- Import restrictions still apply: DEC/VAX and nonstandard rotation records are unsupported.
- Segmented event arrays (more than 255 events or continuation parameters) and malformed event dimensions are rejected.
- A crop excluding any active `FORCE_PLATFORM:ZERO` baseline frames is rejected: recalculating with a partial baseline or disabling it would change force interpretation in other readers. `[0,0]` and inactive reversed ranges require no baseline interval.
- Nonzero undocumented records beyond the standard padded data section are rejected. Ordinary trailing padding is regenerated.
- Unknown vendor parameters are preserved byte-for-byte but cannot be interpreted or temporally adjusted. Vendor-specific temporal parameters require manual review. No arbitrary vendor-specific time series are claimed to be supported.

**H5:** the worker copies the existing hierarchy using source values and dtypes. It crops marker trajectories, residuals, Type, camera masks, analog/EMG, force/moment/COP/vector free moment, plate geometry, rigid bodies and IK/ID results with their actual time domains. Static flags, origin offsets, metadata and membership labels remain unchanged. Absolute timestamps and original sample/frame attribute dtypes are retained. Original source attributes are exposed as structured metadata; its hierarchy snapshot describes the original file until export/reimport.

H5 export limits:

- Explicit clocks support nonaligned and irregular signal samples. Legacy streams without clocks require crop boundaries aligned to their sample grids.
- Model streams outside the selected physical interval become empty; they are never shifted to create overlap. The supplied reference has this condition.
- Boolean enums are preserved using tiny, empty, synthetic HDF5 templates for the three optional quality fields. h5wasm cannot create enum types itself, but can resize/write the existing types. Templates are independent of participant data, support all optional combinations and arbitrary valid dimensions, and are reproducible with `scripts/create-h5-boolean-seeds.py`.
- Edited outputs use fresh storage layout. Boolean chunk dimensions and maximum extents change; cropped dataset chunks may shrink. Numeric precision, values, shape conventions, UTF-8 encoding, units and dtypes remain intact for the authoritative schema. Compression is preserved where supported; storage layout is not a scientific value.
- Unknown primitive content survives unchanged and event-only exports. Unknown nonempty datasets outside MetaData block crop unless timing is classified. Unsupported compound/reference/opaque types, arbitrary enums, null dataspaces, named types and links are not promised for modified export; exports stop when these cannot be copied. Hard-link identity is not guaranteed.
- Legacy sample-major vectors cropped to exactly three samples use component-major orientation to disambiguate [3,3], with physical components preserved.
- A full-range export with no event edits returns the exact original bytes, including opaque content.

The original Python H5 `save_data` copies a template then replaces owned streams, but leaves Events and unknown time series untouched. Its C3D `slice_c3d` uses an inclusive end and reconstructs selected groups. This implementation deliberately uses one half-open interval throughout and preserves more raw content; it does not reproduce stale temporal metadata or discard vendor groups.

## Validation and privacy

`tests/crop.test.ts` covers no-op and cropped C3D/H5 re-imports, integer/float/endianness variants, missing markers and residuals, source immutability, repeated crops, physical-time counts, offsets, first/last frames, extended frame origins, parameter/header events, baseline guards, all force quantities, dynamic geometry, Type and static metadata. Synthetic fixtures contain no participant measurements. Optional private tests compare every cropped signal against `cropMotionData` for both local C3D trials and both H5 variants; nothing is committed or deployed from those files.

`npm run test:browser` exercises actual worker exports, default download names, restoration, re-import and frame counts for both formats, while checking runtime errors, network requests and storage. Export uses a local Blob download; no network API is involved. Production `connect-src 'none'` remains unchanged. Only bundled application scripts/styles are requested. Both workers are terminated on completion/cancellation, releasing WASM and input/output working memory.

Current authoritative-file results, independent h5py comparisons, browser worker tests and the installed Python reader limitation are recorded in [H5_VALIDATION.md](H5_VALIDATION.md).

Format references: [C3D frame counts](https://www.c3d.org/HTML/Documents/readingtheframecount.htm), [TRIAL fields](https://www.c3d.org/HTML/Documents/thetrialgroup.htm), [force baseline semantics](https://www.c3d.org/HTML/Documents/forceplatformzero.htm), [institute H5 schema](H5_FORMAT.md).

See [event visualization and editing](EVENT_EDITING.md) for immutable event operations, relative-second timing, C3D serialization and the supported versioned institute H5 event schema.

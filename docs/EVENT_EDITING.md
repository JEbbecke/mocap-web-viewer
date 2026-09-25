# Event visualization and editing

Click a timeline event to edit it, or move playback and choose **Add Event**. Save applies label, time, context, description and subject changes. Delete requires **Confirm delete event**. Events appear as compact markers immediately above the time bar; close events occupy narrow lanes with vertical scrolling. Hover shows full labels/times, and the Events selector provides access to every event. Context Left is red, Right (also the spelling Rigth) is green, and other contexts are orange; matching ignores capitalization and surrounding whitespace. Export and Restore original become available after edits without requiring a crop. Restoration discards both crops and event edits.

## Architecture and timing

MotionData.events is authoritative. Immutable operations in motion/events.ts add, update, delete and sort by time, preserving equal-time order. The session retains originalData and marks source.eventsEdited. sourceIndex identifies the original C3D event row for opaque metadata preservation; it is not editable. React holds only the editor draft. No server or persistence is involved.

MotionEvent.time is unrounded relative seconds from the current recording's first sample. No independent frame value is stored. The editor derives C3D source frame as firstFrame + time * rate + 1, matching one-based header numbering. Fractional frames represent subframe timing. Playback uses zero-based array indices; new events default to frame / rate. Valid editing times are in [0, frameCount / rate), including the last sample interval. The event track shares the crop/playback boundary axis.

Cropping retains events in the half-open crop interval with the existing float32 boundary tolerance, then subtracts the crop start time. Repeated crops accumulate source boundaries. The worker receives current events only when edited, together with cumulative crop boundaries. Crop-only and unchanged exports retain the existing path.

## C3D

Import reads EVENT labels, contexts, times, descriptions and subjects. Legacy header fallback applies when EVENT:USED is absent; an explicit zero means no parameter events. Export rebuilds USED, TIMES, LABELS, CONTEXTS, DESCRIPTIONS and SUBJECTS. Absolute seconds are current relative time + (original.firstFrame + cropStart) / rate, serialized as float32 whole minutes and remaining seconds. Reimport subtracts the output frame origin. See the [C3D specification](https://www.c3d.org/docs/C3D_User_Guide.pdf).

Parameter storage grows when needed, updating header and POINT:DATA_START. Scientific sample bytes are copied without requantization. Unrelated records, including EVENT_CONTEXT and vendor groups, are copied; owned parameter descriptions and lock flags are retained. Opaque per-event arrays follow original row identity through ordering/deletion. New icon IDs/generic flags default to zero when present. Adding events with unknown per-event arrays fails explicitly rather than inventing values. No-edit full-range export remains byte-identical.

Edited exports clear legacy header event slots and use full-label EVENT parameters, avoiding stale duplicates. Header-only readers cannot display edited events. Crop-only header behavior is unchanged. Limits: 255 events, 255 UTF-8 bytes per text field, signed parameter record-offset capacity, and 255 parameter blocks. Segmented EVENT arrays are rejected on export. Proprietary parameters containing offsets or undocumented timing require vendor validation. C3D's float32 storage precision remains a format limitation; UI editing does not round times.

## H5 limitation

There is **no established institute H5 event schema**. Rechecked sources: docs/H5_FORMAT.md, sibling ibo-biomech/handlers/h5Handler.py (load_data/save_data) and biomech_io/file_converter.py. The converter creates an empty Events group, loading ignores events, and saving preserves the group opaquely. No timing/label datasets are defined.

H5 event editing is disabled with an explanation. The worker rejects event replacement for H5. Nonempty Events datasets or attributes produce an import warning. Full-range H5 export retains original bytes; cropping nonempty Events is still rejected because timestamps cannot safely be rebased. Event CRUD round trips require a documented schema and reference fixture. No new schema or event-only format is introduced. Existing empty-Events H5 crop round trips remain covered.

## Validation and manual checks

Tests cover immutable CRUD, chronological/equal-time ordering, timeline mapping, source frames, validation, dirty state/restoration, repeated crops, boundary exclusion, parameter growth, and edited C3D round trips across synthetic encodings. Existing crop tests cover H5 preservation and nonempty Events rejection. Browser smoke exercises add/edit/export/reopen/delete via the real worker alongside playback, crop and H5 checks.

Before a PR, check crowded/equal-time labels, keyboard editing, crop before/after edits, and restoration. Reopen edited downloads in the institute viewer and an independent C3D reader; compare labels, timing, contexts, descriptions, subjects and scientific signals. Verify H5's unsupported-events explanation. Synthetic event fixtures contain no participant measurements. Private references/downloads stay in ignored local locations.

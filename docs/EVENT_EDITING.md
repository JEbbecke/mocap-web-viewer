# Event visualization and editing

Click an event in the timeline or Data tab to seek to it and open its editor, or
move playback and choose **Add Event** beside Apply crop. The Events selector
below Add Event provides access to every event. **Save event** applies label,
time, description, context and subject for C3D and current institute H5.
**Delete event** opens inline confirmation: **Confirm delete event** commits it;
**Keep event** returns to editing. Restore original discards crops, marker
deletions, label renames and event edits, and clears history. Export is available
with or without edits/cropping, subject to the existing format guards.

## Marker layout and compact mode

Events share the scrubber's exact time axis, immediately above the bar. Left
events are red in the upper lane; Right events are green in the lower lane.
General/other contexts use yellow diamonds in available lane space. Matching
ignores capitalization and surrounding whitespace and accepts the historical
`Rigth` spelling. Hover shows the event label, context and time.

**Compact event markers** in Trial Inspector → Display defaults unchecked. It
uses a single lane without changing event data, timing or the selected editor.
Unchecking restores the context-aware two-lane layout. This is an in-memory
display preference; it does not enter history or file export.

Both modes cluster only colliding visible marker/badge boxes at the current
track width. A merged badge replaces its members' boxes, avoiding unnecessary
transitive chains between hidden members. Resizing recomputes layout without
changing timestamps. A cluster opens a bounded, scrollable event list, preserving
every original event and its metadata. Arrows/Home/End navigate the list;
Enter/Space chooses an event; Escape closes and restores focus. Outside click or
layout/mode changes dismiss the list. The Events selector remains an alternative
for crowded tracks.

## Editor interaction

The editor appears below the stable Timeline controls, taking space from the
Viewer/table before the Signal Inspector. Content-sized fields and stable action
slots wrap to the available panel width. Only Add automatically focuses the label
field. Switching to another event with a changed draft prompts to keep editing or
discard it; input validation stays inline. Cancel discards the draft. Text editing
and native undo keep priority over application shortcuts.

Time text is presented compactly at a precision appropriate to the point rate.
Saving an unchanged displayed time retains its exact original timestamp; explicit
time edits use the entered numeric seconds. Source-frame readouts retain the
format's frame origin and subframe timing.

## Architecture and timing

Data-tab event clicks and timeline event clicks share `openSessionEvent`: both
pause playback, seek to the event frame and request the same editor. Drafts remain
local to React; closing, seeking and opening events do not enter edit history.
Loading/restoring data, cropping and committed edits clear stale editor selection.

MotionData.events is authoritative. Immutable operations in motion/events.ts add, update, delete and sort by time, preserving equal-time order. Each committed edit participates in shared [undo/redo history](DATA_EDITING.md), retaining only the affected row and its positions. The session retains originalData, tracks a clean revision and restores source.eventsEdited on undo. sourceIndex identifies the original source event row for opaque metadata preservation; it is not editable. React holds only the editor draft. Event editing is local and in memory; event labels, times and other recording metadata are never sent to [usage analytics](ANALYTICS.md).

MotionEvent.time is unrounded relative seconds from the current recording's first sample. No independent editable frame value is stored; optional imported source frames remain provenance. The editor derives C3D source frame as firstFrame + time * rate + 1, matching one-based header numbering; H5 uses firstFrame + time * rate. Fractional frames represent subframe timing. Playback uses zero-based array indices; new events default to frame / rate. Valid editing times are in [0, frameCount / rate), including the last sample interval. The event track shares the crop/playback boundary axis. Timeline end time separately reports the last sample timestamp, (frameCount - 1) / rate.

Cropping retains events in the half-open crop interval with the existing float32 boundary tolerance, then subtracts the crop start time. Repeated crops accumulate source boundaries. The worker receives current events only when edited, together with cumulative crop boundaries. Crop-only and unchanged exports retain the existing path.

## C3D

Import reads EVENT labels, contexts, times, descriptions and subjects. Legacy header fallback applies when EVENT:USED is absent; an explicit zero means no parameter events. Export rebuilds USED, TIMES, LABELS, CONTEXTS, DESCRIPTIONS and SUBJECTS. Absolute seconds are current relative time + (original.firstFrame + cropStart) / rate, serialized as float32 whole minutes and remaining seconds. Reimport subtracts the output frame origin. See the [C3D specification](https://www.c3d.org/docs/C3D_User_Guide.pdf).

Parameter storage grows when needed, updating header and POINT:DATA_START. Scientific sample bytes are copied without requantization. Unrelated records, including EVENT_CONTEXT and vendor groups, are copied; owned parameter descriptions and lock flags are retained. Opaque per-event arrays follow original row identity through ordering/deletion. New icon IDs/generic flags default to zero when present. Adding events with unknown per-event arrays fails explicitly rather than inventing values. No-edit full-range export remains byte-identical.

Edited exports clear legacy header event slots and use full-label EVENT parameters, avoiding stale duplicates. Header-only readers cannot display edited events. Crop-only header behavior is unchanged. Limits: 255 events, 255 UTF-8 bytes per text field, signed parameter record-offset capacity, and 255 parameter blocks. Segmented EVENT arrays are rejected on export. Proprietary parameters containing offsets or undocumented timing require vendor validation. C3D's float32 storage precision remains a format limitation; UI editing does not round times.

## Current institute H5

The unversioned current reference has parallel Name, Description, Context, Subject,
Time, Frame, GenericFlag and IconID datasets. Context/Subject controls are available.
Frame is an absolute zero-based source point frame; Time is absolute trial seconds.
Flags/icons follow source rows through sorting/deletion; new rows default to zero.
Absent Events can be created in a known current layout. Explicit collection versions
fail clearly; unknown columns cannot be fabricated. Nested C3D EVENT parameters
are original provenance and remain unchanged.

Import subtracts the marker clock origin from Time. Export restores absolute
source time and retains untouched Time/Frame values exactly, recomputing Frame
only after a time edit. Crop filters all event rows and preserves source frames.
Extra current-schema columns follow original row identity; additions cannot
fabricate unknown values. Missing required event columns fail import clearly.

See [H5 schema](H5_FORMAT.md) and [lifecycle validation](H5_VALIDATION.md) for reference-file coverage and limits.

## Validation and manual checks

Tests cover immutable CRUD, chronological/equal-time ordering, timeline mapping, source frames, validation, shared undo/redo, dirty state/restoration, repeated crops, boundary exclusion, parameter growth, and edited C3D round trips across synthetic encodings. `event-clusters.test.ts` covers context lanes, diamonds and local box collisions; `event-time.test.ts` covers compact display without timestamp changes. Existing crop tests cover H5 preservation and rejection of populated unknown event schemas. Browser smoke checks shared editor navigation, add/edit/export/reopen/delete via real workers, responsive editor layouts, unsaved drafts, exact unchanged times, both marker modes, cluster keyboard/focus behavior, resize, crop and history.

Before a PR, check crowded/equal-time labels, keyboard editing, crop before/after edits, and restoration. Reopen edited exports in the institute viewer and an independent C3D reader; compare labels, timing, contexts, descriptions, subjects and scientific signals. Check H5 event descriptions, absolute-time preservation, and cropping before/after an edit. Synthetic event fixtures contain no participant measurements. Private references/exports stay in ignored local locations.

# Data sidebar

Use [Data Explorer](DATA_EXPLORER.md) in the header for detailed numerical tables
and local IK/ID sample inspection. The Data tab retains its quick selection,
visibility and editing controls.

The right sidebar contains Data, Display and File Info. Data replaces the former
Markers tab with collapsible sections for available collections. Markers start
expanded; other sections start collapsed. Each header shows its total count.
Empty collections are omitted.

Double-clicking any non-event label, or using its pencil, opens an inline label editor with Save/Cancel
and validation. Committed labels update this catalog and its search immediately;
visibility and selection retain source-column identity. See
[data labels and undo/redo](DATA_EDITING.md).

Search data filters names across all collections, case-insensitively. Matching
sections expand and show matching/total counts. Clearing search restores the
full collection list. An unmatched query shows a concise empty state. Search
does not change marker visibility or the selected signal.

| Collection      | Interaction                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markers         | Visibility checkbox; name selects the marker and its XYZ plot; double-click or pencil renames it. Show all restores every marker, including those outside the search results.       |
| Analog channels | Name selects the existing primary plot; double-click or pencil renames it. Explicit units and sampling rates appear below names.                                                    |
| Force platforms | Name selects the force plot; double-click or pencil renames it. Global force/plate visibility stays in Display.                                                                     |
| Events          | Single click seeks to the event frame, pauses playback and opens the same editor as clicking its timeline marker. No inline rename action.                                          |
| Rigid bodies    | Name selects the body-position signal when available; double-click or pencil renames the body and its signal label together.                                                        |
| EMG channels    | Name selects the signal; double-click or pencil renames it independently of the Analog collection.                                                                                  |
| IK / ID results | Double-click or pencil renames the variable. Explicit units/rates remain visible; model samples are not loaded or plotted. Time rows stay hidden and retain their source positions. |

The H5 importer normalizes a small IK/ID catalog from `Data` shapes, `Labels`,
per-variable `Units` and explicit `SamplingFrequency`. A case-insensitive `time`
label is excluded from lists and File Info variable counts when labels match
the row count. Missing or mismatched labels use numbered unlabelled entries;
opaque Metadata strings never supply counts, guessed names, units or timing.
The independent model clocks and original datasets remain available to the
source-preserving exporter.

Data sections derive from current MotionData collections; event entries follow
edits/crops. Memoized entry catalogs contain names and selection references, not
copies of numerical arrays. File Info retains recording/subject/provenance
summaries; Display retains global scene controls.

Synthetic tests cover counts, optional collections, cross-category search,
model metadata, time-row exclusion, empty states, label validation and stable
source identities. Rename/history tests verify unchanged samples and C3D/H5
round trips. Browser checks exercise pencil/double-click editing across all
non-event collections, shared event-editor navigation, marker visibility,
plot selection, filtering, keyboard section toggles and the recording lifecycle.

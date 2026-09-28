# Data sidebar

The right sidebar contains Data, Display and File Info. Data replaces the former
Markers tab with collapsible sections for available collections. Markers start
expanded; other sections start collapsed. Each header shows its total count.
Empty collections are omitted.

Search data filters names across all collections, case-insensitively. Matching
sections expand and show matching/total counts. Clearing search restores the
full collection list. An unmatched query shows a concise empty state. Search
does not change marker visibility or the selected signal.

| Collection      | Interaction                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Markers         | Visibility checkbox; name selects the marker and its XYZ plot. Show all restores every marker, including those outside the search results. |
| Analog channels | Name selects the existing primary plot. Explicit units and sampling rates appear below names.                                              |
| Force platforms | Name selects the force plot; rates are shown. Global force/plate visibility stays in Display.                                              |
| Events          | Label seeks to the nearest timeline frame, clamped to the recording; time and context are shown. Editing remains on the timeline.          |
| Rigid bodies    | Name selects the existing body-position signal when available. No new body rendering or visibility control is introduced.                  |
| EMG channels    | Dedicated EMG collection selects existing signals. Analog channels retain their separate source representation even if labels match.       |
| IK / ID results | Individual variable names and explicit units/rates are browsable; model samples are not loaded or plotted.                                 |

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
model metadata, time-row exclusion and empty states. Browser checks exercise
marker selection/visibility and Show all under filtering, plot selection, event
seeking, keyboard section toggles and the existing recording lifecycle.

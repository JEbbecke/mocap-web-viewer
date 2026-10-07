# Data Explorer

Open a C3D or institute H5 recording and choose **Data Explorer** in the header.
It fills the main workspace with a dataset hierarchy and a numerical table. The
timeline stays below it; the same header button changes to **Data Viewer** and
switches back (Escape also works), restoring the viewer, plots and inspector.
The navigation pane can be resized horizontally on desktop. Metadata is always
first. All navigation groups start collapsed; searching expands matching groups
so their datasets are immediately accessible.
The existing Data tab remains the place for visibility, selection and relabeling;
File Info remains the recording summary.

The Explorer is read-only. Opening it, searching, selecting cells, following
playback and copying values do not change scientific arrays, modified state or
undo/redo history. Committed label/event edits and crops appear immediately from
current MotionData. Editing stays in the existing dedicated interfaces.

## Available data

Only available categories and optional fields appear:

| Category                | Inspection                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trajectories            | Each marker's index, current/source frame, time, XYZ, validity, optional residual and source quality/virtual/camera flags                          |
| Analog                  | Each channel's own sample count, clock, scaled scientific value and declared unit                                                                  |
| Force Platforms         | Force, moment, COP, scalar or vector free moment; geometry with corners, position and row-major rotation matrices where present                    |
| Events                  | Label, relative time, continuous current/source frame coordinates, optional context/description/subject/flags and original source-frame provenance |
| Rigid Bodies            | Body positions and row-major rotation matrices on their own clocks; body name and marker membership                                                |
| EMG                     | Dedicated EMG channels, referencing existing buffers shared with analogs where the importer maps them                                              |
| IK Results / ID Results | Selectable variables, own sample/time/value/unit; a labelled `time` row is used as a clock and omitted from variables                              |
| Metadata                | File, acquisition, data counts, subject, project, provenance, location, coordinate system and supported schema facts                               |

Dataset details show units, rate, clock, counts and relevant provenance. Plate
details also show name, source type when available, coordinate frame and sensor
origin. Time-dependent geometry has separate tables so its clock and spatial
units cannot be confused with force samples. One-sample static geometry has no
time column. Rotation matrices are dimensionless; no Euler conversion is made.
Body quality fields are unavailable in the current MotionData model.

Metadata is curated key/value data. Embedded provenance describes the source;
live counts describe the current recording. Unknown source trees and large binary
arrays are not exposed as JSON.

## Values, units and clocks

Primary tables show the normalized scientific values used by JE Motion Lab, rather
than raw file bytes or ADC counts. Positions, residuals, COP and geometry are
**mm**, forces **N**, moments/free moments **Nm**, and time **s**. Analog and EMG
retain their source-declared units and scaling. Force tables read imported values
without recalculation. Source-preserving export retains its existing behavior.

Marker **Index** is zero-based within the current array. **Current frame** is
one-based within the current recording. **Source frame** restores C3D's one-based
source numbering or H5's zero-based source numbering, including the crop offset.
Marker time starts at zero for the current recording. Event frames are continuous
point-frame coordinates; subframe events retain their timing. Original H5 event
frames, when present, are separately labeled provenance and can differ after
editing. **Seek to event** rounds/clamps to an available playback frame without
opening the editor.

Analog, EMG, force, geometry and body times use their own explicit timestamps, or
their own start time and rate. Playback highlighting selects the nearest physical
sample within that clock's range. It never uses a point index as an analog index.
Highlighting is passive; **Follow playback** optionally scrolls to that sample.
It defaults off. Invalid markers keep stored coordinates and residuals visible
alongside **Valid: No**. Missing values display `—`; NaN displays `NaN`.

H5 model samples remain backed by the immutable local source File. A short-lived
worker reads at most **200 samples of one variable and its clock** with hyperslabs.
The UI exposes no HDF5 tree. Previous/Next and Go to sample navigate the result.
Current institute H5 results retain their independent model
times and all samples after crop; they have no playback highlighting/following.
Missing model clocks display NaN times, with unknown units kept explicit. Missing
or unsupported model structures produce a local inspection message.

IK per-variable source units take precedence. With `inDegrees=yes/no`, an exact,
tested list of standard OpenSim Gait2392 rotation coordinates can display deg/rad.
The mapping follows the [OpenSim reference model](https://github.com/opensim-org/opensim-models/blob/master/Pipelines/Gait2392_Simbody/OutputReference/subject01_simbody.osim)
and its [rotation/translation distinction](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53089256/Coordinate+Controls+and+Poses).
This convention is an inference for recognized standard names, identified in
dataset details; it does not classify custom coordinate names. Translational units
remain unknown without explicit source units. Renaming a variable preserves its
imported coordinate classification. ID never infers units from names. No model
values are converted or relabeled as canonical spatial values.

## Table controls and performance

Search matches dataset names and category/parent names, never numeric samples.
Each result identifies its category. Tables scroll vertically/horizontally with
sticky headers and aligned numeric columns. Click selects one cell, Shift-click
selects a rectangular range, and Ctrl/Cmd-click adds or removes individual cells.
Click a column header to select its whole column. Tab focuses cells; Enter/Space
selects the focused cell and Shift+arrow keys extend a range. Native scrolling
keys work within the table. The active cell reveals its complete exact value
below the table, including long metadata or descriptions.
Rows and columns containing selected cells receive a subtle tint, including their
column headings. Selected cells keep the stronger highlight.

Finite decimals display up to 12 significant digits. Tooltips, **Copy selected
cell(s)**, **Copy selected column(s)**, **Copy selected row(s)** and **Copy full
table** use the exact JavaScript number string (up to stored precision). Row copying
includes every column for all rows containing selected cells. Column copying
includes every row for all columns containing selected cells. These scopes are
deduplicated and ordered as in the table, with column headings included.
**Copy full table** copies every row and column in the selected dataset, regardless
of selection or scrolling. Full-table and selected-column copies of H5 model
results include all pages; selected-cell/row copies use the selected loaded rows.
Multiple cells copy in table order as tab-separated rows, with gaps left blank and
entirely unselected rows/columns omitted. Multiline metadata is flattened in table
copies; single-cell copies preserve the complete string.

Ctrl/Cmd+C copies the selected cells when the table has focus, without needing
clipboard-button permissions. Normal browser text selection still works and takes
precedence when copying highlighted text; that uses displayed precision. Use the
buttons or exact-value panel for full precision. Selection stores only coordinates
and ranges, including for whole columns. Numerical data are materialized as text
only for explicit copy actions. No CSV export or numerical editing is added.

Regular MotionData tables window fixed-height rows, with a small overscan. Only
viewport rows are materialized, regardless of total sample count. Row accessors
reference original typed arrays; complete arrays are not converted to row objects
or duplicated into React state. The selected model page keeps only two bounded
typed buffers outside React state; its worker terminates after each request and
on cancellation/unmount. Large dataset catalogs still scale with dataset count.
Full-model clipboard copies read successive bounded pages in a separate local
worker, retain only small numerical slices, and accumulate the requested clipboard
text. Switching datasets, pages or files cancels that operation. Ordinary table
copies also create clipboard text only when requested. Large clipboard text uses
memory proportional to the amount being copied; it is not kept in React state.
Browser validation covers a synthetic 200,000-sample analog, scrolling to its last
sample, sticky headers, copy, playback and a 1366×768 laptop layout. This is not a
general memory/performance guarantee for arbitrarily large HDF5 datasets: HDF5
compression may require decoding chunks larger than a requested slice.

Unimported custom H5 arrays, nonstandard C3D rotation records, raw ADC/file bytes,
undeclared model units and unsupported quality representations are not meaningfully
inspected. No files, measurements, metadata or clipboard contents are uploaded,
persisted in browser storage, or included in analytics.

# Architecture

```text
Local File → short-lived module Worker → C3D or institute H5 importer
                                      ↓
                                validated MotionData
                                      ↓ transferable arrays
                         Zustand session + playback clock
                           ↙          ↓           ↘
                    R3F / Three.js  timeline     uPlot / inspector
```

MotionData is format-independent: a regular point timeline with source frame origin, frame-major contiguous marker XYZ in millimetres, validity/residuals, original-rate analog channels, original-rate global forces (N), moments (Nm), COP/corners (mm), events in relative seconds and source warnings. Geometry carries its own rate. Scene objects share one normalized rendering path; the local-frame resolver additionally requires a declared global pose or an established source corner convention. Unknown force frames are a general data quality state, not an H5 rendering branch.

Importers validate magic, schema, sizes and rates. C3D binary parsing is isolated; unsupported processors/features fail explicitly or omit only the affected force platform with warnings. HDF5 uses bundled h5wasm in a Worker with a local File mounted through WORKERFS. The worker is terminated after completion or cancellation; arrays transfer rather than clone. C3D needs one input ArrayBuffer plus normalized arrays temporarily. HDF5 decompresses each dataset in WASM and copies it to normalized typed arrays, then closes/unmounts and terminates the WASM heap. The session retains an immutable local File reference for source-preserving export, without persistence.

Cropping lives in `motion/crop.ts`, independent of React and format. It uses half-open point boundaries, crops each signal at its own rate/origin, filters/rebases events and creates independent arrays. The session retains original/current MotionData and cumulative source boundaries, allowing restoration and repeated crops. Crop clears metadata edit history and establishes a modified baseline. Timeline controls share playback state; preview playback stays within the selected interval. Modified state compares the current history revision to the imported clean checkpoint. Reusable reversible commands in `motion/history.ts` cover all Data-tab labels and event rows without retaining scientific arrays; see [edit history](DATA_EDITING.md).

Same-format export sends the original File, source interval, edited labels and any edited events to `export.worker.ts`. `exporters/c3d.ts` copies raw interleaved samples and the parameter region, patching temporal metadata and events. `exporters/h5.ts` copies the institute hierarchy using raw dataset hyperslabs and preserved attributes, updating counts/frame extents. Unsupported temporal schemas fail explicitly. `state/session.ts` exposes `exportFile`, which creates a local Blob URL and uses the standard HTML anchor `download` attribute to offer the exported file through the browser. The worker is cancellable and transfers only the resulting buffer. Same-format requests do not send large MotionData arrays. See [cropping/export conventions and limits](CROPPING_EXPORT.md).

Cross-format export uses separate `semanticH5.ts`/`semanticC3D.ts` writers over the current edited/cropped MotionData. A reusable pure `conversionPlan` supplies a pre-export compatibility report and references existing buffers; the worker repeats its guards. Only cross-format calls clone current arrays into the short-lived worker, preserving the viewer's buffers. New H5 files follow the current nested institute layout. New C3D files use float32 point/analog records, verified original effective analog encoding when available (otherwise identity), and the existing event serializer. H5 import retains embedded original C3D plate/channel identities; `reuseForcePlatforms.ts` verifies current and encoded reconstruction before reusing TYPE-2/3/4 definitions, origins, calibration and COP correction. Incompatible or missing definitions fall back per plate to six derived TYPE-2 channels. Curated recording/subject fields use versioned `JE_METADATA`, restored by C3D import. Format/menu/review state stays in the header's `ExportControl`; **Changed or omitted** orders changes before omissions. No history/dirty changes, resampling or analytics additions occur. See [complete mapping, unit/clock guards and validation](CROSS_FORMAT_EXPORT.md).

Timeline markers and the event editor remain in the scrubber. Add Event and the
Events selector share the right-hand action area beside Crop, independently
reading the same session event-editor request. Export lives beside Open file in
the header and is blocked during busy operations or an unapplied crop selection.

Playback uses requestAnimationFrame and elapsed time at the actual point rate. Only the small timeline/inspector subscribe to frame changes; scene buffers and plot cursor update imperatively. Markers are instanced, connections use one line buffer. All positions keep lab XYZ; Three's camera uses Z up and grid lies on XY. Display GRF scale defaults to 1 mm/N. Temporary render coordinates use 0.001 scene units/mm; camera bounds, marker/plate buffers, COP and labels share this boundary without mutating MotionData. See [unit policy](UNITS.md) for scientific conversions and export semantics. Display threshold is configurable and never edits data.

Plotting materializes a time column and selected component columns, with nulls for gaps. Viewer selects one signal per pane; Explorer selects plottable columns from one dataset, including complete time series beyond the visible table window. Those arrays duplicate selected signals only, are memoized across playback frames, and are released when selection changes. The implementation does not create copies of every analog/force stream at marker rate. C3D marker positions use Float32; H5 marker positions retain Float64, with Float32 buffers for GPU rendering. Force calculations and original-rate analog signals use Float64. Full-series plots consume memory proportional to selected samples; table virtualization does not remove this cost.

Optional [local coordinate systems](LOCAL_COORDINATE_SYSTEMS.md)
are ordinary scene objects owned by the corresponding object lifecycle. The
plate-frame resolver uses declared global poses, or C3D's established ordered-corner
`plateBasis` and surface-centre anchor; arbitrary H5 corner winding is insufficient.
Importers retain each platform's declared C3D type as provenance. The helper
subtracts its type-specific sensor-to-surface displacement after rotating it into
lab space: TYPE-3 X/Y spacing does not move the origin, while TYPE-2/4 use the full
vector. Unknown nonzero ORIGIN semantics omit the helper. Global corners and
scientific pose/signal arrays are unchanged.
Helpers share one physical axis-length constant and the existing render scale,
and update through `useScientificFrame` for live playback and media snapshots.
`RigidBodies` renders stored body positions and rotation columns directly, with
no marker-derived pivots/orientations or parent hierarchy. The source-parent
convention remains a documented validation limit. Their visibility belongs
solely to session display state.

`MediaExportControl` owns one viewer menu with separate `ImageExportControl` and
`VideoExportControl` dialogs. Options/progress remain local UI state.
`ImageExportBridge` waits for this R3F root's next completed render via an after
effect, then `viewer/imageExport.ts` renders the existing scene with a temporary
detached-canvas renderer and cloned camera. This retains the exact frame buffers,
background and live color/tone settings without a second scene, live resize or
persistent renderer. Native-resolution output is composited with an optional
watermark in a 2D canvas, encoded with `toBlob()` and offered through a local Blob
URL. Temporary contexts/canvases are released on success, failure or cancellation.
No scientific worker, session write, history edit or analytics event is involved.
See [image export](IMAGE_EXPORT.md) for projection fitting and browser limits.

Video reuses the image surface, camera fitting, watermark and basename helpers.
A short-lived scene snapshot clones mutable geometry/instance buffers; registered
`useScientificFrame` callbacks update live and export objects with identical
display math. Explicit physical times drive native WebCodecs VP9/VP8 encoding,
independent of wall time. `videoTiming.ts` defines the half-open recorded sample
span and shortened final frame; `webm.ts` writes a narrow video-only container
with microsecond timestamps, durations and seek cues. The playback clock holds
without session writes and resumes without catch-up. Four-frame batches, limits,
cancellation and finally blocks bound resources. There is no stream capture,
remote encoding, encoder dependency or data mutation. See [video export](VIDEO_EXPORT.md).

MoCap files, filenames, metadata and measurements remain local and never enter analytics. Static assets and browser workers are bundled; there are no remote fonts or runtime CDN imports. A separate Cloudflare Worker receives only `visit`, `c3d_loaded` and `h5_loaded` event types for aggregate daily country/event counts in D1. A non-identifying `sessionStorage` flag suppresses repeated visit attempts in a tab session; every successful file load sends a load event. No recording is put in browser storage, URLs or browser history. See [analytics](ANALYTICS.md) for exact triggers and the limits of verifying the separately managed backend.

Production CSP permits connections to `'self'` and `https://je-motion-analytics.jonasebbecke97.workers.dev`; development additionally permits local Vite WebSockets and its inline preamble. Analytics JSON POSTs may require CORS preflights. External scripts, frames, objects and form submissions remain blocked. The event-only payload does not conceal IP addresses or normal request headers from hosting/Cloudflare infrastructure. Offline PWA caching is deferred.

JE Motion Lab's SEO-optimized static landing page is [jemolab.com](https://jemolab.com/), maintained separately from this repository. The React web app is [app.jemolab.com](https://app.jemolab.com/), still hosted on GitHub Pages through a custom domain. Its HTML declares the app URL as canonical. The app's welcome screen and usage totals are separate from the static landing page.

Vite emits static dist assets with a configurable base path and injects the `package.json` version into the footer at build time. GitHub Actions installs lockfile dependencies, runs tests/format checks/typechecks/build with `VITE_BASE_PATH=/` and deploys only dist from main to the custom app domain; it does not deploy the landing page or analytics backend, or publish releases. Private reference files and locally generated validation outputs are excluded from dist; never put them in public assets. See [releasing](RELEASING.md).

See [event visualization and editing](EVENT_EDITING.md) for immutable event operations, relative-second timing, C3D serialization and the current institute H5 event layout. Explicit Series clocks, structured quality/body data and additional named signals keep H5 details at the importer/exporter boundary. The original File backs preservation of unknown data. Layout validation requires the unversioned nested current layout and rejects obsolete versions/geometry. Nested project/file/C3D provenance stays structured. Mapped EMG and body signals share arrays, including after crop. Current event rows retain context, subject and flags. Streams keep their own frame origins; independent model clocks remain unchanged when the trial relationship is unspecified.

The signal inspector offers one or two side-by-side plot panes. Each pane reuses the same chart component, with independent signal selection and zoom and a shared session playback cursor. Layout and the second selection remain local UI state. Removing or collapsing a pane destroys its chart, resize observer and playback subscription; only visible plots materialize signal arrays.

The curated File Info view uses optional importer-normalized `source.info`; raw source metadata remains intact. Rates and counts follow current MotionData, including crops. See [File Info mappings and conventions](FILE_INFO.md).

The [Data browser](DATA_BROWSER.md) builds memoized entry catalogs from current
MotionData and reuses session marker visibility, plot selection and timeline
event-editor requests. H5 model-variable names, explicit units/rates and counts are normalized
into `source.info.modelResults`; model samples and clocks are not loaded for browsing.

The [Data Explorer](DATA_EXPLORER.md) uses memoized descriptors and row accessors
over current MotionData. A fixed-height table window bounds rendered rows without
duplicating scientific arrays. View state stays local to the workspace. H5 model
variables use a separate short-lived local worker with bounded hyperslab reads,
two 200-sample buffers and source row identities; independent model clocks and samples remain unchanged after trial crops. Source
units take precedence, with a conservative tested IK rotation convention retained
as small importer metadata. ID units are never inferred from names.

Additional data-label commands retain small name overrides and source identities. H5 platforms and bodies retain original group paths, and EMG/model variables retain original row indices (including gaps from hidden time rows). Body renames update their copied signal names. The export worker resolves these identities against its source import; it never uses the new display name as a source lookup key.

IK/ID plot descriptors in `src/plots/modelSeries.ts` store catalog/source row
identities, semantic labels and the existing Explorer unit policy. A visible
plot pane requests one scalar column from the local Explorer worker, using the
same validated hyperslab/clock reader. Numerical buffers live in a pane ref,
not session or React selection state; the existing uPlot component renders them
directly. Explicit Time takes precedence over a labelled time row and then
SamplingFrequency. Missing clocks report a local plot error. Importer normalization records `trial-aligned` only when count, corresponding
physical timestamps, declared rate and supplied frame range agree. Aligned
source-backed reads carry a retained sample range and trial origin; repeated
crops update these small descriptors. Independent results retain their original
clock and samples. Plot, Explorer and H5 export consume the same timing fact.
The shared cursor uses trial-relative seconds for aligned results.
Viewer supports one selected signal per pane, with separate unit scales.
`src/plots/series.ts` holds reusable in-memory signal preparation. Selecting or
deselecting a plot never edits MotionData, history or export payloads.

The Signal Inspector uses a compact single-line selector, a reserved 18px status
row and a flex chart region. A ResizeObserver sizes the existing uPlot chart
from the remaining container height, accounting for its legend. Independent
clock information truncates with a full-text tooltip; aligned results show no
independent status. Message presence never changes the chart's bottom boundary.

Crop previews reuse session crop boundaries through `plots/cropPreview.ts` and
`motion/crop.ts`. Two translucent DOM regions in uPlot's overlay layer map
physical time through the current x scale on draw, resize and crop updates.
They ignore pointer events and leave signal arrays untouched. Split panes share
the same boundaries. Retained independent model results have no removal preview.

Explorer header selection lives in session UI state as dataset ID, semantic column
IDs and a Shift anchor, independently of Viewer `plot` and secondary-pane choices.
`explorer/selection.ts` handles modifier ranges and projects headers onto the current
page for existing clipboard/cell highlighting; paging is never a plot input.
`explorer/datasets.ts` annotates eligible scientific columns with generic `PlotColumn`
accessors/labels/units over original buffers. Source-backed scalar columns instead
carry the existing model source/range/origin descriptor. Metadata and clock/index
columns have no plot descriptor.

One `SignalPlot` panel in App selects a view-specific input adapter: Viewer keeps
its dropdowns; `ColumnSignals` maps Explorer IDs to the same `PlotData` representation
via `plots/series.ts`. `SignalChart` owns the only uPlot lifecycle, legend, zoom/reset,
cursor, resize and crop overlays. `useModelSeries` shares full-scalar worker loading
between both adapters, cancels stale requests, and retains transferred buffers in
refs. Arrays materialize only when data/selected components change; playback updates
the shared chart cursor imperatively. No second plot system, dependency or scientific
state/export changes are introduced. Explorer's compact flex layout reserves a
usable table and chart region with `min-height: 0` and the existing panel toggle.

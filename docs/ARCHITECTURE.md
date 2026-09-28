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

MotionData is format-independent: a regular point timeline with source frame origin, frame-major contiguous marker XYZ in millimetres, validity/residuals, original-rate analog channels, original-rate global forces (N), moments (Nm), COP/corners (mm), events in relative seconds and source warnings. Geometry carries its own rate. No renderer chooses behavior from source format. Unknown force frames are a general data quality state, not an H5 rendering branch.

Importers validate magic, schema, sizes and rates. C3D binary parsing is isolated; unsupported processors/features fail explicitly or omit only the affected force platform with warnings. HDF5 uses bundled h5wasm in a Worker with a local File mounted through WORKERFS. The worker is terminated after completion or cancellation; arrays transfer rather than clone. C3D needs one input ArrayBuffer plus normalized arrays temporarily. HDF5 decompresses each dataset in WASM and copies it to normalized typed arrays, then closes/unmounts and terminates the WASM heap. The session retains an immutable local File reference for source-preserving export, without persistence.

Cropping lives in `motion/crop.ts`, independent of React and format. It uses half-open point boundaries, crops each signal at its own rate/origin, filters/rebases events and creates independent arrays. The session retains original/current MotionData and cumulative source boundaries, allowing restoration and repeated crops without an undo framework. Timeline controls share playback state; preview playback stays within the selected interval. Modified state is derived from source crop provenance or source.eventsEdited.

Export sends the original File, source interval and any edited events to `export.worker.ts`. `exporters/c3d.ts` copies raw interleaved samples and the parameter region, patching temporal metadata and events. `exporters/h5.ts` copies the institute hierarchy using raw dataset hyperslabs and preserved attributes, updating counts/frame extents. Unsupported temporal schemas fail explicitly. A Blob download saves a new file locally; the worker is cancellable and transfers only the resulting buffer. No large MotionData arrays cross to the export worker. See [cropping/export conventions and limits](CROPPING_EXPORT.md).

Playback uses requestAnimationFrame and elapsed time at the actual point rate. Only the small timeline/inspector subscribe to frame changes; scene buffers and plot cursor update imperatively. Markers are instanced, connections use one line buffer. All positions keep lab XYZ; Three's camera uses Z up and grid lies on XY. Display GRF scale defaults to 1 mm/N. Temporary render coordinates use 0.001 scene units/mm; camera bounds, marker/plate buffers, COP and labels share this boundary without mutating MotionData. See [unit policy](UNITS.md) for scientific conversions and export semantics. Display threshold is configurable and never edits data.

Plotting materializes a time column and up to three component columns for the currently selected signal, with nulls for gaps. Those arrays duplicate that selected signal only, are memoized across playback frames, and are released when the selection changes. The implementation does not create copies of every analog/force stream at marker rate. C3D marker positions use Float32; H5 marker positions retain Float64, with Float32 buffers for GPU rendering. Force calculations and original-rate analog signals use Float64. No large-file performance guarantee has been inferred from the smaller reference trials.

MoCap files, filenames, metadata and measurements remain local and never enter analytics. Static assets and browser workers are bundled; there are no remote fonts or runtime CDN imports. A separate Cloudflare Worker receives only `visit`, `c3d_loaded` and `h5_loaded` event types for aggregate daily country/event counts in D1. A non-identifying `sessionStorage` flag suppresses repeated visit attempts in a tab session; every successful file load sends a load event. No recording is put in browser storage, URLs or browser history. See [analytics](ANALYTICS.md) for exact triggers and the limits of verifying the separately managed backend.

Production CSP permits connections to `'self'` and `https://je-motion-analytics.jonasebbecke97.workers.dev`; development additionally permits local Vite WebSockets and its inline preamble. Analytics JSON POSTs may require CORS preflights. External scripts, frames, objects and form submissions remain blocked. The event-only payload does not conceal IP addresses or normal request headers from hosting/Cloudflare infrastructure. Offline PWA caching is deferred.

Vite emits static dist assets with a configurable base path and injects the `package.json` version into the footer at build time. GitHub Actions installs lockfile dependencies, runs tests/typechecks/build and deploys only dist from main; it does not deploy the analytics backend or publish releases. Private reference files and locally generated validation outputs are excluded from dist; never put them in public assets. See [releasing](RELEASING.md).

See [event visualization and editing](EVENT_EDITING.md) for immutable event operations, relative-second timing, C3D serialization and the supported versioned institute H5 event schema. Explicit Series clocks, structured quality/body data and additional named signals keep H5 details at the importer/exporter boundary. The original File backs preservation of unknown data.

The signal inspector offers one or two side-by-side plot panes. Each pane reuses the same chart component, with independent signal selection and zoom and a shared session playback cursor. Layout and the second selection remain local UI state. Removing or collapsing a pane destroys its chart, resize observer and playback subscription; only visible plots materialize signal arrays.

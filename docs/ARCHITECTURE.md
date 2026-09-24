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

MotionData is format-independent: a regular point timeline with source frame origin, frame-major contiguous marker XYZ in metres, validity/residuals, original-rate analog channels, original-rate global forces (N), moments (Nm), COP/corners (m), events in relative seconds and source warnings. Geometry carries its own rate. No renderer chooses behavior from source format. Unknown force frames are a general data quality state, not an H5 rendering branch.

Importers validate magic, schema, sizes and rates. C3D binary parsing is isolated; unsupported processors/features fail explicitly or omit only the affected force platform with warnings. HDF5 uses bundled h5wasm in a Worker with a local File mounted through WORKERFS. The worker is terminated after completion or cancellation; arrays transfer rather than clone. C3D needs one input ArrayBuffer plus normalized arrays temporarily. HDF5 decompresses each dataset in WASM and copies it to normalized typed arrays, then closes/unmounts and terminates the WASM heap. Original files are not retained in application state.

Playback uses requestAnimationFrame and elapsed time at the actual point rate. Only the small timeline/inspector subscribe to frame changes; scene buffers and plot cursor update imperatively. Markers are instanced, connections use one line buffer. All positions keep lab XYZ; Three's camera uses Z up and grid lies on XY. Display GRF scale defaults to 0.001 m/N, equivalent to reference mm datasets, and is labelled separately from scientific units. Display threshold is configurable and never edits data.

Plotting materializes a time column and up to three component columns for the currently selected signal, with nulls for gaps. Those arrays duplicate that selected signal only, are memoized across playback frames, and are released when the selection changes. The implementation does not create copies of every analog/force stream at marker rate. Markers use Float32 for GPU-efficient positions; force calculations and original-rate analog signals use Float64. No large-file performance guarantee has been inferred from the smaller reference trials.

Privacy: no backend, uploads, telemetry, persistence, remote fonts, images, or CDN imports. Static assets and workers are bundled. Production CSP forbids connections entirely (WASM is embedded), external scripts, frames, and forms. Dev CSP allows only local Vite connections. No user file is put in localStorage, IndexedDB, caches, URLs or browser history. Offline PWA caching is deferred; architecture remains compatible with app-only caching.

Vite emits static dist assets with a configurable base path. GitHub Actions installs lockfile dependencies, runs tests/typechecks/build and deploys only dist. Private reference files and locally generated validation outputs are ignored and never part of dist.

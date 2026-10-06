# JE Motion Lab

**MoCap Viewer & Editor**

A browser-based, privacy-first motion capture viewer and editor for biomechanics researchers and technically interested users. Inspect recordings in 3D, compare synchronized signals, rename data labels, edit events, crop trials, and download the results in their original format.

Visit the [SEO-optimized static landing page](https://jemolab.com/) or [open the JE Motion Lab web application](https://app.jemolab.com/). The web app is still hosted by GitHub Pages, using `app.jemolab.com` as its custom domain. The landing page is maintained separately from this application repository.

**Motion-capture files are processed entirely locally in the browser. Files are not uploaded to a server.** JE Motion Lab sends anonymous usage events for session visits and successful C3D/H5 loads to a Cloudflare Worker for aggregate country statistics in D1. Analytics payloads contain only an event type, never MoCap files, filenames, labels, metadata or measurements. Normal network information is still visible to hosting and Cloudflare; see [Privacy](#privacy) for the scope and backend verification limits. There are no remote fonts or runtime CDN dependencies.

![JE Motion Lab | MoCap Viewer & Editor with generated example data](docs/screenshot.png)

The screenshot shows the current viewer with generated synthetic test data, not a participant recording.

## Basic usage

1. Open the application and choose **Open file** or drop a recording anywhere. One recording is loaded at a time; imports can be cancelled, and a failed import leaves the previous trial available.
2. Orbit, pan and zoom the 3D view. Select a marker to inspect coordinates, or use the inspector to adjust visibility and force display. Review import warnings before interpreting data.
3. Play, step or scrub the timeline. Select a signal in the signal inspector; use **Split plots** for two independent selections sharing the playback cursor.
4. Click a timeline event to edit it, or choose **Add Event** at the current playback position. Supported fields depend on the source format.
5. In **Data**, double-click any marker, analog, force-platform, rigid-body, EMG, IK or ID label (or use its pencil) to rename it. Clicking an event seeks to its frame and opens the timeline event editor. Header **Undo / Redo** covers all label renames and committed event edits; text inputs keep native undo.
6. Drag the timeline's start/end handles, preview the interval and choose **Crop**. Choose **Export** to download a local copy. **Restore original** discards crops, label renames and event edits; the source file remains unchanged. Cropping clears undo/redo history.
7. Use the header's **Data Explorer** button to inspect numerical tables and metadata. **Data Viewer** switches back to the 3D workspace. Select cells, rows or columns to copy exact values, or copy the full selected dataset.

## Development setup

Use Node.js 22.12+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally http://127.0.0.1:5173. On Windows PowerShell where `npm.ps1` is disabled, use `npm.cmd ci` and `npm.cmd run dev`; no execution-policy change is needed.

## Features

- [Data Explorer](docs/DATA_EXPLORER.md): a wide, read-only workspace for numerical marker, analog, force-platform, event, rigid-body, EMG and IK/ID inspection, structured metadata, dataset search and exact-value copying. Tables use bounded row windows; H5 model variables load local sample pages on demand.
- Inline relabeling for all non-event Data-tab collections, including generated trajectory names, with validation and C3D/H5 round trips. Events use their existing editor. Undo/redo retains up to 100 label/event actions: **Ctrl/Cmd+Z**, **Ctrl/Cmd+Shift+Z**, or **Ctrl+Y** to redo on Windows. See [data labels and history](docs/MARKER_EDITING.md) for identity, connections, format limits and lifecycle rules.
- Use the **Split plots** icon beside the hide toggle in the signal inspector to switch between one and two plots. Split view shows two side-by-side plots with independent marker/force/analog selection and zoom. Both follow the same playback cursor; clicking either plot scrubs the recording. On narrow windows, the split area scrolls horizontally.

- Local `.c3d`, `.h5`, and `.hdf5` loading in a cancellable Web Worker.
- Shared format-independent 3D viewer and playback for both formats.
- Instanced markers, missing-sample handling, residuals, selection and individual visibility. The [Data sidebar](docs/DATA_BROWSER.md) browses available MoCap collections with counted sections, cross-category search, plot selection and event seeking/editing.
- Named marker connection presets for the inspected IBO sets and Plug-in Gait; selectable or disabled. These are display links, not an anatomical model.
- Static and time-varying force-platform geometry, global ground reaction force (GRF) arrows originating at the centre of pressure (COP), and COP points where coordinate conventions are established.
- Force types 2, 3 and 4, including 6×6 calibration and type-3 COP polynomial correction.
- Orbit, pan, zoom, reset, front, side and top camera presets; Z-up lab axes and ground grid.
- True-rate playback, scrubbing, stepping, beginning/end, speed and loop controls.
- Non-destructive timeline cropping, range preview, restoration and local **Export** in the source C3D/H5 format. See [crop conventions and export limits](docs/CROPPING_EXPORT.md).
- Synchronized marker XYZ, force, moment, COP, optional free moment and analog plots, plus institute H5 EMG and rigid-body position signals when present. Scroll up/down over the plot to zoom in/out around the pointer, or drag horizontally to select a zoom range. Click to scrub; double-click or use **Reset zoom** to restore the full time range.
- Arrow toggles in the plot and sidebar headers collapse or expand each panel; a compact edge control remains available to reopen it.
- C3D and versioned institute H5 timeline events with add/edit/delete, format-supported text fields, crop-aware export and restoration. [File Info](docs/FILE_INFO.md) groups recording/acquisition facts, data counts and available subject, project and location metadata; raw source trees stay internal. Import warnings remain visible.
- Explicit scientific units: positions/residuals/COP in mm, force in N, moments in Nm. See the [unit policy](docs/UNITS.md) for import/export boundaries and rendering scale. Display arrow scale defaults to 1 mm/N; threshold defaults to 10 N and changes display only.

Keyboard: **Space** play/pause, **← / →** step, **Home / End** first/last frame, when focus is outside a form control. The timeline shows ordinal frames starting at 1; the marker inspector also shows the source's zero-based frame number.

## Supported formats and limits

| Format       | Supported                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3D          | Intel little-endian and MIPS big-endian; integer and IEEE float point records; parameter labels and continuation labels; scaled signed/unsigned analogs and subframes; residual validity; events; force types 2/3/4 |
| Institute H5 | `Trajectories/Labeled/Data [marker,4,frame]`, Labels and SamplingFrequency; optional analogs/force groups; compressed HDF5; both inspected converter generations                                                    |

DEC/VAX C3D encoding and nonstandard rotation records are explicitly rejected. Unsupported force-platform types are reported and omitted, while marker and analog data remain accessible. Other HDF5 schemas are not supported.

H5 coordinate conventions contain contradictions in the reference exporter. Recognized legacy output keeps its already-global values with a warning. Other unresolved force frames remain available for signal inspection, but require explicit confirmation of stored-global coordinates for spatial force display. Missing legacy marker units assume mm with a warning. Current institute H5 supports nested project/file provenance, expanded event context/subject metadata, explicit clocks, mapped EMG, rigid-body data and quality flags; older supported layouts remain readable. Data lists IKResults and IDResults variables, with counts in File Info; labelled time rows are excluded. Model values are available in Data Explorer through local sample pages, while plots retain their existing supported signals. Their source data remains available for export. Type codes and unprovided coordinate conventions are not guessed. See [H5 format](docs/H5_FORMAT.md) and [open questions](docs/OPEN_QUESTIONS.md).

No general trajectory editing, scientific filtering, format conversion, inferred joint centres, gait-event detection, video, or persistent file storage is included. Marker timelines must be present. Mobile is secondary; current Chromium browsers are the runtime validation target. Large file limits depend on browser memory. There is no service worker yet: a cached tab can keep working, but reliable offline reload/PWA installation is not claimed.

Use a modern desktop browser with WebGL, WebAssembly and module worker support. Chrome is the default browser smoke-test target, with an Edge option; Firefox and Safari compatibility has not been established by the included checks. Hardware acceleration is recommended for 3D rendering.

Exports preserve source values rather than writing normalized display coordinates. Unchanged exports return the original bytes. Modified exports have format-specific limits: C3D event editing supports up to 255 events, force-baseline intervals must survive cropping, and unknown H5 time-dependent datasets or unsupported storage types may block modified export. H5 marker clocks must be regular; other supported signal clocks may be irregular. Rigid-body rotations are retained as structured data, not rendered as an anatomical skeleton. See [cropping/export limits](docs/CROPPING_EXPORT.md), [event editing](docs/EVENT_EDITING.md) and [H5 validation](docs/H5_VALIDATION.md), including the legacy institute reader incompatibility.

C3D data labels support up to 255 UTF-8 bytes; H5 labels have no application-imposed length limit. Force-platform names round-trip in JE Motion Lab through an optional C3D `FORCE_PLATFORM:LABELS` parameter; other readers may still display platform numbers. Renaming markers retains existing preset connections within the session; re-import resolves presets against the exported names. Cropping clears undo/redo; exporting preserves history and the Modified indicator because the original loaded file remains the baseline.

## Architecture

The application is a static TypeScript/React site built with Vite. Three.js, React Three Fiber, and drei provide 3D rendering; Zustand holds session state; uPlot renders signals; and h5wasm reads and writes HDF5 locally. A separate Cloudflare Worker receives anonymous usage events for aggregation in D1; motion-capture data remain entirely local. The Worker and database are managed outside this repository; see [analytics architecture and verification scope](docs/ANALYTICS.md).

```text
local File → Worker → C3DImporter / H5Importer → MotionData
                                                 ├─ shared 3D scene
                                                 ├─ timeline / playback
                                                 ├─ synchronized plots
                                                 └─ inspector
```

`MotionData` contains contiguous typed arrays with validity, original-rate signals, explicit units, independent geometry timing and provenance. Rendering components never branch on C3D/H5. Workers transfer buffers back and terminate to release parser/WASM memory. The small timeline and coordinate inspector subscribe to frame changes; 3D buffers and plot cursor update imperatively.

| Location                                           | Responsibility                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `src/importers/`, `src/exporters/`, `src/workers/` | Format parsing, source-preserving export and background processing |
| `src/motion/`                                      | Shared data model, timing, crop, label/event edits and undo/redo   |
| `src/state/`, `src/playback/`                      | In-memory session and playback clock                               |
| `src/viewer/`, `src/plots/`, `src/components/`     | 3D scene, signal inspector, timeline and editing controls          |
| `tests/`, `scripts/`, `docs/`                      | Synthetic fixtures, validation tools and technical documentation   |

See [architecture](docs/ARCHITECTURE.md), [Python audit](docs/PYTHON_REFERENCE.md), [migration map](docs/MIGRATION.md), [parser decisions](docs/PARSERS.md), and [validation](docs/VALIDATION.md).

## Tests and production build

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

`dist/` is a completely static application. Use HTTP hosting rather than opening index.html as a `file://` URL, because module workers require an appropriate origin.

Scientific tests cover units, frame/time mapping, gaps, binary C3D variants, compressed HDF5, force transformations/calibration/COP and malformed input. Editing regressions cover all label collections, unchanged scientific arrays, undo/redo, dirty-state transitions, source identity and C3D/H5 round trips. Synthetic fixtures contain no participant data.

Private local reference comparisons skip when `.local/reference.json` is absent. If that manifest exists but points to missing original files, `npm test` reports failures. Regenerate the oracle on a machine with the originals; do not commit it or the recordings. For a separately reported run of the portable suite, use `npm test -- --exclude tests/reference.test.ts`; this does not validate private references or turn a failed full run into a pass.

With Chrome installed, run the browser and privacy smoke check after building:

```sh
npm run test:browser
```

For Microsoft Edge, set `BROWSER_CHANNEL=msedge`. This check exercises viewer controls using synthetic C3D/H5 test fixtures, any available local reference files, error recovery, the footer version, request URLs/methods/bodies and browser storage. Analytics requests are intercepted locally to validate event-only payloads without affecting live counts; the check does not validate the deployed Worker or D1. Reports and screenshots stay under ignored `.local/`.

Optional local numerical comparison requires Python with ezc3d/numpy and the original sibling `ibo-biomech` files:

```sh
python scripts/reference-export.py
npm run validate:reference
```

This Python script is a development oracle, never a backend or application dependency. It reads the originals without modifying them and writes only ignored local output.

## GitHub Pages

The included [workflow](.github/workflows/deploy.yml) runs `npm ci`, tests and the typechecked production build. Pushes to `main` deploy only `dist/`; pull requests run checks without deploying. Manual workflow runs deploy only when run on `main`. In **Settings → Pages**, choose **GitHub Actions** as the deployment source. No custom secrets are needed for Pages. This workflow does not deploy the analytics Worker, configure D1 or run the browser smoke check.

The workflow explicitly builds with `VITE_BASE_PATH=/` for the custom app domain, `app.jemolab.com`. Configure that domain in **Settings → Pages → Custom domain**; the separate static landing page at `jemolab.com` is not deployed by this workflow. For a matching local build:

```powershell
$env:VITE_BASE_PATH = '/'
npm.cmd run build
```

Outside CI, the default base is relative (`./`). For a deployment under a repository path, explicitly set `VITE_BASE_PATH` to that path (for example, `/mocap-web-viewer/`) and adjust the workflow too; it does not read a repository Actions variable. The application HTML declares `https://app.jemolab.com/` as its canonical URL. Source measurements, local comparison output, and node_modules are ignored; do not add private files to `public/`, because that directory is copied to the deployed site.

## Privacy

The application footer links to [Privacy](https://jemolab.com/privacy.html) and [Imprint](https://jemolab.com/imprint.html). These external pages are the single source of truth for the privacy policy and legal notice. The information below documents the application's technical behavior.

Motion-capture files remain on your computer and are processed locally in browser workers. MoCap files, filenames, labels, source metadata and measurements are never sent to analytics. Imports and edits live in memory, exports are local downloads, and the application does not persist recordings in browser storage.

JE Motion Lab sends a JSON body containing only `{"event":"visit"}`, `{"event":"c3d_loaded"}` or `{"event":"h5_loaded"}` to `https://je-motion-analytics.jonasebbecke97.workers.dev/event`. A `sessionStorage` flag (`je-motion-visit-counted=true`) suppresses repeat visit attempts on reload within the same tab session; it is not a unique identifier and is not sent. Each successful C3D or H5/HDF5 import sends a load event, including repeated loads of the same file. Failed or cancelled imports do not send load events. Counts therefore represent activity, not unique people or unique files. Analytics is also enabled during local development and preview. Failed requests are not retried, so counts may be incomplete.

The documented backend design uses a Cloudflare Worker to derive approximate country from Cloudflare request information and increment D1 counts by date, country and event type. Country is not read from recording metadata or sent in the application payload. The Worker source, D1 schema and logging configuration are not included here, so this repository alone cannot verify deployed aggregation, stored fields or retention. See [analytics details](docs/ANALYTICS.md).

Anonymous here means that the client creates no user/session identifier, tracking cookie or browser fingerprint. The event body includes no file size, device profile or browser information. HTTP requests still expose connection information such as IP addresses and browser-supplied headers (including browser information and the CORS `Origin`) to the receiving infrastructure. The page sets `no-referrer` to suppress the `Referer` header; it does not conceal the IP address or CORS origin. Hosting and Cloudflare may process or log connection information; this is not a guarantee of anonymity at the network level or of log deletion.

The web app's welcome screen displays aggregate visits, countries and successful MoCap loads from a bodyless GET request to the same Worker's `/stats` endpoint. It appears only while no recording is loaded and is hidden when valid totals are unavailable. Country count is the number of entries in the returned country list; file count uses the combined `files_loaded` total. These client checks cover the web app, not the separately maintained static landing page.

The production CSP uses `connect-src 'self' https://je-motion-analytics.jonasebbecke97.workers.dev`. This permits connections to the application origin and the analytics **origin**, including `/event` and `/stats`. Development also allows local Vite WebSocket connections. Bundled scripts, styles and workers load from the application origin; JSON analytics POSTs may require CORS OPTIONS preflight requests. The CSP restricts connection destinations, not request contents; local file handling and the event-only payload keep MoCap data out of analytics.

Keep private recordings out of Git and `public/`. The existing ignore rules exclude H5/C3D recordings and local validation output; `public/` is copied into every deployed build.

## License

JE Motion is licensed under the [Apache License 2.0](LICENSE). [NOTICE](NOTICE) records attribution to Jonas Ebbecke. Redistributions must comply with the license, including providing a copy of it, preserving applicable copyright and NOTICE attribution, and marking modified files as required by Apache-2.0.

## Citation

For scientific use, please cite JE Motion using the metadata in [CITATION.cff](CITATION.cff). Scientific citation is requested for scholarly credit and is not a condition of Apache-2.0.

## Development status and releases

JE Motion Lab is under active pre-1.0 development. Support is limited to the documented formats and validated conventions; arbitrary vendor variants and general HDF5 files are not claimed. Outstanding format questions are tracked in [OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md).

Published GitHub releases and their tags establish release history. [package.json](package.json) supplies the application version, injected at build time and shown in the footer; the lockfile matches it. See [CHANGELOG.md](CHANGELOG.md) for formal releases and unreleased changes, and [the manual release workflow](docs/RELEASING.md) for Semantic Versioning, release PRs, tags and GitHub Releases. An ordinary feature merge does not require a version bump: the package/footer retain the latest formal release version while changes accumulate under `[Unreleased]`. They advance when the next release is intentionally prepared. The Pages application follows `main` and can be ahead of the latest formal release. The historical package-version mismatch in the first GitHub release is documented in the changelog.

See [event visualization and editing](docs/EVENT_EDITING.md) for immutable event operations, relative-second timing, C3D serialization and current and previous supported institute H5 event layouts. See [authoritative H5 validation](docs/H5_VALIDATION.md) for round-trip results and remaining limits.

# Changelog

Notable changes to JE Motion Lab are recorded here, using a Keep a Changelog-style
structure and Semantic Versioning. Published GitHub releases and their Git tags
establish release history; `package.json` supplies the matching application version.
Changes since the latest formal release remain under `[Unreleased]`.

## [Unreleased]

### Added

- Signal plots now visually de-emphasize data outside the active crop selection.

- IK and ID result time series can now be selected and visualized in the existing plot panes, preserving source variable names, units and model clocks. Results proven aligned with the trajectory timeline crop with the trial; independent results remain intact.

- Optional force-platform local coordinate-system visualization in Display, using declared global poses or C3D corner bases with type-specific measurement-origin placement, synchronized with moving geometry and on by default.
- Optional rigid-body local coordinate-system visualization in Display, using stored position/rotation poses, independently toggled and on by default. Helpers are display-only and follow visible scene elements into image/video exports.

- Browser-local 3D video export using native timestamped VP9/VP8 WebM encoding, 30/60 fps, viewport/1080p resolution, 1×/0.5×/0.25× speed, progress/cancellation and the optional JE Motion Lab watermark.

- High-resolution PNG export of the current 3D scene at viewport, 1920 × 1080 or 3840 × 2160 resolution, with an optional JE Motion Lab watermark and entirely browser-local processing.

- Browser-local C3D→H5 and supported H5→C3D export, with a compatibility review showing included data, changed representations, omissions and blocking errors. Same-format C3D/H5 export keeps the existing source-preserving path. Conversion creates a fresh file from imported data; unsupported mappings are reported rather than guessed. ([#13], [#14])
- Apache-2.0 licensing, author attribution in `NOTICE`, and scientific citation metadata in `CITATION.cff`, with README guidance distinguishing license obligations from requested scientific citation. ([#12])
- Footer links to [Privacy](https://jemolab.com/privacy.html) and [Imprint](https://jemolab.com/imprint.html) give access to the current privacy policy and legal notice. ([#12])
- Read-only Data Explorer workspace with structured numerical marker, analog, force-platform, event, rigid-body, EMG and IK/ID tables, curated metadata, dataset search, playback highlighting, subtle selection row/column highlights, exact cell/range/selected-row/selected-column/full-table copying and bounded table rendering. The header switches between Explorer and Viewer; navigation starts collapsed with Metadata first. H5 model samples load locally in small pages, including complete clipboard copies, without loading full numerical result matrices. ([#12])
- Label assignment/relabeling for markers, analog channels, force platforms, rigid bodies, EMG and IK/ID variables in the Data tab via pencil or double-click, with inline validation and source-preserving C3D/H5 export. ([#9])
- Undo/redo for committed data-label renames and event add/edit/delete, with up to 100 reversible actions per recording, modified-state tracking and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y shortcuts. Native text-field undo and view settings remain separate from data-edit history. ([#9])
- Data sidebar replacing the Markers tab, with searchable, counted sections for available markers, analog channels, force platforms, events, rigid bodies, EMG and IK/ID variables. Marker visibility/selection and Show all are preserved; supported signals open in the existing plot and events seek the timeline. IK/ID variable catalogs exclude labelled time rows; the separate Data Explorer exposes source-backed numerical samples. ([#8])
- App welcome-screen usage summary showing live visit, country and combined MoCap load totals from the analytics `/stats` endpoint; unavailable totals remain hidden. ([#5])
- Anonymous session visit attempts and successful C3D/H5/HDF5 load events, with a per-tab `sessionStorage` visit flag and event-only payloads. Repeated successful loads count again; failed/cancelled imports do not count as loads. ([#5])
- Cloudflare Worker analytics integration for aggregate counts by date, country and event type in D1. Motion-capture files, filenames, measurements and metadata remain local. Backend deployment and verification scope are documented in [docs/ANALYTICS.md](docs/ANALYTICS.md). ([#5])

### Changed

- The Trial Inspector now prioritizes subject, condition and file metadata instead of prominent current-frame marker coordinates.

- Grouped image and video export under one Export media menu with separate configuration dialogs; scientific C3D/H5 export remains in the header.

- Moved Export next to Open file in the header, with C3D/H5 choices inside its button menu. Add Event and the Events selector now share the timeline's right-hand action area beside Crop, reducing its height. ([#14])
- Standardized local file generation terminology as Export in UI progress/status messages, documentation and application helpers. The conversion review uses **Changed or omitted**, listing changes before omissions; generic raw-tree and event-provenance notices are covered by the format-differences explanation and documented mappings. ([#14])
- H5 to C3D conversion reuses existing analog channels and embedded original TYPE-2/3/4 force-platform definitions when current and float32-encoded force/moment/COP/free-moment reconstruction validates. Original origins, calibration and COP correction are retained; incompatible or missing definitions use the derived TYPE-2 fallback per plate. Known analog encoding is reversed before writing to preserve scaled values without double scaling. ([#13], [#14])
- H5→C3D export preserves imported project/file/location, coordinate descriptions and full subject values/units in documented `JE_METADATA` parameters, including arrays and long text. C3D import restores these fields; compatible singleton `SUBJECT` parameters remain available to other readers. ([#13], [#14])

- Standardized the application and project branding as JE Motion Lab. The SEO-optimized static landing page is at [jemolab.com](https://jemolab.com/); the web app is at [app.jemolab.com](https://app.jemolab.com/), still hosted on GitHub Pages. Updated application metadata, canonical URL, package name, synthetic README screenshot and deployment/release documentation; citation and attribution files use the same branding. ([#12])
- GitHub Pages builds use the root base path (`/`) for the custom domain. ([#10])
- Updated institute H5 compatibility for nested project/file metadata, expanded event context/subject fields and independent stream frame ranges. ([#11])
- Clicking a Data-tab event now seeks to its frame and opens the same editor as clicking the timeline event. ([#9])
- Restore original discards all label/event edits and crops. Loading another recording or restoring the original clears edit history; cropping establishes a modified baseline and clears undo/redo without retaining numerical snapshots. ([#9])
- Redesigned File Info as a curated recording/acquisition and metadata inspector for C3D and institute H5, with honest sampling-rate summaries, data counts, optional subject/provenance/location sections and compact lists replacing the raw JSON and event listings. Raw metadata remains internal; event editing stays on the timeline. ([#7])
- Updated the production Content Security Policy to allow connections to the JE Motion Lab analytics origin and the application's own origin. Development also permits local Vite WebSockets. ([#5])
- Updated documentation and browser privacy checks for analytics payloads, session storage and network behavior, including infrastructure privacy limits. Browser checks intercept analytics locally without updating live statistics. ([#5])

- Documented extensive manual compatibility testing in Google Chrome, Microsoft Edge, Safari and Samsung Internet / Samsung Browser separately from automated Chromium/Chrome/Edge coverage. Current validation docs and browser smoke use the supported H5 schema and synthetic data.
- Consolidated current scientific validation guidance, renamed the broader label/history guide to Data Editing, and replaced institution-specific optional oracle paths with explicit local inputs.

### Fixed

- Force-platform coordinate helpers interpret C3D/H5 ORIGIN by the declared platform type: TYPE-3 transducer spacing does not cause X/Y translations, and sensor-to-surface vectors are inverted to locate the measurement origin. Unknown nonzero origin semantics are omitted rather than guessed.

- Current-schema H5 files with empty optional groups such as EMG now import without placeholder signals or warnings; populated dimensions, labels, units and clocks remain strictly validated. Empty categories stay hidden and round-trip through H5 export without false cross-format loss warnings.
- Cross-format C3D retains surveyed corners within documented tolerances without a geometry warning. Derived force plates remain included when stored COP/free moment differs, with a specific omission warning and reconstruction from exported force/moment; excessive geometry deviations still omit the affected plate. ([#13], [#14])
- Fixed the 3D stage overlapping the right sidebar after hiding and reopening it in Data Viewer. The stage now shrinks to the available workspace width. ([#12])
- H5 edited/cropped exports preserve nested C3D provenance and boolean types, keep marker label aliases consistent, and update each stream's own sample/frame extents. Mapped EMG shares identical analog signals; independent IK/ID results are retained when their trial-time relationship is unspecified. ([#11])
- Removed the misleading V-channel warning for validated QTM-style C3D Type 2/3 force platforms while retaining calibrated force/moment/COP calculations and other validation warnings. ([#7])
- Spatial MoCap data now consistently uses millimetres for marker positions, residuals, force-plate geometry and COP, with matching inspector/plot labels and unchanged 3D scene scale. H5/C3D import respects declared units; source-preserving exports retain matching numerical values and unit metadata. Force remains N and moments remain Nm with independent conversion and round-trip regression coverage. ([#6])
- Corrected the package, lockfile and application footer version from `0.1.0` to `0.4.0` to match the existing formal release. Reconciled this changelog and release documentation with Git/GitHub history; no new release or tag was created. ([#6])

### Removed

- **Breaking pre-1.0 change:** removed support for obsolete institute H5 schemas. The current authoritative unversioned institute H5 schema is the only supported H5 layout; obsolete collection versions, Location/Offset geometry and missing marker-unit assumptions fail explicitly.
- Obsolete H5 compatibility fixtures/tests and completed migration/Python application audit documents; current independent h5py/ezc3d validation tools remain.

- Per-platform cards and their force-signal shortcuts from the Display tab. Force signals remain selectable in the signal inspector; File Info summarizes platform counts, types and rates. ([#7])
- Built-in synthetic demo, its welcome-screen button and generated motion data. Viewer controls and the README screenshot use local synthetic file fixtures. ([#5])

## [0.4.0] - 2026-09-28

First formal GitHub release, published at 06:32:12 UTC. Tag `v0.4.0` points to
commit `efc2189d0d2260781c09cefa6f6b4f8fb9c6a17c`, containing the initial application
and PRs #1–#4. PRs #5–#8 merged later that day and are not part of this release.

### Added

- Browser-local C3D and institute H5 loading, 3D markers and force-platform visualization, GRF/COP display, playback, synchronized signal inspection, a synthetic demo, validation tooling and GitHub Pages deployment. (Initial application, `e8cbc40`.)
- Non-destructive C3D/H5 cropping, source-format local export and restoration of the original recording. ([#1])
- Timeline event visualization and editing, C3D event serialization and associated validation. ([#2])
- Authoritative institute H5 schema support, explicit signal clocks, versioned H5 event editing, EMG and rigid-body position signals, quality metadata, moving force plates and expanded export validation. ([#3])
- Build-time package version in the application footer, a footer repository link, this changelog and a manual Semantic Versioning release workflow. ([#4])

### Changed

- Updated the public README to describe viewing, editing, export and privacy behavior. ([#4])

The published tag retained `0.1.0` in its package files despite being released as
`v0.4.0`. That historical mismatch is corrected in current development under
`[Unreleased]`; the existing release and tag have not been rewritten.

[Unreleased]: https://github.com/JEbbecke/mocap-web-viewer/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/JEbbecke/mocap-web-viewer/releases/tag/v0.4.0
[#1]: https://github.com/JEbbecke/mocap-web-viewer/pull/1
[#2]: https://github.com/JEbbecke/mocap-web-viewer/pull/2
[#3]: https://github.com/JEbbecke/mocap-web-viewer/pull/3
[#4]: https://github.com/JEbbecke/mocap-web-viewer/pull/4
[#5]: https://github.com/JEbbecke/mocap-web-viewer/pull/5
[#6]: https://github.com/JEbbecke/mocap-web-viewer/pull/6
[#7]: https://github.com/JEbbecke/mocap-web-viewer/pull/7
[#8]: https://github.com/JEbbecke/mocap-web-viewer/pull/8
[#9]: https://github.com/JEbbecke/mocap-web-viewer/pull/9
[#10]: https://github.com/JEbbecke/mocap-web-viewer/pull/10
[#11]: https://github.com/JEbbecke/mocap-web-viewer/pull/11
[#12]: https://github.com/JEbbecke/mocap-web-viewer/pull/12
[#13]: https://github.com/JEbbecke/mocap-web-viewer/pull/13
[#14]: https://github.com/JEbbecke/mocap-web-viewer/pull/14

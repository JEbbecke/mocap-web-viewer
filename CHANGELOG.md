# Changelog

Notable changes to JE Motion are recorded here, using a Keep a Changelog-style
structure and Semantic Versioning. Published GitHub releases and their Git tags
establish release history; `package.json` supplies the matching application version.
Changes since the latest formal release remain under `[Unreleased]`.

## [Unreleased]

### Added

- Label assignment/relabeling for markers, analog channels, force platforms, rigid bodies, EMG and IK/ID variables in the Data tab via pencil or double-click, with inline validation and source-preserving C3D/H5 export.
- Undo/redo for committed data-label renames and event add/edit/delete, with up to 100 reversible actions per recording, modified-state tracking and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y shortcuts. Native text-field undo and view settings remain separate from data-edit history.
- Data sidebar replacing the Markers tab, with searchable, counted sections for available markers, analog channels, force platforms, events, rigid bodies, EMG and IK/ID variables. Marker visibility/selection and Show all are preserved; supported signals open in the existing plot and events seek the timeline. IK/ID show variable metadata only, excluding labelled time rows from lists and counts. ([#8])
- Landing-page usage summary showing live visit, country and combined MoCap load totals from the analytics `/stats` endpoint; unavailable totals remain hidden. ([#5])
- Anonymous session visit attempts and successful C3D/H5/HDF5 load events, with a per-tab `sessionStorage` visit flag and event-only payloads. Repeated successful loads count again; failed/cancelled imports do not count as loads. ([#5])
- Cloudflare Worker analytics integration for aggregate counts by date, country and event type in D1. Motion-capture files, filenames, measurements and metadata remain local. Backend deployment and verification scope are documented in [docs/ANALYTICS.md](docs/ANALYTICS.md). ([#5])

### Changed

- Updated institute H5 compatibility for nested project/file metadata, expanded event context/subject fields and independent stream frame ranges. Older supported H5 layouts remain readable.
- Clicking a Data-tab event now seeks to its frame and opens the same editor as clicking the timeline event.
- Restore original discards all label/event edits and crops. Loading another recording or restoring the original clears edit history; cropping establishes a modified baseline and clears undo/redo without retaining numerical snapshots.
- Redesigned File Info as a curated recording/acquisition and metadata inspector for C3D and institute H5, with honest sampling-rate summaries, data counts, optional subject/provenance/location sections and compact lists replacing the raw JSON and event listings. Raw metadata remains internal; event editing stays on the timeline. ([#7])
- Updated the production Content Security Policy to allow connections to the JE Motion analytics origin and the application's own origin. Development also permits local Vite WebSockets. ([#5])
- Updated documentation and browser privacy checks for analytics payloads, session storage and network behavior, including infrastructure privacy limits. Browser checks intercept analytics locally without updating live statistics. ([#5])

### Fixed

- H5 edited/cropped exports preserve nested C3D provenance and boolean types, keep marker label aliases consistent, and update each stream's own sample/frame extents. Mapped EMG shares identical analog signals; independent IK/ID results are retained when their trial-time relationship is unspecified.
- Removed the misleading V-channel warning for validated QTM-style C3D Type 2/3 force platforms while retaining calibrated force/moment/COP calculations and other validation warnings. ([#7])
- Spatial MoCap data now consistently uses millimetres for marker positions, residuals, force-plate geometry and COP, with matching inspector/plot labels and unchanged 3D scene scale. H5/C3D import respects declared units; source-preserving exports retain matching numerical values and unit metadata. Force remains N and moments remain Nm with independent conversion and round-trip regression coverage. ([#6])
- Corrected the package, lockfile and application footer version from `0.1.0` to `0.4.0` to match the existing formal release. Reconciled this changelog and release documentation with Git/GitHub history; no new release or tag was created. ([#6])

### Removed

- Per-platform cards and their force-signal shortcuts from the Display tab. Force signals remain selectable in the signal inspector; File Info summarizes platform counts, types and rates. ([#7])
- Built-in synthetic demo, its landing-page button and generated motion data. Viewer controls are tested with local file fixtures; the existing README screenshot is retained. ([#5])

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

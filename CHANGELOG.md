# Changelog

Notable changes to JE Motion Lab are recorded here, using a Keep a Changelog-style
structure and Semantic Versioning. Published GitHub releases and their Git tags
establish release history; `package.json` supplies the matching application version.
Future changes belong under `[Unreleased]`; dated entries on release-preparation
branches describe the planned release until its tag is published.

## [Unreleased]

## [0.5.0] - 2026-10-09

Planned release date; update this date and CITATION.cff before publication if promotion changes.

### Added

- Read-only Data Explorer for numerical MoCap collections, structured metadata,
  dataset search, playback highlighting and exact-value copying, with bounded
  tables and lazy source-backed H5 model pages. ([#12])
- Explorer Ctrl/Cmd-click column toggles, Shift ranges and additive Ctrl/Cmd+Shift
  ranges. Numeric time-series columns plot complete underlying data in the shared
  Viewer/Explorer Signal Inspector; selections persist across pages/view switches.
  ([#21])
- Data sidebar for available markers, analogs, platforms, events, bodies, EMG and
  model variables, replacing the Markers tab. ([#8])
- Inline data-label editing and shared event/label undo/redo, keyboard shortcuts,
  modified-state tracking and source-preserving export. ([#9])
- IK/ID scalar plots with source units and physical clocks. Results proven aligned
  with trajectories crop with the trial; independent results remain intact. Plot
  crop previews de-emphasize samples outside the selected interval. ([#20])
- Browser-local C3D↔H5 conversion with a pre-export compatibility/loss review;
  same-format export retains the source-preserving path. ([#13], [#14])
- High-resolution scene PNG export at viewport, Full HD or 4K resolution, with
  an optional JE Motion Lab watermark. ([#16])
- Browser-local timestamped VP9/VP8 WebM export at 30/60 fps, viewport/1080p and
  1×/0.5×/0.25× speed, with watermark, progress and cancellation. ([#17])
- Independently toggled, default-on platform and rigid-body coordinate helpers,
  following validated poses into image/video exports without changing data. ([#19])
- Aggregate usage totals and anonymous session-visit/successful-load analytics.
  Event payloads contain only event types; recordings, filenames and measurements
  remain local. Hosting/Cloudflare still receive normal network information. ([#5])
- Footer Privacy/Imprint links, author/required notices and scientific citation
  metadata, distinguishing license obligations from scholarly citation. ([#12], [#22])

### Changed

- Current distribution is source-available under PolyForm Noncommercial License
  1.0.0; commercial use requires a separate license. The legal dialog bundles the
  exact terms, required notices and separate third-party notices. ([#22])
- Standardized branding as JE Motion Lab / MoCap Viewer & Editor, with the project
  website at [jemolab.com](https://jemolab.com/) and application at
  [app.jemolab.com](https://app.jemolab.com/). Pages builds use the root base path.
  ([#10], [#12])
- Curated File Info recording/acquisition and optional subject/provenance/location
  summaries replace raw JSON. Trial Inspector prioritizes subject, condition and
  file identity. ([#7], [#20])
- Current institute H5 supports nested metadata, expanded event context/subject
  fields and independent stream extents. ([#11])
- H5→C3D conversion reuses validated original TYPE-2/3/4 force definitions and
  analog encoding where possible, otherwise reporting the derived TYPE-2 fallback.
  Subject/project/file/location values and units round-trip through documented
  custom metadata; other readers may not display these fields. ([#13], [#14])
- Export is beside Open file; image/video share Export media. Timeline event actions
  sit beside Crop. File-generation UI consistently uses Export. ([#14], [#17])
- Data events seek and open the timeline editor. Restore original discards all edits
  and crops; loading/restoring/cropping clears undo/redo, while export preserves it.
  ([#9])
- Production CSP permits the fixed analytics origin. Browser checks intercept
  analytics locally; backend and infrastructure verification limits are documented.
  ([#5])
- Consolidated scientific/editing documentation and independent validation inputs;
  distinguished historical manual browser coverage from automated Chrome/Edge and
  required final Safari/Samsung media checks. ([#15])

### Fixed

- Spatial positions/residuals/geometry/COP consistently use mm, with force in N and
  moments in Nm. Import honors declared units; source-preserving export retains
  raw values with matching metadata. Corrected package/footer 0.1.0 to the formal
  0.4.0 baseline without changing published history. ([#6])
- Current H5 accepts absent/empty optional groups without placeholders, warnings or
  false conversion losses, while strictly validating populated data. ([#18])
- Platform helpers interpret ORIGIN by declared type: TYPE-3 transducer spacing
  does not shift X/Y, and sensor-to-surface direction correctly locates the origin.
  Unknown nonzero semantics are omitted rather than guessed. ([#19])
- H5 edited/cropped export preserves nested C3D provenance and booleans, keeps label
  aliases consistent and updates each stream's own extents. ([#11])
- C3D conversion retains accepted surveyed corners and reports differing stored
  COP/free moment without unnecessarily discarding the plate. ([#13], [#14])
- Restored Viewer sidebar no longer overlaps the 3D stage. ([#12])
- Validated QTM-style calibrated force channels no longer warn solely because their
  acquisition labels say V. ([#7])
- Release preparation corrects IK/ID picker unit labels to show resolved source
  units or unknown instead of assuming deg/Nm; chart/data values are unchanged.

### Removed

- **Breaking pre-1.0 change:** obsolete institute H5 layouts are rejected. Only the
  current authoritative unversioned institute schema is supported; missing marker
  units and obsolete geometry/version declarations fail explicitly. ([#11], [#15])
- Obsolete compatibility fixtures and completed migration/Python audit documents;
  useful independent h5py/ezc3d validators remain. ([#15])
- Per-platform Display cards; force signals remain available in the Signal
  Inspector and Data sidebar. ([#7])
- Built-in synthetic demo and its welcome button; validation/public screenshots
  use local synthetic file fixtures. ([#5])

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
`v0.4.0`. That historical mismatch was corrected after publication and is recorded under
`[0.5.0]`; the existing release and tag have not been rewritten.

[Unreleased]: https://github.com/JEbbecke/mocap-web-viewer/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/JEbbecke/mocap-web-viewer/compare/v0.4.0...v0.5.0
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
[#15]: https://github.com/JEbbecke/mocap-web-viewer/pull/15
[#16]: https://github.com/JEbbecke/mocap-web-viewer/pull/16
[#17]: https://github.com/JEbbecke/mocap-web-viewer/pull/17
[#18]: https://github.com/JEbbecke/mocap-web-viewer/pull/18
[#19]: https://github.com/JEbbecke/mocap-web-viewer/pull/19
[#20]: https://github.com/JEbbecke/mocap-web-viewer/pull/20
[#21]: https://github.com/JEbbecke/mocap-web-viewer/pull/21
[#22]: https://github.com/JEbbecke/mocap-web-viewer/pull/22

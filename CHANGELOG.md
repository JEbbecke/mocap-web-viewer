# Changelog

Notable changes to JE Motion are recorded here, using a Keep a Changelog-style
structure and Semantic Versioning. `package.json` is the authoritative application
version; changes since the latest formal release remain under `[Unreleased]`.

## [Unreleased]

### Added

- Landing-page usage summary showing live visit, country and combined MoCap load totals from the analytics `/stats` endpoint; unavailable totals remain hidden. ([#5])
- Anonymous session visit attempts and successful C3D/H5/HDF5 load events, with a per-tab `sessionStorage` visit flag and event-only payloads. Repeated successful loads count again; failed/cancelled imports do not count as loads. ([#5])
- Cloudflare Worker analytics integration for aggregate counts by date, country and event type in D1. Motion-capture files, filenames, measurements and metadata remain local. Backend deployment and verification scope are documented in [docs/ANALYTICS.md](docs/ANALYTICS.md). ([#5])

### Changed

- Updated the production Content Security Policy to allow connections to the JE Motion analytics origin and the application's own origin. Development also permits local Vite WebSockets. ([#5])
- Updated documentation and browser privacy checks for analytics payloads, session storage and network behavior, including infrastructure privacy limits. Browser checks intercept analytics locally without updating live statistics. ([#5])

### Fixed

- Spatial MoCap data now consistently uses millimetres for marker positions, residuals, force-plate geometry and COP, with matching inspector/plot labels and unchanged 3D scene scale. H5/C3D import respects declared units; source-preserving exports retain matching numerical values and unit metadata. Force remains N and moments remain Nm with independent conversion and round-trip regression coverage.
- Corrected the package, lockfile and application footer version from `0.1.0` to `0.4.0` to match the existing formal release. Reconciled this changelog and release documentation with Git/GitHub history; no new release or tag was created.

### Removed

- Built-in synthetic demo, its landing-page button and generated motion data. Viewer controls are tested with local file fixtures; the existing README screenshot is retained. ([#5])

## [0.4.0] - 2026-09-28

First formal GitHub release, published at 06:32:12 UTC. Tag `v0.4.0` points to
commit `efc2189d0d2260781c09cefa6f6b4f8fb9c6a17c`, containing the initial application
and PRs #1–#4. PR #5 merged later that day and is not part of this release.

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

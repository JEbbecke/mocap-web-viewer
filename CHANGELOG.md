# Changelog

Notable changes to JE Motion are recorded here, using a Keep a Changelog-style
structure and Semantic Versioning. `package.json` is the authoritative version.

## [Unreleased]

### Added

- Landing-page usage summary showing live visit, country and combined MoCap load totals from the analytics `/stats` endpoint; unavailable totals remain hidden.
- Anonymous session visit attempts and successful C3D/H5/HDF5 load events, with a per-tab `sessionStorage` visit flag and event-only payloads. Repeated successful loads count again; failed/cancelled imports do not count as loads.
- Cloudflare Worker analytics integration for aggregate counts by date, country and event type in D1. Motion-capture files, filenames, measurements and metadata remain local. Backend deployment and verification scope are documented in [docs/ANALYTICS.md](docs/ANALYTICS.md).

### Changed

- Updated the production Content Security Policy to allow connections to the JE Motion analytics origin and the application's own origin. Development also permits local Vite WebSockets.
- Updated documentation and browser privacy checks for analytics payloads, session storage and network behavior, including infrastructure privacy limits. Browser checks intercept analytics locally without updating live statistics.

### Removed

- Built-in synthetic demo, its landing-page button and generated motion data. Viewer controls are tested with local file fixtures; the existing README screenshot is retained.

## Development baseline (not a formal release)

The repository used package version `0.1.0` in its initial commit. The following
records existing development history and does not represent retroactively published
releases. Dates below are commit dates, not release dates.

### Added

- **2026-09-24 — `e8cbc40`:** initial browser application with local C3D/institute
  H5 import, shared 3D marker and force visualization, playback, signal inspection,
  validation tooling and GitHub Pages workflow.
- **2026-09-24 — `f028381` (PR #1):** non-destructive C3D/H5 cropping,
  source-format local export and restoration of the original recording.
- **2026-09-25 — `7bd5249` (PR #2):** timeline event visualization and editing,
  C3D event serialization and associated validation.
- **2026-09-25 — `954a869` (PR #3):** authoritative institute H5 schema support,
  explicit signal clocks, versioned H5 event editing, EMG and rigid-body position
  signals, quality metadata, moving force plates and expanded export validation.
- **2026-09-28 — `efc2189` (PR #4):** application versioning based on `package.json`,
  footer version display, changelog and [manual Semantic Versioning release process](docs/RELEASING.md).

Future formal releases belong above this baseline with their actual version and
release date. The baseline is retained as development provenance.

# Changelog

Notable changes to JE Motion are recorded here, using a Keep a Changelog-style
structure and Semantic Versioning. `package.json` is the authoritative version.

## [Unreleased]

### Added

- Build-time package version in the existing application footer.
- This changelog and a manual release workflow in [docs/RELEASING.md](docs/RELEASING.md).

### Changed

- Updated the public README to describe current viewing, editing, export and privacy behavior.

## Development baseline (not a formal release)

The repository already used package version `0.1.0` in its initial commit and
still uses it. No release tags are present in the inspected local Git history.
The following records existing development, not retroactively published releases.
Dates below are commit dates, not release dates.

### Added

- **2026-09-24 — `e8cbc40`:** initial browser application with local C3D/institute
  H5 import, shared 3D marker and force visualization, playback, signal inspection,
  synthetic demo, validation tooling and GitHub Pages workflow.
- **2026-09-24 — `f028381` (PR #1):** non-destructive C3D/H5 cropping,
  source-format local export and restoration of the original recording.
- **2026-09-25 — `7bd5249` (PR #2):** timeline event visualization and editing,
  C3D event serialization and associated validation.
- **2026-09-25 — `954a869` (PR #3):** authoritative institute H5 schema support,
  explicit signal clocks, versioned H5 event editing, EMG and rigid-body position
  signals, quality metadata, moving force plates and expanded export validation.

Future formal releases belong above this baseline with their actual version and
release date. The baseline is retained as development provenance.

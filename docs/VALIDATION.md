# Release validation

JE Motion Lab supports C3D and the current authoritative institute H5 schema.
Validation combines portable synthetic regression tests, real browser workers,
and independent Python oracles. Optional private reference checks are separate
from portable product checks. Historical runs and obsolete layouts remain in Git
history; this document describes the current methodology.

## Required checks

```sh
npm test
npm run typecheck
npm run build
npm run format:check
git diff --check
npm run test:browser
```

Tests cover Intel integer/IEEE and MIPS C3D, signed/unsigned analog scaling and
subframes, residual validity, units, TYPE-2/3/4 force calibration and COP,
moving geometry, crop clocks, event edits, all data-label collections, history,
File Info, Data sidebar, Explorer paging/copying, current H5 preservation, both
cross-format paths, force-channel reuse/fallback and conversion-loss reporting.
Malformed structures and unsupported obsolete H5 layouts must fail explicitly.
The small `h5.json` fixture is solely a low-level gzip/WASM regression, not a
supported application schema.

## Independent C3D oracle

`scripts/reference-export.py` reads explicit local C3D paths or an ignored JSON
array of paths. It never modifies inputs. It writes only ignored
`.local/reference.json`; no institution-specific paths are embedded in source.

```sh
python scripts/reference-export.py --manifest .local/reference-inputs.json
npm run validate:reference
```

Alternatively pass C3D paths as positional arguments. The independent ezc3d
comparison checks every marker/analog/force sample and source frame/rate.
Tolerances are 1e-3 mm positions, 1e-8 source analog units, 1e-7 N forces,
1e-7 Nm moments/free moments and 1e-2 mm COP. Invalid markers are excluded from
coordinate equality but validity and residuals are checked separately. Very-low-load
COP is sensitive; display thresholds never change comparison data.
Absent or unavailable local source files skip only optional comparisons, which
must be reported as unavailable. Regenerate stale oracles when inputs move.
Malformed or numerical comparisons against available inputs still fail.

The observed ezc3d 1.7.0 positive float-residual discrepancy is reproduced with
an entirely synthetic fourth word 2.0 and POINT scale -0.5: that reader returns
8192 mm while the [C3D rule](https://www.c3d.org/HTML/Documents/3ddatafloatingpointformat.htm)
converts the float to an integer and scales its low byte, giving 1 mm. The oracle
therefore computes residuals independently from raw records using struct and
the declared processor byte order. Existing H5 residuals cannot be repaired
without the original C3D; no correction is guessed.

Force normalization preserves lab XYZ and signs. The surface moment is
`M_surface = M_sensor + F × origin`; local COP is
`(-My/Fz, Mx/Fz, 0)` before rotation/translation. Missing samples remain missing;
no zero geometry, NaN-to-zero substitution or OpenSim viewing rotation is used.
Display interpolation is not filtered scientific resampling. See [parsers](PARSERS.md)
and [units](UNITS.md) for calibration/origin conventions.

## Current H5 and cross-format validation

See [H5_VALIDATION.md](H5_VALIDATION.md) for read-only reference import and six
intentional export comparisons with h5py. `scripts/inspect-h5.mjs` is the
privacy-safe structural inventory; `scripts/create-h5-fixture.py` generates only
the current invented fixture. Python tools are development oracles, not runtime
dependencies.

After conversion/reuse tests generate ignored synthetic pairs, run:

```sh
python scripts/validate-cross-format.py
```

h5py and ezc3d compare ordinary, tilted/oblique, cropped/edited, extended-frame,
metadata-rich, corrected-COP, surveyed-corner and native TYPE-2/3/4 reuse pairs.
Metadata parameters, analog scaling, corners, forces, moments, COP, free moment
and event timing are checked independently. A deliberately omitted stored COP/Tz
is compared against wrench reconstruction, not against the omitted value.
Original-channel reuse requires current and encoded float32 reconstruction;
failed reuse falls back per plate with explicit loss reporting.
An optional `JE_VALIDATE_REFERENCE=1` conversion test reads the authoritative
H5 and writes an ignored local C3D; it never changes the reference.

## Browser and privacy coverage

Automated smoke tests target Google Chrome through Playwright Chromium, with
`BROWSER_CHANNEL=msedge` for Microsoft Edge. They exercise imports, playback,
plots, crop, labels/events/history, File Info, Data Explorer, both conversion
workers, compatibility cancellation/blocking, exports/re-import, responsive
layouts and synthetic moving plates. Screenshots/reports stay in `.local/`.
Automated coverage does not establish Firefox, Safari or Samsung coverage.

The application has also been extensively **manually tested** in Google Chrome,
Microsoft Edge, Safari and Samsung Internet / Samsung Browser. No browser version
numbers or universal compatibility are claimed. A browser needs WebGL,
WebAssembly and module workers; mobile remains secondary.

Browser checks intercept analytics locally without updating live totals. Allowed
requests are same-origin asset GETs, bodyless analytics stats GETs and event-only
POSTs. They verify request bodies, failed-import behavior and storage: only the
non-identifying visit flag is allowed in sessionStorage; recordings never enter
localStorage, IndexedDB, cookies or Cache Storage. These checks do not verify the
separately managed Cloudflare Worker, D1, infrastructure logs or retention; see
[analytics](ANALYTICS.md).

## Remaining limits and release gate

Validated cases do not establish every vendor encoding, arbitrary HDF5 schema,
reader implementation or very large recording. Model clocks/units and unknown
force frames remain explicit uncertainties. Cross-format precision, missing
representations, geometry/baseline constraints and custom metadata interoperability
are detailed in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) and
[CROSS_FORMAT_EXPORT.md](CROSS_FORMAT_EXPORT.md).

Before a separate promoted release, rerun applicable checks on the final release
commit, review losses/limits and verify all private/generated data are ignored,
untracked and absent from deployed assets. Version changes, tags and release
publication belong to [the separate release workflow](RELEASING.md).

# Validation record

Initial validation was performed locally on Windows, Node 24 and headless Chrome on 24 September 2026. The scientific results below are a historical record, with later H5 coverage linked at the end; they are not the current suite totals. The original Python project and measurements were read-only throughout. The sibling reference files are not copied to application assets or committed fixtures.

## Cross-format export — 6 October 2026

On `feature/cross-format-export`, all **191 tests across 18 files** passed with
`JE_VALIDATE_REFERENCE=1`, including 41 conversion tests (one is an opt-in
read-only authoritative-file check). The typechecked production build and full
Chromium smoke suite passed. Browser checks exercised both conversion workers,
downloads and re-import, Data Explorer values, cancelling the conversion report,
blocked incompatible analog sampling, corrected-COP omission warnings and
reconstructed Force/Moment/COP/free-moment table values, and existing
analytics/storage checks.
Same-format C3D and H5 preservation regressions remain green; version `0.4.0`
is unchanged.

Independent `h5py` and `ezc3d` comparisons accepted seven synthetic H5/C3D pairs:
ordinary, tilted, oblique, cropped/edited, extended-frame, corrected-COP and
surveyed-corner recordings. They checked 2,454 valid marker samples, 147,600 analog values,
24,600 force samples and 25 events, including units, source frames and
reconstructed plate geometry, moment, COP and free moment. Generated files remain
under ignored `.local/`; no participant recordings were added to the repository. Run
`python scripts/validate-cross-format.py` after the conversion tests to repeat
these comparisons in an environment with numpy, h5py and ezc3d.

The COP follow-up retains compatible force/moment plates when stored COP differs
from reconstruction, with explicit COP/free-moment omission warnings. Source
arrays remain untouched. The synthetic corrected case verifies reconstruction
instead of equality to the omitted stored COP/Tz. An independent read-only check
of `.local/authoritative-force-export.c3d` against the authoritative H5 also passed
for all five plates (3,940 samples each): force/moment values are retained and
COP/free moment agree with wrench-based reconstruction. Plate 1's stored COP
differs as reported; these private outputs remain ignored and are never fixtures.

The geometry follow-up accepts small surveyed-corner deviations within documented
limits (1 degree, diagonal-midpoint separation 1% of shortest edge capped at 5 mm,
non-planarity 0.5% capped at 2 mm). Plates 3 and 4 are included with per-plate
warnings. Their original corner coordinates/order remain unchanged except for
C3D float32 storage, and ezc3d reconstructs their stored COP/free moment within
the tested tolerances. New regressions reject excessive angular, midpoint and
plane errors, crossed/duplicate/nonfinite corners and verify translation-invariant
acceptance without fitting a new rectangle. This validates the tested readers;
other vendor implementations may impose stricter geometry assumptions.
The production browser check also passed the accepted-geometry warning, download,
re-import and exact surveyed-corner table values, together with reconstructed COP.

The unchanged older institute Python reader fails on missing legacy `Location`
when reading the current `Corners` schema; this existing limitation is described
in [H5 validation](H5_VALIDATION.md). The installed ezc3d positive float-residual
decoding discrepancy below also remains; packed residuals are checked against
the C3D standard rather than that incorrect magnitude. These checks establish
the tested mappings, not all vendor variants or very large recordings. See the
[compatibility matrix and limitations](CROSS_FORMAT_EXPORT.md).

## Branding, domains and current checks — 6 October 2026

The application, HTML title/description/application name, accessible footer,
package name, README screenshot and project documentation now use **JE Motion Lab**.
The package and both lockfile root versions agree at `0.4.0`. GitHub's latest
formal release remains `v0.4.0`, with the matching local tag at
`efc2189d0d2260781c09cefa6f6b4f8fb9c6a17c`; merged PRs #5–#11 and the current
Data Explorer, sidebar fix and branding work belong under `[Unreleased]`.
See [release history and workflow](RELEASING.md).

Both public HTTPS addresses returned 200 during this review.
[jemolab.com](https://jemolab.com/) serves the separately maintained static landing
page with a descriptive title, meta description, canonical link and static H1.
[app.jemolab.com](https://app.jemolab.com/) serves the React application; the GitHub
Pages API confirms that custom domain and Actions-based deployment. The app HTML
now declares its own domain as canonical. The live app still used the previous
branding at review time; these local changes reach it through the next main-branch
Pages deployment. The existing analytics hostname and session flag remain
compatible with the deployed service.

All **150 tests across 17 files** and the typechecked production build passed,
using `VITE_BASE_PATH=/` to match the deployment workflow. All 83 local Markdown
file links resolved. The refreshed README screenshot uses the synthetic
`tests/fixtures/institute-h5.json` recording generated by the browser smoke script;
it contains no participant data. Older validation entries below describe their
dated runs, including the previously missing private-reference setup.

The production Chromium smoke suite also passed. It verifies the rendered
JE Motion Lab header, document title, application-name/description metadata,
canonical app URL and version label. Existing checks cover local C3D/H5 workflows,
Data Explorer tables and copying, analytics/storage behavior and repeated sidebar
toggles. The complete viewer header fits at 1440×1000 and 1366×768. Analytics is
intercepted locally, and these browser checks do not update live usage counts.

## Data editing and release metadata review — 30 September 2026

The latest published GitHub release and matching Git tag remain `v0.4.0`.
Merged PRs #5–#8 and the current branch's data-label editing, shared undo/redo
and Data-tab event editor changes belong under `[Unreleased]`. Package and
lockfile versions remain `0.4.0`; the production browser check confirmed the
matching footer. See [the release workflow](RELEASING.md).

The full `npm test` run reported 109 passing tests and two failures across
13 test files. Both failures were in `tests/reference.test.ts`: the ignored
local reference manifest points to missing private source data, and the paired
comparison depends on that import. The separate portable run,
`npm test -- --exclude tests/reference.test.ts --reporter=dot`, passed all
108 tests across 12 files. This does not constitute a passing full-suite run;
the local reference setup must be repaired to validate those private inputs.

The production build, including TypeScript checking, and Chrome smoke check
passed. Browser coverage includes renaming all non-event Data-tab collections
through the pencil and double-click interactions, undo/redo, and opening the
shared event editor while seeking from the Data tab. Synthetic export checks
cover label round trips and preservation of numerical samples and source
identity. No private measurements were added to committed fixtures.

## Versioning and analytics documentation review — 28 September 2026

On Windows with Node 24, all 60 tests across seven suites passed, along with
`npm run build` (including TypeScript checking) and the production Chrome smoke
check. The smoke check verified the `v0.1.0` footer, one visit across a reload,
successful C3D/H5/HDF5 loads, no load event for a failed import,
event-only payloads and the sole session visit flag. Analytics was intercepted
locally. Internal Markdown links and formatting of changed files also passed.
The separately managed Worker/D1 deployment and infrastructure logs were not
inspected; see [verification scope](ANALYTICS.md#verification).

## Automated checks

The Data sidebar pre-merge check on 28 September 2026 passed all 84 tests across
ten suites and the production build. Chrome smoke checks passed for this same
application build, including the `v0.4.0` footer, all available data categories,
cross-category search, marker visibility/selection and Show all, existing plot
selection, event seeking and keyboard section toggles. The six new unit tests
use synthetic data and also cover empty collections, model metadata without
loading samples, time-row exclusion and crop-aware event counts. See
[Data browser behavior and limits](DATA_BROWSER.md).

The File Info pre-merge check on 28 September 2026 passed all 78 tests across
nine suites, the production build (including TypeScript) and the Chrome smoke
check. The rendered footer matched package/lockfile version `0.4.0`; the earlier
`0.1.0` result above records the historical state before PR #6 corrected it.
Synthetic File Info checks cover H5/C3D metadata, conditional sections, mixed
sampling rates, valid zero values, model-result counts without reading samples,
long-path layout, expandable source-file lists and removal of raw JSON/event
listings. Timeline/event and source-preserving export checks still pass. See
[File Info mappings](FILE_INFO.md) for supported fields and limits.

- TypeScript strict checking and production Vite build pass.
- The initial run passed 27 Vitest tests: 24 portable scientific/importer tests plus three private reference integration tests. The latter are skipped in CI when the ignored oracle is absent.
- Intel IEEE float, Intel integer and MIPS IEEE float synthetic C3D fixtures cover point scaling, packed residuals, missingness, analog offset × channel scale × general scale, subframe ordering and event timing.
- Synthetic H5 tests cover schema/rate errors, declared units, legacy unit warnings, residual missingness, optional forces and unresolved frames. A real gzip-compressed HDF5 fixture is read by h5wasm.
- Independent unit tests cover right-handed basis construction, vector rotation, moment transport, COP, no-load missing COP, type-3 transducer combination and type-4 calibration. Timing tests cover interpolation, no extrapolation, gaps, source-rate independence, looping and fractional rates.

## Reference comparisons

| Trial                | Point data                      | Analog data        | Platforms               |
| -------------------- | ------------------------------- | ------------------ | ----------------------- |
| matching C3D/H5 pair | 31 markers × 193 frames, 120 Hz | 12 × 1544, 960 Hz  | 2 type-2                |
| additional C3D       | 68 markers × 423 frames, 200 Hz | 56 × 4230, 2000 Hz | 4 type-3 + 1 type-4     |
| older H5 variant     | 69 markers × 423 frames, 200 Hz | 56 × 4230, 2000 Hz | 5 stored vector streams |

All marker, analog and force samples in both C3D files are compared to ezc3d (not just selected frames). Enforced absolute tolerances: positions 1e-3 mm, analogs 1e-8 source units, forces 1e-7 N, moments/free moments 1e-7 Nm, COP 1e-2 mm. Invalid reference samples are excluded from coordinate-value comparisons, with validity and residuals checked separately against raw records and the C3D specification. Very-low-load COP is numerically sensitive; the display threshold does not alter oracle comparison data.

The matching pair has identical normalized marker arrays and validity, rates/frame counts/source origins and analog samples. Its stored forces/moments/COP match the C3D extraction within those tolerances. H5 has lost analog unit labels and events were empty in both: equivalence is not claimed for metadata that the converter discarded. The older H5 has a virtual marker and changed frame origin, so it is validated as a variant, not asserted to be identical to the second C3D.

## Bugs confirmed in the original path

Running `load_backend_file` on the paired H5 yields only 25 frames of finite plate corners out of 193, because marker-rate geometry is sampled at the force rate. The C3D path returns default zero geometry even though actual corners are in metadata. The older H5 raises KeyError for missing Tz. The web importer retains static corners across the whole trial, obtains actual C3D corners, and accepts absent Tz. Raw H5 and ezc3d samples, rather than these faulty presentation fields, are the comparison oracle.

Residuals are another intentional exception to the installed oracle. ezc3d 1.7.0 returns 8192 mm for our synthetic record with float fourth word 2.0 and scale -0.5. [The C3D format](https://www.c3d.org/HTML/Documents/3ddatafloatingpointformat.htm) requires converting that float to an integer and scaling its low byte, yielding 1 mm. In the second trial, raw 32521 at scale -0.13408342 yields 1.20675 mm; installed ezc3d instead returns 2436.832 mm. The web implementation keeps the standard result. The Python validation script exports both values and computes an independent struct-based standards oracle; tests compare every residual/validity sample to that oracle. The paired H5 residuals are all zero, so its equality test is unaffected. H5 residuals already stored by a faulty exporter cannot be repaired without the original C3D.

## Browser and privacy

`scripts/browser-smoke.mjs` exercises play/pause, stepping, camera presets, labels, synthetic C3D and compressed H5, the available private samples, first/last frames and malformed-file recovery. The production build runs under its restrictive CSP without runtime/CSP errors.

The browser check also covers marker search/selection/visibility and plot scrubbing. The initial checks passed for the relative-base production build, a production build hosted under `/ibo-mocap-visualizer-webapp/`, and the Vite development server. HDF5 is included in development dependency optimization to prevent the first worker import from triggering a Vite page reload. Development deliberately logs the scripted corrupt-file error locally.

Current network checks allow same-origin asset GETs, bodyless analytics `/stats` GETs and event-only POSTs to the exact configured `/event` endpoint. Analytics is intercepted locally so smoke tests do not increment live counts. The check verifies the app's welcome-screen totals and invalid-response fallback, visit suppression on reload, successful C3D/H5 loads, no additional load event for viewer controls or a failed import, and the footer version against `package.json`. Only `je-motion-visit-counted=true` is permitted in session storage; localStorage, Cache Storage, IndexedDB and cookies remain empty in the test context. No filenames, marker labels, participant metadata or measurements may appear in request URLs or bodies. See [analytics verification and infrastructure limits](ANALYTICS.md). The browser report stays in `.local/browser-report.json` and is not deployed.

This covers Chromium and the inspected datasets, not every vendor encoding, arbitrary H5 schema, browser or very large recording. No performance claim has been made for unmeasured dataset sizes. Local checks do not establish the state of the live Pages deployment, Cloudflare Worker, D1 contents or infrastructure logs.

## Authoritative populated H5

The 25 September schema/lifecycle audit supersedes earlier empty-event H5 assumptions. See [H5_VALIDATION.md](H5_VALIDATION.md) for complete recursive comparisons, actual worker downloads, enum preservation, Python reader compatibility and known limits. H5 marker display arrays now retain float64; comparison to C3D float32 display arrays uses a 1e-3 millimetre tolerance. H5 raw export comparisons remain exact.

Current unit regression checks are documented in [UNITS.md](UNITS.md). The private reference H5 is now read-only in automated tests; its reconstruction/export/crop and browser checks use synthetic H5 files. The existing private ezc3d JSON oracle remains in SI and comparisons convert mm to m explicitly.

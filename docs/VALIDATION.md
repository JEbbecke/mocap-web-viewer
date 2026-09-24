# Validation record

Validated locally on Windows, Node 24, headless Chrome, 24 September 2026. Original Python project and measurements were read-only throughout. The sibling reference files are not copied to application assets or committed fixtures.

## Automated checks

- TypeScript strict checking and production Vite build pass.
- All 27 Vitest tests pass locally: 24 portable scientific/importer tests plus three private reference integration tests. The latter are skipped in CI when the ignored oracle is absent.
- Intel IEEE float, Intel integer and MIPS IEEE float synthetic C3D fixtures cover point scaling, packed residuals, missingness, analog offset × channel scale × general scale, subframe ordering and event timing.
- Synthetic H5 tests cover schema/rate errors, declared units, legacy unit warnings, residual missingness, optional forces and unresolved frames. A real gzip-compressed HDF5 fixture is read by h5wasm.
- Independent unit tests cover right-handed basis construction, vector rotation, moment transport, COP, no-load missing COP, type-3 transducer combination and type-4 calibration. Timing tests cover interpolation, no extrapolation, gaps, source-rate independence, looping and fractional rates.

## Reference comparisons

| Trial                | Point data                      | Analog data        | Platforms               |
| -------------------- | ------------------------------- | ------------------ | ----------------------- |
| matching C3D/H5 pair | 31 markers × 193 frames, 120 Hz | 12 × 1544, 960 Hz  | 2 type-2                |
| additional C3D       | 68 markers × 423 frames, 200 Hz | 56 × 4230, 2000 Hz | 4 type-3 + 1 type-4     |
| older H5 variant     | 69 markers × 423 frames, 200 Hz | 56 × 4230, 2000 Hz | 5 stored vector streams |

All marker, analog and force samples in both C3D files are compared to ezc3d (not just selected frames). Enforced absolute tolerances: positions 1e-6 m, analogs 1e-8 source units, forces 1e-7 N, moments/free moments 1e-7 Nm, COP 1e-5 m. Invalid reference samples are excluded from coordinate-value comparisons, with validity and residuals checked separately against raw records and the C3D specification. Very-low-load COP is numerically sensitive; the display threshold does not alter oracle comparison data.

The matching pair has identical normalized marker arrays and validity, rates/frame counts/source origins and analog samples. Its stored forces/moments/COP match the C3D extraction within those tolerances. H5 has lost analog unit labels and events were empty in both: equivalence is not claimed for metadata that the converter discarded. The older H5 has a virtual marker and changed frame origin, so it is validated as a variant, not asserted to be identical to the second C3D.

## Bugs confirmed in the original path

Running `load_backend_file` on the paired H5 yields only 25 frames of finite plate corners out of 193, because marker-rate geometry is sampled at the force rate. The C3D path returns default zero geometry even though actual corners are in metadata. The older H5 raises KeyError for missing Tz. The web importer retains static corners across the whole trial, obtains actual C3D corners, and accepts absent Tz. Raw H5 and ezc3d samples, rather than these faulty presentation fields, are the comparison oracle.

Residuals are another intentional exception to the installed oracle. ezc3d 1.7.0 returns 8192 mm for our synthetic record with float fourth word 2.0 and scale -0.5. [The C3D format](https://www.c3d.org/HTML/Documents/3ddatafloatingpointformat.htm) requires converting that float to an integer and scaling its low byte, yielding 1 mm. In the second trial, raw 32521 at scale -0.13408342 yields 1.20675 mm; installed ezc3d instead returns 2436.832 mm. The web implementation keeps the standard result. The Python validation script exports both values and computes an independent struct-based standards oracle; tests compare every residual/validity sample to that oracle. The paired H5 residuals are all zero, so its equality test is unaffected. H5 residuals already stored by a faulty exporter cannot be repaired without the original C3D.

## Browser and privacy

`scripts/browser-smoke.mjs` exercises play/pause, stepping, camera presets, labels, synthetic C3D and compressed H5, the available private samples, first/last frames and malformed-file recovery. The production build runs under its restrictive CSP without runtime/CSP errors.

The browser check also covers marker search/selection/visibility and plot scrubbing. It passes for the relative-base production build, a production build hosted under `/ibo-mocap-visualizer-webapp/`, and the Vite development server. HDF5 is included in development dependency optimization to prevent the first worker import from triggering a Vite page reload. Development deliberately logs the scripted corrupt-file error locally; no unexpected errors occur.

Recorded request traffic contains only same-origin GET requests for the document, icon and hashed JS/CSS/worker/HDF5 assets, with no query parameters or request bodies. No filenames, marker labels, participant metadata or sample contents occur in request URLs. Local/session storage, Cache Storage and IndexedDB remain empty. The browser report stays in `.local/browser-report.json` and is not deployed.

This covers Chromium and the inspected datasets, not every vendor encoding, arbitrary H5 schema, browser or very large recording. No performance claim has been made for unmeasured dataset sizes. GitHub Pages publication itself requires a repository and Pages settings; the workflow is configured but has not been run on GitHub from this workspace.

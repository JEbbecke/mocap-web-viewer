# Authoritative H5 lifecycle validation

The schema audit on 6 October 2026 (merged in PR #11) used the replacement
read-only reference. The current layout is unversioned, with nested metadata,
expanded event columns and separate stream frame extents. The older versioned
layout remains covered by synthetic fixtures and locally available older files.

At that audit, checks passed: 122 tests across 14 suites, TypeScript/production build,
production browser smoke and `git diff --check`. The browser check exercises both
current and previous synthetic schemas through actual workers. The reference
SHA-256 remained unchanged; all six intentional private exports were removed
after comparison. The reference remains ignored and untracked. These are dated
schema-audit results, not current suite totals; see [validation](VALIDATION.md)
for subsequent Data Explorer and cross-format export checks.

## Current reference results

The independent h5py oracle compared 177 objects (including root) in each of six
workflows, with zero unexplained hierarchy, dataset, attribute, shape, dtype,
encoding or value differences. Values use exact equality, with NaNs equal.
Scientific coordinate and moment unit metadata remain paired with raw values.

| Workflow                  | Exact comparison result                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Full reconstructed export | No semantic or storage differences                                                                                               |
| Marker rename             | Two intended label attributes changed; all unrelated content exact                                                               |
| Event edit                | Eight live event columns followed intended edits and chronological ordering; unrelated arrays/provenance exact                   |
| Event add/delete          | Eight parallel columns remain consistent; source flags/icons retained, new flags/icons zero                                      |
| Crop                      | Trajectories, quality, analog, EMG, forces/geometry and bodies sliced on their physical clocks; own sample/frame extents updated |
| Metadata/provenance       | Static nested metadata, C3D parameters and boolean attributes preserved                                                          |
| IK/ID                     | Independent result data, timestamps, counts and opaque processing metadata preserved unchanged                                   |

Changed event row counts alter dataset maximum extents; cropping can shrink
primitive chunks/maxshape. These are expected storage details, listed separately
in the local report. The current reference's reconstructed export has no such
differences. Synthetic h5py-generated fixtures can expose an additional unused
VLEN string-padding change (NULLTERM to SPACEPAD); UTF-8 encoding, string dtype,
text and shape remain identical.

Marker rename updates live Labels, matching body membership and a matching nested
POINT label alias. Analog rename similarly updates its ANALOG alias. Original
nested C3D EVENT parameters are historical provenance, not a live event duplicate;
the source already differs from live Events and they are not rewritten.

## Reproduce safely

1. `node scripts/inspect-h5.mjs` prints every group/dataset path, shape, dtype,
   attribute descriptor, filter and dimension label, with private values redacted.
   It does not create an extracted metadata dump.
2. `npm test` exercises synthetic current/previous schemas and optionally checks
   the ignored reference read-only. No reference values become fixtures/snapshots.
3. Set `JE_VALIDATE_REFERENCE=1` and run
   `npm test -- tests/current-h5.test.ts` to intentionally create six reference
   exports only in ignored `.local/h5-validation/`. No reference is modified.
4. Run `python scripts/validate-authoritative-h5.py --cleanup` in an existing
   environment containing h5py/numpy. It independently checks all six outputs,
   prints aggregate results and removes those explicitly named private exports.
   Its JSON report contains structural paths and difference classifications only.
5. `npm run build` checks TypeScript and produces the static bundle.
   `npm run test:browser` checks actual import/export workers using synthetic
   current and previous layouts, event CRUD, exports/re-import, cropping and
   existing viewer/plot/privacy behavior. Analytics is intercepted locally.
6. Verify the branch, `git diff --check`, status, and
   `git check-ignore -v reference-data/authoritative_reference.h5`.
   The reference must remain ignored, untracked and unchanged.

`scripts/create-h5-fixture.py --current` generates the new synthetic fixture
using invented values and names; without the flag it generates the previous
layout fixture. The boolean template writer generates empty datasets/typed
attributes from structural descriptions, without copying source file bytes.
Its encoding follows the [HDF Group file-format specification](https://support.hdfgroup.org/documentation/hdf5/latest/_f_m_t4.html).
HDF5 itself performs scientific dataset writes; Python is only a development oracle.

## Scientific limits

- Current IK/ID timestamps have no declared relationship to trial time zero.
  They remain independent derived results when cropping. No forced alignment,
  guessed offset or per-variable units are introduced. The previous supported
  layout retains its documented absolute-time crop behavior.
- IK inDegrees is retained as a declaration, not assigned as the unit of every
  variable. Explicit per-variable units take precedence. Data Explorer can infer
  deg/rad only for a tested list of standard OpenSim rotation coordinates and
  identifies that convention; custom coordinates, translations and ID units
  remain unknown without source units. See [model units](DATA_EXPLORER.md).
- Body parent frames, marker Type codes, lab handedness and compass directions
  cannot be established from the file. Bodies use the point grid when counts
  agree and no separate clock exists. No anatomical visualization is invented.
- Regular point clocks are required for playback. Signal timestamps may be
  irregular, and each recognized stream is cropped independently.
- Current frame/sample extents are checked strictly. Stale older-file counts
  produce warnings and use actual dataset dimensions, retaining prior support.
- Unsupported future explicit schema versions fail clearly. Opaque temporal
  content, compound/reference types, arbitrary enums, named types, links and
  unsupported filter pipelines may block modified export. Unchanged export
  retains all original bytes. Boolean attributes on otherwise unsupported
  dataset objects are not promised by the group/quality template path.

## Independent institute reader

The installed institute Python reader fails with a missing-Location KeyError on
the untouched reference, edited output and cropped output alike. It expects the
old Location/Offset force-plate structure. It was not modified to accept outputs.
h5py validates all six files, but end-to-end compatibility with a current institute
reader cannot be claimed until that reader is available.

The existing moving-plate regressions continue to exercise translating/tilting
global corners and pose, separate point/force rates, sensor offsets, interpolation,
crop/export/re-import and browser rendering with synthetic data. The full suite
also retains C3D same-format, force calibration, editing/history and privacy tests.

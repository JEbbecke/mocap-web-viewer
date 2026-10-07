# Current institute H5 validation

The ignored, read-only `reference-data/authoritative_reference.h5` defines the
supported institute schema described in [H5_FORMAT.md](H5_FORMAT.md). It is
unversioned, with nested metadata, eight event columns and independent stream
frame extents. Obsolete layouts and explicit collection versions are rejected.
No participant values are copied into fixtures, documentation or reports.

## Method and coverage

`tests/current-h5.test.ts` checks imports, unchanged/reconstructed export,
label aliases, event context/subject CRUD with source flags, undo/redo, unit
normalization, crop clocks and frame extents, optional collections, malformed
counts/columns and unsupported layouts. `tests/authoritative-h5.test.ts` retains
synthetic lifecycle, unknown-content guards and generic boolean-template checks.
Moving plates, force-channel reuse, Explorer and both conversions have dedicated
regressions. `tests/fixtures/current-h5.json` contains invented data only.

`tests/h5-empty-optional.test.ts` creates synthetic current-schema HDF5 in the
installed WASM library. It covers empty typed Labels/Units, omitted/empty groups,
zero-channel and zero-sample matrices, strict populated metadata/clock/axis
errors, empty events/plates/bodies/results/quality, sidebar/Explorer counts,
edit history, crop/rename H5 round trips and both cross-format directions.
See [empty semantics](H5_FORMAT.md#absent-and-empty-optional-data) for accepted
representations. Optional absence is not a scientific error or conversion loss.

The optional reference import opens the source with mode `r` and verifies its
bytes remain unchanged. Explicit export validation produces six ignored outputs:
reconstruction, rename, event edit, add, delete and crop. Assertions compare
booleans and structural paths so private values cannot appear in failure logs.
The independent h5py validator compares every object, attribute, dataset, shape,
scientific dtype, encoding and value. NaNs compare equal. Expected edits and
storage details are classified separately; unexplained differences fail.

Raw values remain paired with their original units. Crop selects each recognized
stream on its own physical clock, updates its sample/frame extents and retains
absolute timestamps. Independent IK/ID data, clocks, counts and opaque processing
metadata remain intact. Live label aliases and body membership follow renames;
embedded C3D EVENT parameters remain original provenance.

Modified output can change chunk/maxshape details and unused VLEN string padding
while retaining UTF-8 text, shape and values. Supported booleans keep native enum
types. Full-range unedited export returns the original bytes.

## Reproduce

Run the following from the repository; Python needs h5py and numpy.

```powershell
node scripts/inspect-h5.mjs
npm.cmd test
$env:JE_VALIDATE_REFERENCE = '1'
npm.cmd test -- tests/current-h5.test.ts
Remove-Item Env:JE_VALIDATE_REFERENCE
python scripts/validate-authoritative-h5.py --cleanup
npm.cmd run build
npm.cmd run test:browser
git check-ignore -v reference-data/authoritative_reference.h5
```

The structural inspector redacts private attributes and never reads scientific
dataset values. `--cleanup` removes only the six explicitly named generated
outputs after comparison, never the source. Reports remain under ignored
`.local/h5-validation/`. Browser checks use synthetic current-schema data and
intercept analytics locally.

`python scripts/create-h5-fixture.py` regenerates only the current synthetic
fixture. The boolean seed generator remains separate because it tests generic
HDF5 storage infrastructure, without representing a supported product layout.

## Scientific and interoperability limits

- IK/ID time zero has no declared relationship to trial time; no crop alignment
  or guessed model units are introduced. Explicit units take precedence over the
  limited, disclosed OpenSim rotation-name inference in Data Explorer.
- Body parent frames, marker Type codes, lab handedness and compass directions
  remain unestablished. Bodies follow the marker grid when counts agree.
- Marker clocks must be regular. Other signal clocks can be irregular. Declared
  counts/extents and all event columns are checked strictly; units are required
  for markers, rigid-body positions and populated Analog/EMG channels.
- Unknown temporal datasets/attributes, compound/reference/opaque types,
  arbitrary enums, named types, links and unsupported filters can block modified
  export. Malformed populated H5 force vectors/geometry fail with their structural
  path; unresolved coordinate conventions remain disclosed warnings. Obsolete
  geometry is a schema error.
- Independent h5py comparisons establish current-schema preservation. End-to-end
  compatibility with an external current institute reader remains a manual check;
  no obsolete institute reader is used as a correctness oracle.

See [release validation](VALIDATION.md) and [conversion limits](CROSS_FORMAT_EXPORT.md).

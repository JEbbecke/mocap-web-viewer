# Parser decisions and sources

## C3D

The reference requires markers, residuals, analog scaling/subframes, events and calibrated force types 2/3/4. The inspected `c3d` npm package is an unrelated 2014 Ethereum content-distribution package. The similarly named musculoskeletal/c3d-parser is a Python desktop/OpenSim application. No evaluated browser library provided a demonstrably validated replacement for ezc3d's force extraction. This is not a claim that none exists.

The application therefore uses a small isolated DataView parser, not a general-purpose C3D SDK. It validates parameter bounds, processor format, sample extents and timing, uses C3D column-major parameters, and preserves scaled analog samples. Unsupported DEC encoding and unverified rotation layouts fail explicitly; force types outside 2/3/4 produce visible warnings. Adding another parser does not affect rendering.

Scientific rules were checked against the local Python call path and ezc3d output over every sample in two representative trials, including type-3 polynomial correction and type-4 calibration. Primary references: [C3D point records](https://www.c3d.org/HTML/Documents/3dpointdata.htm), [C3D origin specification](https://www.c3d.org/HTML/Documents/forceplatformorigin.htm), and [ezc3d force-platform module](https://github.com/pyomeca/ezc3d/blob/dev/src/modules/ForcePlatforms.cpp). No force polarity correction is guessed from appearance.

Same-format C3D export copies raw source records and unrelated parameters; the
separate H5→C3D writer creates Intel/IEEE float32 records. It reuses validated
embedded TYPE-2/3/4 channel definitions where possible, otherwise adding derived
TYPE-2 channels per compatible stationary plate. Custom `JE_METADATA` parameters
carry imported recording facts. Independent ezc3d checks cover the documented
synthetic and local reference cases; other vendors, custom metadata display and
all reader implementations are not universally validated. See
[conversion mapping](CROSS_FORMAT_EXPORT.md).

### Separate Rotation extension: partial import

The [C-Motion Rotation extension](https://www.wiki.has-motion.com/doku.php?id=visual3d:documentation:c3d_signal_types:rotation_data_type)
stores each pose as 17 IEEE float32 values: a column-major 4x4 transformation and
one reliability value. Its `ROTATION:DATA_START` is a **one-based 512-byte block
number**, not a byte offset. This is consistent with the independent
[ezc3d rotation reader](https://github.com/pyomeca/ezc3d/blob/dev/src/Rotation.cpp)
and [separate section reader](https://github.com/pyomeca/ezc3d/blob/dev/src/Data.cpp).
The C-Motion page's Data paragraph mentions `POINT:DATA_START`; its parameter
table, ezc3d implementation and inspected local file instead locate the separate
section with `ROTATION:DATA_START`. No offset is inferred from this ambiguous text.

JE Motion Lab recognizes only a narrow, verifiable subset of this extension:

- Float Point/Analog storage, numeric scalar `ROTATION:USED`, `DATA_START`,
  `RATE`, and `RATIO`; rate must equal Point rate times a positive integer ratio.
- Exactly one nonempty, unique label per rotation signal, including segmented
  `LABELS2` etc. The extension's optional `FRAMES` counts rotation samples and
  must equal Point frames times ratio; absent `FRAMES` uses that same relationship.
- The separate rotation section starts at the first 512-byte boundary at or
  after the end of all standard Point/Analog frames. Interleaving, overlap,
  missing offsets, unknown rotation parameters/encoding declarations and gaps
  larger than alignment padding are rejected.
- The complete declared `frames * signals * 17 * 4` payload must fit. Alignment
  bytes and optional final-block padding must be zero; unexpected trailing
  records are rejected. Rotation values are not decoded or presented as samples.

These checks run before sample-array allocation. The existing Point/Analog
decoder and its frame stride stay intact: no rotation floats enter coordinate
or analog arrays. Source Point units, labels/order, residuals/validity, analog
scaling/subframes, events, supported force platforms and zero-based source-frame
origin retain their existing semantics. The compatibility decision uses structure,
not a filename or manufacturer. Other Rotation variants remain unsupported.

`MotionData.source.partialImport` records the omitted signal count/labels,
sampling rate/ratio, frame count, original block/byte range and known encoding.
Persistent import notes visibly identify the partial import; the existing notes
summary also exposes it while collapsed. These are warnings, not fatal errors.
Raw rotation matrices, translations and reliability metrics are unavailable in
the Viewer, Inspector and Explorer. They remain in the immutable original file.

C3D and H5 exports remain available for partial imports. Both formats open the
existing Export preview, including same-format C3D exports. Its **Changed or
omitted** section reports the actual omitted Rotation signal count and explains
that those signals will be absent from the output; users should keep the original
file. The existing Export button proceeds after that review, with no extra modal
or checkbox. Existing unrelated validation errors remain blocking. Fully supported
files retain their existing export behavior and conversion warnings.

The C3D serializer first validates the immutable source, removes the verified
separate Rotation payload and its entire parameter group, then uses the existing
source-preserving crop/event/label writers. Supported scientific records and
their original units/scaling remain together without requantization. Full-range
exports of partial imports also omit rotations and use an `_exported` filename
instead of `_copy`. H5 uses the existing semantic writer for supported data and
does not invent Rotation datasets. Cropping, marker/event edits, restore and
undo/redo retain the original session's source flag and warnings; exporting does
not clear them. Re-importing an exported supported subset has no Rotation claims
or partial-import warning because the output no longer declares those records.

The existing rigid-body representation contains position and optional 3x3
rotation series, but does not represent the 4x4 extension's reliability metric or
its complete serialization semantics. Full support needs an explicit pose/quality
mapping, validity and unit rules, editing/crop semantics, and C3D/H5 round-trip
writers with independent tests. This fix deliberately leaves that follow-up open.

`tests/c3d-rotation.test.ts` uses a small generated fixture; optional
`tests/c3d-local.test.ts` reads local private references without copying them.
The latter compares every Point/Analog sample and labels against a separate
Buffer-based scanner and checks the reference rotation record structure. No new
parser dependency or large binary fixture is included.

### Declared timing and the supplied Xsens references

The data provider confirmed that the supplied Xsens recordings were acquired at
**60 Hz**, while their C3D exporter incorrectly wrote **240 Hz** into the header,
`POINT:RATE` and `ROTATION:RATE`. The two local Xsens examples contain 3301 and
2143 point frames, with declared last-sample times of 13.750 s and 8.925 s.
At the confirmed acquisition rate their corresponding elapsed spans would be
55.000 s and 35.700 s. This diagnosis comes from the provider's confirmation;
it is not inferred from movement appearance or the exporter name.

JE Motion Lab correctly follows the declared source rate. Browser wall-clock
measurements and deterministic tests verify playback at 0.5x, 1x and 2x across
different rendering rates. The Timeline's end-time readout uses `(frames - 1) /
rate`, matching File Info and signal plots; crop boundaries retain their separate
half-open `frames / rate` convention.

No resampling, automatic rate correction, vendor-based playback adjustment or
effective-rate override is implemented. Point coordinates, units, source frames
and sampling-rate metadata are preserved. Supported-subset C3D/H5 exports also
retain the declared rate, so the supplied files' incorrect physical timing remains
until corrected upstream. The application does not claim to repair that timing
error. `QTM_Example.c3d` is a separate standard Qualisys recording at 200 Hz;
both `XSENSE_example.c3d` and `XSENSE_example_2.c3d` are used for local Xsens
validation without adding their bytes to Git or deployment assets.

## HDF5

[h5wasm](https://github.com/usnistgov/h5wasm) 0.10.3 supplies the HDF5 C implementation compiled to WebAssembly, including the compression used by inspected files. It reads a local File through WORKERFS in a dedicated Worker. Its embedded WASM and JS are bundled in a lazy application chunk; no CDN or WASM fetch is needed. The generic HDF5 layer is separate from the institute schema adapter. A real h5py-generated compressed synthetic fixture and actual private files exercise both layers.

The HDF5 browser bundle is approximately 4.8 MB before transport compression and loads when H5 reading or writing is first needed, including C3D→H5 export. The node entry point is used only by development tests/scripts. Each import closes the HDF5 handle, unmounts the file and terminates the worker, releasing the WASM heap. This trades repeat initialization for predictable memory release. The institute schema adapter supports only the current authoritative unversioned layout with nested metadata, not arbitrary HDF5 structures. Obsolete collection versions and geometry layouts fail explicitly. Fresh semantic H5 exports use that same current layout. Independent h5py validation checks preservation; external current institute-reader interoperability remains a manual validation requirement.

## Static deployment

JE Motion Lab's web app is hosted on GitHub Pages at [app.jemolab.com](https://app.jemolab.com/) using a custom domain. The workflow builds with `VITE_BASE_PATH=/`; the default outside CI remains relative (`./`). The separately maintained, SEO-optimized static landing page is [jemolab.com](https://jemolab.com/) and is not included in the app's `dist/` output.

Base-path and Pages workflow behavior follows the [Vite static deployment guide](https://vite.dev/guide/static-deploy.html#github-pages). The workflow pins action revisions. Production CSP uses `connect-src 'self' https://je-motion-analytics.jonasebbecke97.workers.dev`; local script/worker assets remain permitted. Development adds the inline preamble and local WebSocket connections required by Vite. Both modes send event-only analytics to the configured Cloudflare Worker; parser inputs, filenames, metadata and measurements remain local. See [analytics and network behavior](ANALYTICS.md).

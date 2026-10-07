# Parser decisions and sources

## C3D

The reference requires markers, residuals, analog scaling/subframes, events and calibrated force types 2/3/4. The inspected `c3d` npm package is an unrelated 2014 Ethereum content-distribution package. The similarly named musculoskeletal/c3d-parser is a Python desktop/OpenSim application. No evaluated browser library provided a demonstrably validated replacement for ezc3d's force extraction. This is not a claim that none exists.

The application therefore uses a small isolated DataView parser, not a general-purpose C3D SDK. It validates parameter bounds, processor format, sample extents and timing, uses C3D column-major parameters, and preserves scaled analog samples. Unsupported DEC encoding/nonstandard rotation records fail explicitly; force types outside 2/3/4 produce visible warnings. Adding another parser does not affect rendering.

Scientific rules were checked against the local Python call path and ezc3d output over every sample in two representative trials, including type-3 polynomial correction and type-4 calibration. Primary references: [C3D point records](https://www.c3d.org/HTML/Documents/3dpointdata.htm), [C3D origin specification](https://www.c3d.org/HTML/Documents/forceplatformorigin.htm), and [ezc3d force-platform module](https://github.com/pyomeca/ezc3d/blob/dev/src/modules/ForcePlatforms.cpp). No force polarity correction is guessed from appearance.

Same-format C3D export copies raw source records and unrelated parameters; the
separate H5→C3D writer creates Intel/IEEE float32 records. It reuses validated
embedded TYPE-2/3/4 channel definitions where possible, otherwise adding derived
TYPE-2 channels per compatible stationary plate. Custom `JE_METADATA` parameters
carry imported recording facts. Independent ezc3d checks cover the documented
synthetic and local reference cases; other vendors, custom metadata display and
all reader implementations are not universally validated. See
[conversion mapping](CROSS_FORMAT_EXPORT.md).

## HDF5

[h5wasm](https://github.com/usnistgov/h5wasm) 0.10.3 supplies the HDF5 C implementation compiled to WebAssembly, including the compression used by inspected files. It reads a local File through WORKERFS in a dedicated Worker. Its embedded WASM and JS are bundled in a lazy application chunk; no CDN or WASM fetch is needed. The generic HDF5 layer is separate from the institute schema adapter. A real h5py-generated compressed synthetic fixture and actual private files exercise both layers.

The HDF5 browser bundle is approximately 4.8 MB before transport compression and loads when H5 reading or writing is first needed, including C3D→H5 export. The node entry point is used only by development tests/scripts. Each import closes the HDF5 handle, unmounts the file and terminates the worker, releasing the WASM heap. This trades repeat initialization for predictable memory release. The institute schema adapter supports only the current authoritative unversioned layout with nested metadata, not arbitrary HDF5 structures. Obsolete collection versions and geometry layouts fail explicitly. Fresh semantic H5 exports use that same current layout. Independent h5py validation checks preservation; external current institute-reader interoperability remains a manual validation requirement.

## Static deployment

JE Motion Lab's web app is hosted on GitHub Pages at [app.jemolab.com](https://app.jemolab.com/) using a custom domain. The workflow builds with `VITE_BASE_PATH=/`; the default outside CI remains relative (`./`). The separately maintained, SEO-optimized static landing page is [jemolab.com](https://jemolab.com/) and is not included in the app's `dist/` output.

Base-path and Pages workflow behavior follows the [Vite static deployment guide](https://vite.dev/guide/static-deploy.html#github-pages). The workflow pins action revisions. Production CSP uses `connect-src 'self' https://je-motion-analytics.jonasebbecke97.workers.dev`; local script/worker assets remain permitted. Development adds the inline preamble and local WebSocket connections required by Vite. Both modes send event-only analytics to the configured Cloudflare Worker; parser inputs, filenames, metadata and measurements remain local. See [analytics and network behavior](ANALYTICS.md).

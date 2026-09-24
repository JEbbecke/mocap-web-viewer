# Parser decisions and sources

## C3D

The reference requires markers, residuals, analog scaling/subframes, events and calibrated force types 2/3/4. The inspected `c3d` npm package is an unrelated 2014 Ethereum content-distribution package. The similarly named musculoskeletal/c3d-parser is a Python desktop/OpenSim application. No evaluated browser library provided a demonstrably validated replacement for ezc3d's force extraction. This is not a claim that none exists.

The first version therefore uses a small isolated DataView parser, not a general-purpose C3D SDK. It validates parameter bounds, processor format, sample extents and timing, uses C3D column-major parameters, and preserves scaled analog samples. Unsupported DEC encoding/nonstandard rotation records fail explicitly; force types outside 2/3/4 produce visible warnings. Adding another parser does not affect rendering.

Scientific rules were checked against the local Python call path and ezc3d output over every sample in two representative trials, including type-3 polynomial correction and type-4 calibration. Primary references: [C3D point records](https://www.c3d.org/HTML/Documents/3dpointdata.htm), [C3D origin specification](https://www.c3d.org/HTML/Documents/forceplatformorigin.htm), and [ezc3d force-platform module](https://github.com/pyomeca/ezc3d/blob/dev/src/modules/ForcePlatforms.cpp). No force polarity correction is guessed from appearance.

## HDF5

[h5wasm](https://github.com/usnistgov/h5wasm) 0.10.3 supplies the HDF5 C implementation compiled to WebAssembly, including the compression used by inspected files. It reads a local File through WORKERFS in a dedicated Worker. Its embedded WASM and JS are bundled in a lazy application chunk; no CDN or WASM fetch is needed. The generic HDF5 layer is separate from the institute schema adapter. A real h5py-generated compressed synthetic fixture and actual private files exercise both layers.

The HDF5 browser bundle is approximately 4.8 MB before transport compression and loads only when H5 is first opened. The node entry point is used only by tests. Each import closes the HDF5 handle, unmounts the file and terminates the worker, releasing the WASM heap. This trades repeat initialization for predictable memory release.

## Static deployment

Base-path and Pages workflow behavior follows the [Vite static deployment guide](https://vite.dev/guide/static-deploy.html#github-pages). The workflow pins action revisions. A production CSP uses `connect-src 'none'`; local script/worker assets remain permitted. Development adds the inline preamble and local WebSocket connection required by Vite. No third-party network endpoint is configured in either mode.

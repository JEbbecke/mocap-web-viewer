# Licensing and third-party provenance

This document records current distribution obligations and the remaining native
provenance review. Recheck the actual production bundles whenever dependencies or
imports change; installed packages alone do not identify distributed components.

## Project authorship and terms

Repository authorship inspection identified only Jonas Ebbecke. Git authorship
does not independently establish employer assignments or ownership of material
added outside Git; the copyright holder must confirm those before promotion.

The current project license is PolyForm Noncommercial License 1.0.0. `LICENSE.md`
is the unmodified official download from
<https://polyformproject.org/licenses/noncommercial/1.0.0.txt>.
`NOTICE` uses the license's `Required Notice:` prefix for copyright and project
name. The dialog bundles both texts. SPDX and CFF 1.2.0 recognize
`PolyForm-Noncommercial-1.0.0`; package, root lockfile and citation license fields
use that identifier. Release preparation keeps citation version/date synchronized with the package
and planned promotion date.

This change applies to the current repository state and future releases. It
does not revoke rights already granted for prior Apache-licensed distributions.
History, tags and releases are unchanged. The README describes only the current
license; it does not direct readers to historical revisions.

## Production dependencies

The direct production dependencies at the locked versions are:

| Component          | Version | License / browser obligations                                                                 |
| ------------------ | ------- | --------------------------------------------------------------------------------------------- |
| @react-three/drei  | 10.7.8  | MIT: preserve copyright and permission text                                                   |
| @react-three/fiber | 9.8.0   | MIT: preserve copyright and permission text                                                   |
| h5wasm             | 0.10.3  | NIST notice, including HDF5 notices: retain the complete supplied notice and acknowledge NIST |
| react              | 19.3.0  | MIT: preserve copyright and permission text                                                   |
| react-dom          | 19.3.0  | MIT: preserve copyright and permission text                                                   |
| three              | 0.180.0 | MIT: preserve copyright and permission text                                                   |
| uplot              | 1.6.32  | MIT: preserve copyright and permission text                                                   |
| zustand            | 5.0.15  | MIT: preserve copyright and permission text                                                   |

Vite/Rollup chunk module inspection covered the main build and all module workers.
Additional bundled npm components are @babel/runtime 7.29.7, its-fine 2.0.0,
react-use-measure 2.1.7, scheduler 0.28.0, three-stdlib 2.36.1, and
use-sync-external-store 1.7.0, all MIT. Fiber embeds React reconciler code with
Meta Platforms attribution, covered by the preserved React MIT notice.
The fiber npm archive omits its LICENSE, so its exact license was retrieved from
<https://github.com/pmndrs/react-three-fiber/blob/v9.8.0/LICENSE>.

h5wasm's CMakeLists identifies the HDF5 2.0.0 archive from libhdf5-wasm
`v0.6.0_4.0.23`. The archive's hdf5-config.cmake confirms statically linked zlib
and libaec/SZIP support. The notices include HDF5 2.0.0's supplied license,
zlib's notice and libaec's BSD notice, in addition to h5wasm's complete notice.
The Emscripten runtime and bundled musl copyright/license notices are also
preserved from the upstream 4.0.23 toolchain identified by the build archive.
The archive's compression config files do not declare version numbers. Before
the promoted release, confirm the exact native compression/runtime provenance
with upstream, including any additional runtime component notices; the npm
metadata alone cannot establish it. No compression version is asserted here.

Release preparation rechecked h5wasm 0.10.3's installed CMakeLists and the matching
[upstream source](https://github.com/usnistgov/h5wasm/blob/v0.10.3/CMakeLists.txt).
The retained HDF5 archive matches its required SHA256
`d4dc6719ef164679728d9a50d6a4d97c826f563e22a40c4dec63e485b29781be`.
The matching [libhdf5-wasm workflow](https://github.com/usnistgov/libhdf5-wasm/blob/v0.6.0_4.0.23/.github/workflows/build.yaml)
derives the Emscripten SDK from the release tag. Its compression version overrides
are commented out; the archive's zlib/libaec version-config files have empty
version fields. These establish the build inputs and static support but do not
conclusively identify every native constituent of the npm WASM binary. The review
gate below therefore remains open; do not turn commented example versions into
provenance claims.

Original copyright, permission text, conditions and disclaimers are preserved in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), bundled in the License dialog.
MIT and BSD redistribution require these materials even for minified browser
code or embedded WebAssembly. No separate upstream NOTICE file was found among
the bundled npm components. The project's PolyForm terms do not relicense them.

## Remaining references and scope

The remaining Apache-2.0 license metadata belongs to dependencies:
@dimforge/rapier3d-compat, @mediapipe/tasks-vision, draco3d, hls.js and
promise-worker-transferable are installed production dependencies but absent
from this application's current bundles. @playwright/test, playwright,
playwright-core, baseline-browser-mapping, expect-type and typescript are
development dependencies. Their lockfile licenses remain unchanged; adding their
code/assets to a future distribution requires another notice review.

Release notes describe the net PolyForm release state. Historical intermediate
project-license changes remain in Git. Third-party notices retain their original
license names and commercial permissions; they do not describe the project license.
Privacy and Imprint remain separately maintained external pages.

## Release verification and review gate

Build with the production base, inspect Rollup module inventories for the main
bundle and all workers, and compare bundled package versions/licenses against
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Verify the in-app legal dialog
with `npm run test:browser`; it must contain the exact project license, required
notices, third-party notices and commercial-license contact.

**MANUAL RELEASE CHECK REQUIRED:** establish exact native zlib/libaec and runtime
provenance, including additional runtime obligations, against upstream build
metadata or written upstream confirmation. Available notices are preserved;
the identified HDF5/toolchain archive does not prove every constituent version.
Do not treat passing application tests as legal clearance.

Earlier audit runs observed intermittent post-crop native-image dimensions and
large-model Explorer read failures. Preserve those assertions and repeat clean
Chrome/Edge smoke runs on each release candidate. Record actual outcomes in the
release readiness report rather than carrying old test counts forward here.

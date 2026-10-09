# Current licensing audit

Audit performed on 9 October 2026 for `chore/noncommercial-license`, based on
commit `9296448` and its lockfile. Application and citation versions remain 0.4.0.

## Project authorship and terms

`git shortlog -sne --all` and unique commit-author inspection found only Jonas
Ebbecke: Jonas Ebbecke / JEbbecke with `jonasebbecke97@gmail.com`, and JonasEb
with `j.ebbecke@dshs-koeln.de`. No external human contributor or unresolved
contribution permission was identified in the recorded history. Git authorship
does not independently establish employer assignments or ownership of material
added outside Git; the copyright holder should confirm those before release.

The current project license is PolyForm Noncommercial License 1.0.0. `LICENSE`
is the unmodified official download from
<https://polyformproject.org/licenses/noncommercial/1.0.0.txt>.
`NOTICE` uses the license's `Required Notice:` prefix for copyright and project
name. The dialog bundles both texts. SPDX and CFF 1.2.0 recognize
`PolyForm-Noncommercial-1.0.0`; package, root lockfile and citation license fields
use that identifier. Citation version, release date and other metadata are
unchanged.

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

CHANGELOG's PR #12 entry accurately records the prior licensing addition and
remains historical context. The browser regression also names Apache as wording
that must be absent from current legal presentation. No project-owned Apache
source headers or current open-source claims remain. Third-party license texts
retain their original descriptions and commercial permissions.
Emscripten and musl notices describe those external projects as open source;
these original upstream descriptions do not describe JE Motion Lab's license.

README, RELEASING and Unreleased changelog wording are updated. ARCHITECTURE,
OPEN_QUESTIONS and VALIDATION were inspected and require no licensing correction.
Privacy/Imprint continue to use their existing external pages; no privacy
behavior or separately maintained landing-page content is changed.

## Validation

- `npm test`: 358 passed; three optional reference tests skipped.
- `npm run typecheck`, `npm run build`, `npm run format:check` and
  `git diff --check`: passed.
- CITATION.cff passed the official CFF 1.2.0 JSON Schema with date/URL format
  validation. LICENSE matched the official download byte for byte.
- Production legal checks passed at startup and with an imported recording,
  including exact bundled license/notices, commercial wording, close/Escape,
  Privacy/Imprint URLs and desktop/mobile navigation (390–1440 px).
- The complete browser smoke passed for the updated build on an isolated preview
  port, and for the unchanged HEAD baseline. Earlier updated-build runs had an
  intermittent post-crop native-image dimension mismatch and a large-model
  Explorer read failure. Existing assertions were preserved. Recheck these
  workflows on the final release commit before promotion.

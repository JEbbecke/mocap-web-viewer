# Versioning and manual releases

JE Motion Lab uses Semantic Versioning (`MAJOR.MINOR.PATCH`). During pre-1.0
development, increment the minor version for meaningful functionality and the
patch version for fixes or small improvements. Reserve `1.0.0` for an intentionally
stable release; pre-1.0 compatibility and supported scientific formats can evolve.

The latest formal GitHub release is [v0.4.0](https://github.com/JEbbecke/mocap-web-viewer/releases/tag/v0.4.0),
published on 28 September 2026 at commit `efc2189d0d2260781c09cefa6f6b4f8fb9c6a17c`
and containing the initial application and PRs #1–#4. Its tag was created at
06:30:11 UTC and the release published at 06:32:12 UTC. PRs #5–#14 merged
afterward and remain under `[Unreleased]`: analytics, mm units and version
reconciliation, File Info, the Data sidebar, data-label editing and shared
undo/redo (#9), the custom-domain root base path (#10), the updated institute
H5 schema (#11), and Data Explorer, the sidebar fix, branding/domains, privacy/imprint
links and license/citation metadata (#12). GitHub releases, merged PRs and the
local tag target were checked again on 7 October 2026. PRs #13–#14 add both
cross-format exports, compatibility/loss review, original force-channel reuse,
metadata mapping and final terminology/documentation refinements. These remain
unreleased; they do not imply a new formal release.

The tagged package files incorrectly retained `0.1.0`. Current development
corrects them to `0.4.0` without moving the published tag or inventing another
release. Always inspect GitHub releases, tag targets and commit ancestry before
choosing a version; local package files alone do not establish release history.

## Cleanup and separate release preparation

The `chore/release-cleanup` branch prepares current-schema code, tests and docs
for review. It does not bump package/lockfile/CITATION version or citation date,
move Unreleased into a numbered section, commit/push/merge, tag or publish a
release. After cleanup is merged, prepare the next promoted public release in a
separate release-preparation branch, following the mechanics below. Include the
pre-1.0 breaking removal of obsolete institute H5 layouts in release notes.

## One version source

[`package.json`](../package.json) is authoritative. npm maintains the matching root
entries in [`package-lock.json`](../package-lock.json). [Vite](../vite.config.ts)
imports the package version and injects `__APP_VERSION__` as a string at build time;
[`src/vite-env.d.ts`](../src/vite-env.d.ts) declares its type and the
[application footer](../src/App.tsx) renders `v` followed by that version. No runtime
request or independent source-code version is needed.
Restart the dev server or rebuild after changing the package version. The browser
smoke check compares the rendered footer against the package version.

When preparing a formal release, keep [CITATION.cff](../CITATION.cff)'s `version`
in sync with the package and set `date-released` to the actual release date.
Ordinary unreleased changes do not advance either field. Citation metadata
requests scholarly credit. The [PolyForm Noncommercial License 1.0.0](../LICENSE) defines the license
conditions, and [NOTICE](../NOTICE) records the required project notices.
[Third-party notices](../THIRD_PARTY_NOTICES.md) preserve the separate component licenses.

The footer opens a local Noncommercial License dialog with the exact bundled
license, required notices, third-party notices and commercial-license contact
link. It also links to [Privacy](https://jemolab.com/privacy.html) and
[Imprint](https://jemolab.com/imprint.html). These external pages are the single
source of truth for Privacy and Imprint text; release notes describe the links without copying
their contents into the repository.

[README](../README.md) describes capabilities without a duplicated current-version
label. [CHANGELOG](../CHANGELOG.md) records numbered release entries only when
formally released. PR #4 belongs under `[0.4.0]`; PRs #5–#14 and subsequent
changes belong under `[Unreleased]` until released.
Keep the latest formal version in the package and footer while unreleased work
accumulates. A version bump happens when intentionally preparing the next release,
so the footer alone does not identify a particular development commit.

## Before an ordinary feature merge

Inspect the repository and GitHub before reconciling documentation:

```sh
git status
git branch --show-current
git log --oneline --decorate -20
git tag --list --sort=-version:refname
gh release list
gh pr list --state merged --limit 20
```

Use the published release's actual tag target to separate released and unreleased
commits. Update README, relevant docs and `[Unreleased]` to match implemented
behavior. Keep package/lockfile/footer at the latest formal version for an ordinary
feature merge: this workflow does not require a version bump on each merge.
Do not create a numbered release entry, tag or GitHub Release as part of this check.

Run `npm test`, `npm run build`, `git diff --check` and `git status`; inspect
failures and staged paths before committing. The optional private-reference tests
skip only when their ignored oracle manifest is absent. A stale manifest with
missing source files causes failures and must be reported separately from the
synthetic regressions. Do not hide those failures by changing scientific tests or
committing private data; require passing PR checks before merging.

For media-export changes, also run typecheck, format checks and the browser smoke
on Chrome and Edge. Verify native PNG dimensions, camera framing, watermark
toggle, cropped-frame/visibility fidelity and scientific state safety. Check
Safari and Samsung Internet manually before promoting the release; hardware
and memory limits should produce a recoverable error. Keep media export under
Unreleased and leave the version unchanged until intentional release preparation.

Verify native WebM playback, 30/60 fps, slow motion, recorded-span/crop endpoints,
codec fallback, progress/cancellation, unsupported-video image availability and
unchanged timeline/playback/history. Video uses explicit offline timestamps;
never substitute performance-dependent live capture for physical-time validation.
Manual Safari/Samsung video checks are required before compatibility claims.

## Licensing checks before release

- Verify [LICENSE](../LICENSE) matches the exact official PolyForm Noncommercial
  License 1.0.0 text and [NOTICE](../NOTICE) preserves the copyright and
  `Required Notice:` lines for Jonas Ebbecke / JE Motion Lab.
- Review production bundle dependencies after any dependency/import change;
  update [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) with the applicable
  original copyright, license texts and any upstream NOTICE requirements.
  Revisit native WebAssembly provenance limits recorded in the
  [licensing audit](LICENSING_AUDIT.md).
- Check the README describes the current source-available license and separate
  commercial licensing, and validate CITATION.cff against the CFF 1.2.0 schema.
- Build and inspect the in-app License dialog, full terms and third-party notices;
  verify footer navigation, Privacy and Imprint links and startup/workspace behavior.
- Confirm the distribution includes LICENSE, required notices and third-party
  notices (bundled in the dialog); do not edit generated dist files.

## Prepare an intentional release through a pull request

Develop features and fixes on feature branches and merge through reviewed PRs.
Keep notable changes under `[Unreleased]`, grouped as Added, Changed, Fixed or
Removed as appropriate. Before release, check existing tags/releases:

```sh
git fetch origin --tags
git tag --list 'v*' --sort=-version:refname
gh release list
gh release view <latest-release-tag>
git show <latest-release-tag>:package.json
git log <latest-release-tag>..HEAD --oneline
gh pr list --state merged --limit 50
git switch main
git pull --ff-only origin main
git switch -c release/prepare
```

Replace `<latest-release-tag>` with the verified tag (currently `v0.4.0`). Check
the tag's commit, not only the release's target branch name: `main` can advance
after publication. Use the actual publication date and tagged contents in the
changelog; later merges and unmerged working changes remain `[Unreleased]`.

Choose the version before running commands. For a later functionality release use
`npm version minor --no-git-tag-version`; for a patch use
`npm version patch --no-git-tag-version`. An explicit chosen version can be
set with `npm version X.Y.Z --no-git-tag-version` (replace `X.Y.Z`). Never edit
lockfile versions independently.

Move the Unreleased notes into `## [X.Y.Z] - YYYY-MM-DD`, using the actual release
date, and leave an empty `[Unreleased]` section above it. Update the comparison
links to the new release tag. Do not duplicate previously released changes or
describe commit dates as release dates.

```sh
npm ci
npm test
npm run build
npm run test:browser
git diff --check
git diff
git status --short
git add package.json package-lock.json CHANGELOG.md CITATION.cff
git diff --cached
git commit -m "Prepare release"
git push -u origin release/prepare
gh pr create --base main --title "Prepare release" --body "Update the changelog and package version for release."
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`. Review and merge the
release PR using the normal repository process. Keep participant recordings,
`reference-data/`, private outputs and `.local/` out of commits and release assets.
`npm run build` includes typechecking. The browser check verifies the footer
version and intercepts analytics locally; it does not validate the separately
managed Worker/D1 deployment. Review [analytics verification limits](ANALYTICS.md)
when releasing changes to the analytics contract.

## Tag the reviewed commit and publish

After the release PR is merged and its checks pass, obtain the reviewed commit
SHA from that PR. Tags must point to that exact commit, even if main has advanced.
The following examples use PowerShell and derive the tag from the package:

```powershell
git fetch origin --tags
git switch --detach <reviewed-release-commit-sha>
$releaseVersion = node -p "require('./package.json').version"
$releaseTag = "v$releaseVersion"
git show --stat HEAD
git tag -a $releaseTag -m "JE Motion Lab $releaseTag"
git push origin $releaseTag
```

Replace the SHA placeholder and verify the commit, changelog, version and passing
checks before tagging. Copy the matching CHANGELOG release section into a local
`.local/release-notes.md` file, then publish:

```powershell
gh release create $releaseTag --verify-tag --title "JE Motion Lab $releaseTag" --notes-file .local/release-notes.md
git switch main
```

Use `--prerelease` only for intentionally designated preview releases; pre-1.0
numbering alone does not require that GitHub flag. Never move or overwrite a
published release tag; ship a new patch for corrections.

The SEO-optimized static landing page is [jemolab.com](https://jemolab.com/).
The application is [app.jemolab.com](https://app.jemolab.com/), using a GitHub Pages
custom domain configured in the repository's Pages settings. The landing page is
maintained separately and is not part of this repository's application release.

GitHub Pages continues to deploy the web app from `main` through
[deploy.yml](../.github/workflows/deploy.yml). Pull requests run checks without
deployment. Pushing a tag or creating a GitHub Release does not trigger a Pages
deployment. Pages can therefore show newer development than the latest release.
Manual workflow runs deploy only from main. The workflow builds with
`VITE_BASE_PATH=/` for `app.jemolab.com`. CI runs `npm ci`, `npm test` and
`npm run build`; browser checks remain a local release step. There is no automated
release, package publication or Cloudflare Worker/D1 deployment workflow.

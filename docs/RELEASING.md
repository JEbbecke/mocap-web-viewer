# Versioning and manual releases

JE Motion uses Semantic Versioning (`MAJOR.MINOR.PATCH`). During pre-1.0
development, increment the minor version for meaningful functionality and the
patch version for fixes or small improvements. Reserve `1.0.0` for an intentionally
stable release; pre-1.0 compatibility and supported scientific formats can evolve.

The existing package version is retained as the recommended first formal release:
it has been present since the initial commit, and the inspected local history has
no release tags. Substantial functionality alone does not justify inventing earlier
numbered releases. Check remote tags and GitHub Releases before the first release.

## One version source

`package.json` is authoritative. npm maintains the matching root entries in
`package-lock.json`. Vite imports the package version and injects `__APP_VERSION__`
as a string at build time; `src/vite-env.d.ts` declares its type and the existing
footer renders it. No runtime request or independent source-code version is needed.
Restart the dev server or rebuild after changing the package version. The browser
smoke check compares the rendered footer against the package version.

README describes capabilities without a duplicated current-version label.
CHANGELOG records historical versions only when formally released.

## Prepare through a pull request

Develop features and fixes on feature branches and merge through reviewed PRs.
Keep notable changes under `[Unreleased]`, grouped as Added, Changed, Fixed or
Removed as appropriate. Before release, check existing tags/releases:

```sh
git fetch origin --tags
git tag --list 'v*' --sort=-version:refname
gh release list
git switch main
git pull --ff-only origin main
git switch -c release/prepare
```

Choose the version before running commands. For a later functionality release use
`npm version minor --no-git-tag-version`; for a patch use
`npm version patch --no-git-tag-version`. For the first formal release, retaining
the current package version requires no bump. An explicit chosen version can be
set with `npm version X.Y.Z --no-git-tag-version` (replace `X.Y.Z`). Never edit
lockfile versions independently.

Move the Unreleased notes into `## [X.Y.Z] - YYYY-MM-DD`, using the actual release
date, and leave an empty `[Unreleased]` section above it. For the first release,
summarize the shipped baseline capabilities in that release entry and retain the
dated development baseline as provenance. Do not describe commit dates as past
release dates.

```sh
npm ci
npm test
npm run build
npm run test:browser
git diff --check
git diff
git status --short
git add package.json package-lock.json CHANGELOG.md
git diff --cached
git commit -m "Prepare release"
git push -u origin release/prepare
gh pr create --base main --title "Prepare release" --body "Update the changelog and package version for release."
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`. Review and merge the
release PR using the normal repository process. Keep participant recordings,
`reference-data/`, private outputs and `.local/` out of commits and release assets.

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
git tag -a $releaseTag -m "JE Motion $releaseTag"
git push origin $releaseTag
```

Replace the SHA placeholder and verify the commit, changelog, version and passing
checks before tagging. Copy the matching CHANGELOG release section into a local
`.local/release-notes.md` file, then publish:

```powershell
gh release create $releaseTag --verify-tag --title "JE Motion $releaseTag" --notes-file .local/release-notes.md
git switch main
```

Use `--prerelease` only for intentionally designated preview releases; pre-1.0
numbering alone does not require that GitHub flag. Never move or overwrite a
published release tag; ship a new patch for corrections.

GitHub Pages continues to deploy from `main` through
[deploy.yml](../.github/workflows/deploy.yml). Pull requests run checks without
deployment. Pushing a tag or creating a GitHub Release does not trigger a Pages
deployment. Pages can therefore show newer development than the latest release.
There is no automated release or package publication workflow.

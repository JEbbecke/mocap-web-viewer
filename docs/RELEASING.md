# Maintainer release process

JE Motion Lab uses Semantic Versioning. Before 1.0, minor releases may include breaking changes to supported scientific formats; document those changes explicitly.

Preparation, review, tagging, deployment, and promotion are separate steps.

## Establish the release baseline

Work on a dedicated release-preparation branch created from an up-to-date `main` branch.

Before preparing a release:

- fetch tags and remote branches;
- identify the latest published GitHub Release and its tag;
- compare commits and merged pull requests since that release;
- confirm every intended release feature is merged and present in branch ancestry;
- confirm no release-critical pull request remains open.

Do not infer release history from package versions alone. Published tags and releases are the authoritative historical baseline.

## Prepare the candidate

Choose the target version and update it with npm so `package.json` and `package-lock.json` remain synchronized:

```sh
npm version X.Y.Z --no-git-tag-version
```

Keep `private: true`.

Reconcile `CHANGELOG.md` with Git and pull-request history. Release notes should describe the net behavior users receive, not temporary intermediate states that were never released.

For each release:

- move curated entries from `Unreleased` into a dated version section;
- leave a new empty `Unreleased` section;
- update comparison links;
- synchronize `CITATION.cff` version and release date;
- validate `CITATION.cff` against the current CFF schema;
- review README and technical documentation for stale behavior, screenshots, links, branding, limitations, and terminology.

Public screenshots must use synthetic or otherwise releasable data only.

Keep the human-facing GitHub Release notes concise. Draft them in an ignored local file such as:

```text
.local/release-notes-vX.Y.Z.md
```

Per-release evidence, checklists, validation results, and temporary observations belong in ignored local files such as:

```text
.local/release-readiness-vX.Y.Z.md
```

Do not commit those local release working files.

## Validate the release candidate

Run the complete automated validation suite on the exact candidate that is intended for release.

At minimum verify:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run format:check
git diff --check
npm run test:browser
npm audit
npm audit --omit=dev
```

Classify vulnerability findings by dependency path, whether they are production or development-only, whether affected code is actually distributed or exercised, and whether a compatible fix exists.

Do not blindly run `npm audit fix` on a release candidate.

Run the applicable scientific validation tools, including authoritative H5 and independent h5py/ezc3d checks where their required local reference inputs are available. Treat unavailable optional private inputs as skipped, not passed.

Inspect generated production assets and tracked files for:

- participant or private recordings;
- local reference data;
- generated development output;
- credentials or secrets;
- local filesystem paths;
- stale legal or branding information.

Do not edit generated `dist` files manually.

Verify production configuration, including:

- canonical `https://app.jemolab.com/` URL;
- production asset paths;
- displayed version;
- Privacy and Imprint links;
- current license and required notices;
- third-party notices;
- analytics CSP and production endpoint behavior.

## Scientific interoperability checks

Automated validation does not replace every external-reader or browser interoperability check.

Before promotion, where applicable:

- import the current authoritative H5 file;
- perform a harmless supported edit or crop;
- export H5;
- open the result in the current external institute reader;
- verify structure, values, units, event timing, and crop extents;
- optionally repeat C3D → JE Motion Lab → H5 when relevant to the release.

Document any unresolved interoperability boundary rather than implying support that has not been verified.

## Browser acceptance

Run automated browser smoke tests on supported desktop browser channels where available.

Before a promoted release, perform manual acceptance checks on representative supported browsers and devices, including Safari and Samsung Internet when those environments cannot be covered by automated testing.

Prioritize workflows that depend strongly on browser APIs, including:

- file import;
- Data Explorer selection and plotting;
- crop interaction;
- image export;
- video export and playback;
- cancellation and recoverable error handling;
- unsupported-video fallback behavior.

Do not claim manual browser validation that was not actually performed.

## Licensing and legal checks

Verify that the current project license and application presentation are consistent across:

- `LICENSE.md`;
- `NOTICE`;
- `README.md`;
- package metadata;
- `CITATION.cff`;
- the in-app legal/license view.

JE Motion Lab's own code and third-party components may be distributed under different licenses. Preserve applicable third-party notices and do not remove valid upstream license text.

Review `THIRD_PARTY_NOTICES.md` against the actual production bundle whenever dependencies change.

Application tests do not establish legal clearance. Any unresolved provenance or licensing question must remain an explicit manual release gate until reviewed.

## Review before promotion

Before tagging, review the exact release commit and confirm that all automated, manual, scientific, and legal gates required for the release are complete.

Also review repository and deployment presentation, including:

- GitHub About description;
- homepage URL;
- repository topics;
- current license display;
- branch protection/rulesets where applicable;
- Pages custom domain;
- HTTPS enforcement;
- live production deployment.

If the planned release date changes, update release dates in the changelog and citation metadata before tagging.

## Tag and publish

Tag the reviewed release commit, not an arbitrary newer `main` commit.

Use an annotated semantic-version tag such as:

```text
vX.Y.Z
```

Publish the corresponding GitHub Release with the title:

```text
JE Motion Lab vX.Y.Z
```

Never move an already published release tag. Corrections to a published release should be issued as a new patch release.

Pre-1.0 version numbers do not automatically require GitHub's prerelease flag.

JE Motion Lab is not published to npm.

## Deployment

GitHub Pages deploys the application from `main` through the repository deployment workflow using the production base path.

Pull requests run validation without deployment. Browser smoke remains a release gate rather than a deployment trigger.

Tags and GitHub Releases do not themselves deploy the application, so the live application can be newer than the latest published release if `main` has advanced.

The public landing page at `https://jemolab.com/` and the analytics backend are maintained separately and should be reviewed as part of coordinated release promotion when relevant.

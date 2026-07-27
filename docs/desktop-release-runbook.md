# Desktop 1.0 release and recovery runbook

This runbook is the maintainer-facing procedure for the Tileborne desktop editor. The
machine-readable owner is [`scripts/desktop-release-policy.json`](../scripts/desktop-release-policy.json),
the verifier is [`scripts/desktop-release-contract.mjs`](../scripts/desktop-release-contract.mjs),
and the implementation audit is
[`docs/desktop-release-capability-audit.md`](desktop-release-capability-audit.md).
If prose and the closed-schema policy disagree, stop and fix the drift; prose never broadens the
policy.

## Current decision

Release `0.0.1` is source-only; desktop binary distribution remains **NO-GO** and no desktop artifact is published.

macOS arm64 is the only 1.0 candidate, not a supported release yet. Its automatic-update path is
candidate-gated by the same machine contract and native oracle, not by prose. An evidence-free checkout
deterministically reports:

```sh
pnpm release:desktop:policy
pnpm release:desktop:status
pnpm release:desktop:docs
```

The second command must exit successfully with `decision: "no-go"` and these stable blockers:

<!-- desktop-release-baseline-blockers:start -->

| Blocker                         | Contract meaning                                    |
| ------------------------------- | --------------------------------------------------- |
| `artifact.manifest-missing`     | Desktop release manifest is required.               |
| `artifact.file-missing`         | Candidate DMG is required.                          |
| `artifact.update-file-missing`  | Candidate update ZIP is required.                   |
| `signing.approved-team-missing` | Explicit approved Apple TeamIdentifier is required. |
| `publish.approval-missing`      | Explicit desktop publication approval is absent.    |
| `publish.credential-missing`    | Scoped publication credential is absent.            |

<!-- desktop-release-baseline-blockers:end -->

Other `artifact.*`, `provenance.*`, `signing.*`, or `native.*` blockers mean the
local artifact evidence is invalid. `publish.*` blockers mean the artifact may be locally ready,
but publication is not authorized. Never relabel a blocker as a warning to obtain a GO.

## Support matrix

This visible table is the exact machine-owned projection; the required docs gate compares every
cell with the validated policy.

<!-- desktop-release-support:start -->

| Policy id                           | Surface                  | Status             | Reason                                                                                                                                |
| ----------------------------------- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.macos-arm64`              | macOS arm64              | `candidate`        | The only desktop 1.0 candidate; distribution remains fail-closed until every required receipt verifies.                               |
| `platform.macos-x64`                | macOS x64                | `unsupported`      | No native x64 signed installer or install/launch evidence exists.                                                                     |
| `platform.windows`                  | Windows                  | `unsupported`      | Forge maker configuration is not Windows build, signing, install, launch, upgrade, or uninstall evidence.                             |
| `platform.linux`                    | Linux                    | `unsupported`      | Forge maker configuration is not native deb/rpm install, launch, or uninstall evidence.                                               |
| `capability.auto-update`            | automatic updates        | `candidate`        | Candidate-only for macOS arm64 after the signed A-to-B ZIP, feed, Restart/Later, and relaunch oracle pass; not a publication claim.   |
| `capability.remote-crash-reporting` | remote crash reporting   | `unsupported`      | Desktop 1.0 supports local fail-fast logs, recovery, and opt-in manual support bundles only.                                          |
| `capability.publish`                | desktop publication      | `operator-blocked` | Publication requires an explicit release approval and a scoped credential supplied out of band.                                       |
| `channel.mac-app-store`             | Mac App Store            | `unsupported`      | Desktop 1.0 is a direct GitHub download candidate and has no App Store packaging, entitlement review, upload, or receipt evidence.    |
| `channel.npm`                       | npm desktop distribution | `unsupported`      | The desktop application is not distributed as an npm package and no npm publish mutation is part of this release contract.            |
| `channel.homebrew`                  | Homebrew distribution    | `unsupported`      | No Homebrew cask, tap, checksum update, or installation evidence is part of the desktop 1.0 contract.                                 |
| `channel.cloudflare-deploy`         | Cloudflare deployment    | `unsupported`      | Desktop candidate verification may package local runtime assets but must not create or mutate persistent Cloudflare deployment state. |

<!-- desktop-release-support:end -->

The DMG, Squirrel, deb, and rpm entries in `apps/desktop/electron-forge.config.cjs` are build
possibilities. They are not platform support, signing, installation, upgrade, uninstall, or
runtime evidence. Ubuntu CI and a successful unpacked Forge `.app` smoke do not broaden this
matrix.

## Ownership Boundary

The policy names exactly one owner for each release boundary:

| Boundary                                 | Owner                                            | Scope                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release.packaging-provenance`           | `apps/desktop/scripts/desktop-release-forge.cjs` | Desktop release Forge helper owns release-mode signing and notarization settings, build provenance helpers, and make-result validation.                                           |
| `electron.metadata-entitlements`         | `apps/desktop/electron-forge.config.cjs`         | Electron Forge configuration owns app metadata, bundle id, icon/resource wiring, maker inventory, lifecycle hook wiring, and entitlements if they are introduced.                 |
| `project.relaunch-persistence-semantics` | `packages/services-app/src/project`              | Existing project persistence owners supply recovery, migration, save, reopen, and compatibility semantics; release scripts only verify project identity survives native relaunch. |

Do not duplicate these decisions in workflow YAML, app code, or maintainer prose. Change
`scripts/desktop-release-policy.json`, its contract tests, and this runbook together.

## Build boundary and secrets

Use a clean macOS arm64 checkout at the exact candidate commit. Release mode is fail-closed and
requires all of the following environment values:

- `TILEBORNE_DESKTOP_RELEASE=1`
- `TILEBORNE_APPLE_SIGNING_IDENTITY` — a `Developer ID Application:` identity
- `TILEBORNE_APPLE_TEAM_ID` — the approved ten-character Team ID
- `TILEBORNE_APPLE_API_KEY_PATH` — path to the App Store Connect private key
- `TILEBORNE_APPLE_API_KEY_ID`
- `TILEBORNE_APPLE_API_ISSUER`

The identity, Team ID, API key, GitHub token, and publication approval are external operator/CI
inputs. Never commit them, `.env` files, key files, notarization credentials, shell history,
support bundles, project data, generated receipts, or release artifacts. Do not print secret
values. Use a protected CI secret store or a temporary operator environment; remove temporary key
material after the run according to the owner policy.

The policy documents credential names and presence checks only:

| Name                                 | Owner                                            | Presence check                                                   |
| ------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------- |
| `TILEBORNE_APPLE_SIGNING_IDENTITY`   | `apps/desktop/scripts/desktop-release-forge.cjs` | present; starts with Developer ID Application:                   |
| `TILEBORNE_APPLE_TEAM_ID`            | `scripts/desktop-release-contract.mjs`           | present; ten uppercase letters or digits                         |
| `TILEBORNE_APPLE_API_KEY_PATH`       | `apps/desktop/scripts/desktop-release-forge.cjs` | present; external file path exists                               |
| `TILEBORNE_APPLE_API_KEY_ID`         | `apps/desktop/scripts/desktop-release-forge.cjs` | present; ten uppercase letters or digits                         |
| `TILEBORNE_APPLE_API_ISSUER`         | `apps/desktop/scripts/desktop-release-forge.cjs` | present; UUID                                                    |
| `TILEBORNE_DESKTOP_PUBLISH_APPROVED` | `scripts/desktop-release-contract.mjs`           | present only at publication boundary; exact value 1              |
| `GH_TOKEN`                           | `scripts/desktop-release-contract.mjs`           | present only at publication boundary; verified by gh auth status |

After the normal clean-checkout gates, build the sole approved release artifact:

```sh
pnpm install --frozen-lockfile
pnpm release:gates
TILEBORNE_DESKTOP_RELEASE=1 pnpm --filter @tileborne/desktop package
```

Release mode exposes only the macOS DMG maker, embeds source/version/Team provenance before
signing, requires hardened-runtime signing, notarizes, and rejects missing or extra make outputs.
A successful Forge invocation is still not the release decision.

## Generate the candidate manifest

Set `CANDIDATE` to the freshly produced DMG and generate the manifest from the artifact and current
checkout. Set `UPDATE_CANDIDATE` to the matching Squirrel.Mac ZIP from the same signed make output.
The command is deterministic for identical inputs and writes the closed-schema manifest with
private file permissions. This step records claims; it does not verify them.

```sh
export CANDIDATE="apps/desktop/out/make/Tileborne.dmg"
export MANIFEST="/tmp/tileborne-desktop-release-manifest.json"
export SOURCE_COMMIT="$(git rev-parse HEAD)"
export VERSION="$(node -p 'JSON.parse(require("fs").readFileSync("apps/desktop/package.json", "utf8")).version')"
export UPDATE_CANDIDATE="apps/desktop/out/make/zip/darwin/arm64/Tileborne-darwin-arm64-${VERSION}.zip"
export BUILT_AT="2026-07-16T09:00:00.000Z"
export RUNNER_ID="github-actions:${GITHUB_RUN_ID:-local-candidate}"
export SIGNING_AUTHORITY="Developer ID Application: Tileborne (${TILEBORNE_APPLE_TEAM_ID})"
pnpm release:desktop:manifest \
  --artifact "$CANDIDATE" \
  --update-artifact "$UPDATE_CANDIDATE" \
  --output "$MANIFEST" \
  --version "$VERSION" \
  --source-commit "$SOURCE_COMMIT" \
  --built-at "$BUILT_AT" \
  --runner-id "$RUNNER_ID" \
  --signing-authority "$SIGNING_AUTHORITY" \
  --team-id "$TILEBORNE_APPLE_TEAM_ID"
```

Do not hand-edit a manifest to match a failed check. Rebuild from the intended clean commit and
regenerate it.

## Verify artifact, install, update, and recovery

Run the status command on a native macOS arm64 host. The contract rehashes the candidate DMG and
update ZIP, checks the manifest against the current commit, and invokes the repository's native
verifier itself with a one-time nonce; no caller-provided native receipt is accepted.

```sh
export STATUS_OUTPUT="/tmp/tileborne-desktop-artifact-status.json"
node scripts/desktop-release-contract.mjs status \
  --artifact "$CANDIDATE" \
  --update-artifact "$UPDATE_CANDIDATE" \
  --manifest "$MANIFEST" \
  --output "$STATUS_OUTPUT" \
  --skip-publication 1 \
  --expect no-go
```

This pre-publication run is successful only when `artifactDecision` is `ready`,
`publicationDecision` is `not-requested`, and the sole blocker is `publish.not-requested`. The
native verifier independently proves:

1. the DMG is a real UDIF image with a valid Developer ID signature, notarization staple,
   Gatekeeper assessment, hardened runtime, arm64 executable, expected bundle ID, and embedded
   provenance;
2. the candidate can be mounted, copied to an isolated Applications directory, launched, used to
   create a Battle Royale project, closed, and relaunched with that project present;
3. a strictly newer signed ZIP is served from an ephemeral loopback feed, downloaded through the
   main-process updater, offers Restart and Later without renderer-supplied feed or artifact paths,
   restarts into the newer app, and preserves the same project identity;
4. stale/same-version, wrong architecture, wrong bundle, wrong team, malformed metadata,
   unavailable feed, and interrupted download fixtures fail closed while leaving the project usable.

Restart applies the downloaded update on the next app launch. Later keeps the current app running
and leaves the downloaded update pending until the user restarts. The candidate updater sends only
release-feed requests and package downloads to the configured GitHub release channel or the local
oracle feed during verification; it does not upload project content, support bundles, crash dumps,
or telemetry. Recovery is limited to reopening preserved project data after relaunch or failed
fixtures. There is no previous-version rollback, downgrade, retained installer, or last-known-good
claim.

The verifier writes the status receipt with private file modes. It may contain project metadata and
local paths: store it as restricted release evidence, never commit or attach it to a public issue,
and delete it per the release retention policy.

## Publish approval and final GO

Publication is a separate mutating boundary. Only after the artifact-only run passes may the release
owner approve GitHub Release publication. Provide `GH_TOKEN` through the protected environment and
set `TILEBORNE_DESKTOP_PUBLISH_APPROVED=1` only for that approved run. The verifier checks
`gh auth status --hostname github.com --active`; mere token presence is not accepted.

```sh
export TILEBORNE_DESKTOP_PUBLISH_APPROVED=1
export FINAL_STATUS_OUTPUT="/tmp/tileborne-desktop-final-status.json"
node scripts/desktop-release-contract.mjs verify \
  --artifact "$CANDIDATE" \
  --update-artifact "$UPDATE_CANDIDATE" \
  --manifest "$MANIFEST" \
  --output "$FINAL_STATUS_OUTPUT" \
  --expect go
```

`decision: "go"`, `artifactDecision: "ready"`, `publicationDecision: "approved"`, zero blockers,
and the native evidence summary are authorization inputs. They do not publish anything themselves.
Recheck the candidate and manifest digests, then execute only the separately approved mutating
operation. Do not tag, push, publish, deploy, or overwrite a release without explicit maintainer
approval.

The operator-only mutations are closed-schema policy entries:

| Operation                         | Status             | Reason                                                                                                               |
| --------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `operation.git-tag-create`        | `operator-blocked` | Creating a release tag is a mutating operator action and must not occur during autonomous candidate construction.    |
| `operation.git-tag-push`          | `operator-blocked` | Pushing a release tag is a remote mutation that requires explicit maintainer approval.                               |
| `operation.github-release-create` | `operator-blocked` | Creating the GitHub Release is separate from local candidate verification and requires explicit maintainer approval. |
| `operation.github-release-upload` | `operator-blocked` | Uploading the DMG, manifest, or checksum mutates GitHub release state and requires explicit maintainer approval.     |

## Project-content recovery versus application replacement

Creator recovery and application replacement are different operations:

- A dirty close offers Save, Discard, or Cancel. A failed save remains dirty and blocks close.
- Map/project/integrity-lock updates publish as one transaction. After interruption, reopen the
  main-process-owned recovery snapshot, inspect it, then save or explicitly discard it.
- Preserve the affected project directory before manual repair. Never edit the integrity lock to
  silence a mismatch and never delete a recovery snapshot before the user chooses an outcome.
- If the current application must be removed and installed again, preserve project data first and
  reopen through the recovery flow. This is recovery, not a verified desktop rollback guarantee.

Remote crash upload is not present. If diagnostics are needed, generate an opt-in redacted support
bundle, inspect it before sharing, transmit it through the approved private channel, and follow the
owner's retention/deletion policy. A support bundle is not a native crash report.

## Creator performance contract

The required `creator-performance` release gate materializes the canonical `creator-v1` corpus and
enforces deterministic count, byte, and operation budgets for startup, reopen, a 2,048-asset
library, 512 behaviors/8,192 references, validation, incremental save, playtest start, package, and
Ship. Under-processing is rejected by exact workload metrics; over-processing is rejected by
ceilings.

```sh
pnpm release:gate -- creator-performance
pnpm test:creator-performance
```

Native startup/create/reopen timings and Playwright traces are calibration evidence only:

```sh
pnpm --filter @tileborne/desktop test:creator-performance-native
```

The native gate is advisory and has no required millisecond threshold. Do not use a fast local trace
to waive a deterministic budget failure, and do not commit its temporary trace or receipt output.

## Handoff checklist

Before requesting publication approval, record exact source commit, version, artifact name/size/
digest, approved Team ID, policy revision, native host, commands, exit codes, and the paths/digests
of restricted evidence. Also run:

```sh
git status --short --branch
pnpm release:gates
pnpm docs:build
pnpm typecheck
pnpm lint
git diff --check
```

The handoff must state the current decision and every blocker verbatim. Do not claim Windows,
Linux, macOS x64, remote crash reporting, or completed publication. Do not describe the
candidate automatic-update path as a supported release channel before the final contract and
operator approval pass. Do not cite Forge configuration as evidence.

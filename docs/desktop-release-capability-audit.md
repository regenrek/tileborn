# Desktop Release Capability Audit

- Status: **audited, desktop distribution is not yet a 1.0 go**
- Planr owner: `pln-84d4812b` / `i-for-desktop-packaging-per-platfo-06bb`
- Audit host: macOS 26.4.1 (`Darwin arm64`)
- Candidate: `@tileborne/desktop@1.0.0-rc.0`
- Release state: **unreleased and NO-GO; no tag or publication exists**
- Audited source revision: `73bf0c20f6a4c0b0b3a198289e6671f0e3ff4bd5`

This is the durable input to the 1.0 release-contract and documentation work. It audits the
**desktop editor distribution**. Cloudflare game-host deployment and Ship Game artifacts are
recorded where they provide useful adjacent evidence, but they do not prove a desktop installer,
desktop signing, desktop update, or desktop rollback capability.

> **Post-audit implementation note:** the minimum closed-schema contract described below now lives
> in `scripts/desktop-release-policy.json`, `scripts/desktop-release-contract.mjs`,
> `scripts/macos-desktop-release-verifier.mjs`, and the fail-closed Forge release mode. That source
> implementation does not change the audited distribution decision: the evidence-free status is
> still **NO-GO** because no candidate DMG, approved retained DMG/LKG entry, native backup/rollback
> run, approved Team ID, publish approval, or active scoped credential is present. Use
> [`docs/desktop-release-runbook.md`](desktop-release-runbook.md) for the current procedure and
> stable blocker meanings. The tables and evidence ledger below remain the historical observations
> at the audited source revision.

## Decision vocabulary

- **Implemented and proven** means an executable check exercised the capability on the claimed
  platform.
- **Release blocker** means the capability is required for the claimed 1.0 distribution but its
  contract or evidence is missing.
- **Explicitly unsupported** means it is outside the 1.0 support promise. Configuration or a
  dependency must not be used to imply support.
- **Operator blocked** means local implementation can be verified, but the final mutating step
  needs explicit approval and credentials supplied out of band.

## 1.0 platform support decision

| Platform          | Current executable evidence                                                                                                                                                                                                                                  | 1.0 decision                                                                                                                                   | Exact gap before it may be claimed                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64       | A fresh Forge `.app` exists as an arm64 Mach-O and the copied-app smoke boots it outside the workspace, reaches the renderer, proves its runtime closure, ships a game from an external cwd, and boots that copied game artifact (`3/3` on this audit host). | **Only 1.0 desktop candidate; currently blocked for distribution.** Local development/package execution is proven, public distribution is not. | Produce a DMG from the exact candidate, sign the full app/installer with Developer ID, notarize and staple it, emit a release manifest plus SHA-256, then perform a Gatekeeper-aware install/first-launch/relaunch smoke from the DMG. |
| macOS x64         | No native package, install, or launch receipt.                                                                                                                                                                                                               | **Explicitly unsupported in 1.0.**                                                                                                             | A native x64 builder/test host, signed/notarized x64 or universal artifact, and the same install/launch evidence as arm64.                                                                                                             |
| Windows x64/arm64 | Squirrel maker configuration only; no `.exe`/installer output, Authenticode receipt, install, launch, upgrade, or uninstall evidence.                                                                                                                        | **Explicitly unsupported in 1.0.**                                                                                                             | Native Windows build/sign/install/launch/uninstall evidence and a deliberate support decision.                                                                                                                                         |
| Linux x64/arm64   | deb/rpm maker configuration and Ubuntu source CI only; no `.deb`/`.rpm` output or native install/launch/uninstall receipt.                                                                                                                                   | **Explicitly unsupported in 1.0.**                                                                                                             | Chosen distribution/architecture matrix plus native package-manager install/launch/uninstall evidence on every claimed target.                                                                                                         |

`apps/desktop/electron-forge.config.cjs` contains DMG, Squirrel, deb, and rpm makers. Those entries
are build possibilities, not support evidence. The canonical GitHub workflow runs only on
`ubuntu-latest`; its `packaged-runtime` command invokes a test suite that is skipped outside
macOS. Neither fact broadens the table above.

## Capability matrix

| Capability                                | Current executable evidence                                                                                                                                                                                                                                                                                                                                                   | Canonical owner                                                                                                                                                           | Exact gap                                                                                                                                                                                                                | 1.0 support decision                                                                                                                                                                         | Approval / credentials                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop application packaging             | `apps/desktop/package.json` maps `build` to Forge **package**, and the package hook copies bundled plugins/game-host assets and deploys a lockfile-derived runtime closure. `pnpm --filter @tileborne/desktop test:packaged-smoke` passed `3/3` against `out/Tileborne-darwin-arm64/Tileborne.app`.                                                                           | `apps/desktop/electron-forge.config.cjs` and `apps/desktop/package.json`; root release-gate membership is owned by `scripts/release-gates.mjs`.                           | The required CI build produces a platform app directory, not a distributable installer. Forge **make** exists only as the confusingly named `package` script and is absent from the canonical release gates.             | **Implemented and proven for an unpacked macOS-arm64 `.app`; release blocker for a distributable 1.0 artifact.**                                                                             | No private credential for unsigned packaging. Signing/notarization credentials are required for the release artifact below.                                                                                            |
| Per-platform installer and launch         | The copied macOS-arm64 `.app` launches from a temporary directory with isolated home/user-data. No installer files exist below `apps/desktop/out`; there is no `out/make`.                                                                                                                                                                                                    | Per-platform Forge maker configuration plus platform-native release CI; smoke owner is `apps/desktop/src/smoke/`.                                                         | No DMG mount/copy/first-launch/relaunch proof; no Windows/Linux install/launch/uninstall proof. The macOS copied-app smoke bypasses installer and Gatekeeper distribution checks.                                        | **macOS arm64 release blocker. All other desktop platforms explicitly unsupported in 1.0.**                                                                                                  | Native runners are required. No credential for install testing after a signed artifact exists.                                                                                                                         |
| Code signing and notarization             | `codesign --verify --deep --strict` fails for the current `.app` (`code has no resources but signature indicates they must be present`). `codesign -dv` reports only an ad-hoc linker signature, no team identifier, and no sealed resources. `spctl --assess` also fails. Forge config explicitly says signing was deferred and configures neither signing nor notarization. | `apps/desktop/electron-forge.config.cjs` plus a macOS release workflow/secret boundary.                                                                                   | Full nested-code signing, hardened runtime/entitlements decision, notarization submission, stapling, and verification are absent.                                                                                        | **Release blocker for the sole 1.0 desktop target.** Never describe the current ad-hoc executable signature as application signing.                                                          | Explicit release-owner approval; Apple Developer ID Application certificate/private key; Apple team id; notarization credentials (App Store Connect key or approved Apple ID flow) stored only in CI/operator secrets. |
| Desktop updates                           | No updater dependency, `autoUpdater`/`updateElectronApp` code, update feed/provider, update manifest, rollout policy, or upgrade smoke exists.                                                                                                                                                                                                                                | Future owner: `apps/desktop/src/main` for the lifecycle/UX and the desktop release pipeline for feeds/artifacts.                                                          | There is no update implementation or safe rollback coupling.                                                                                                                                                             | **Explicitly unsupported in 1.0.** The supported upgrade path is manual replacement with a complete signed installer; the UI/docs must not imply automatic or in-app updates.                | None for the limitation. A future feed needs release-host credentials and a signing continuity policy.                                                                                                                 |
| Crash reporting                           | The main process logs uncaught exceptions/rejections, updates startup status, and exits. Redacted, integrity-checked manual support bundles exist in `@tileborne/services-build`. There is no Electron `crashReporter`, dump persistence/upload, remote sink, consent flow, retention policy, or crash receipt. Telemetry defaults off.                                       | `apps/desktop/src/main` for local capture/lifecycle; `@tileborne/services-build` for support bundles; privacy/docs owner for any remote sink.                             | Automatic native/renderer crash capture and remote reporting are absent; current support bundles are not crash reports.                                                                                                  | **Remote crash reporting explicitly unsupported in 1.0.** Local fail-fast logging, recovery, and opt-in manual support bundles are the supported contract and must be documented accurately. | None for local-only behavior. Any future remote sink requires an approved privacy policy, endpoint/vendor credentials, consent, redaction, retention, and deletion rules.                                              |
| Desktop artifact provenance and checksums | The candidate version and bundle id are present in `Info.plist`; shipped **game** artifacts use content-addressed manifests and SHA-256 entries. No desktop release manifest, desktop artifact SHA-256 file, signing/notary receipt, source revision, runner identity, or reproducible release record exists.                                                                 | Desktop release tooling under `scripts/` plus the release workflow; game artifact integrity remains owned separately by `@tileborne/services-build` and `apps/game-host`. | Emit a closed-schema desktop release manifest tied to commit/version/platform/arch/artifact digest and signing/notary verification, then validate it in the release gate.                                                | **Release blocker for macOS arm64.** Game-artifact checksums do not satisfy desktop-distribution provenance.                                                                                 | No credential for hashing. Signed/notarized provenance depends on the Apple credentials above.                                                                                                                         |
| Desktop deploy / publish                  | There is one read-only CI workflow and no Forge publisher, desktop release workflow, GitHub Release upload step, npm/Homebrew desktop distribution, or published desktop receipt. `RELEASE.md` correctly requires approval before tag/push/release commands. The local-compatible Cloudflare game-host proof is separate.                                                     | Release maintainer and a future least-privilege desktop release workflow.                                                                                                 | Choose the canonical distribution target, upload only validated signed artifacts plus manifest/checksums, and record immutable release URLs/digests. No remote mutation has been authorized by this audit.               | **Operator blocked after local release blockers are fixed.** GitHub Release is the minimum recommended 1.0 channel; npm/Homebrew are not part of the desktop 1.0 promise.                    | Explicit maintainer approval; scoped GitHub release token/permissions. Cloudflare credentials apply only to game-host deployment, not desktop publishing.                                                              |
| Desktop rollback                          | Project schema migration, transactional save/recovery, and backup evidence protect project data. The documented rollback section covers the Cloudflare Worker, not the desktop editor. There is no retained-installer policy, desktop downgrade compatibility statement, rollback command/check, or reinstall smoke.                                                          | Desktop release runbook plus `@tileborne/core` schema compatibility and `@tileborne/services-app` durable project owner.                                                  | Define retention and digest verification for the last known-good signed installer; back up project data before downgrade; state which project/schema versions can be reopened; smoke reinstall/reopen without data loss. | **Release blocker until the manual rollback contract is explicit and verified.** Automatic rollback is out of scope because automatic updates are unsupported.                               | Release-channel access to the retained prior artifact; no private runtime credential. Any destructive downgrade step requires explicit user confirmation and a verified backup.                                        |

## Evidence ledger

The following evidence was rerun or inspected at the audited revision. Generated `out/` content is
local evidence and is not a source-controlled release artifact.

1. `pnpm --filter @tileborne/desktop test:packaged-smoke` — **pass, 1 file / 3
   tests**, after running with the GUI/process permission required by Electron. The initial
   sandboxed launch failed with `EPERM`; that permission failure is not a product failure.
2. `uname -s -m`, `sw_vers`, `file .../Contents/MacOS/tileborne`, and `plutil` — host is
   macOS 26.4.1 arm64; executable is Mach-O arm64; bundle id is `dev.tileborne.app`; bundle
   version is `1.0.0-rc.0`.
3. `codesign --verify --deep --strict --verbose=4 .../Tileborne.app` — **fail**, resources are
   not sealed as the signature expects. `codesign -dv --verbose=4` reports `Signature=adhoc`,
   `TeamIdentifier=not set`, and `Sealed Resources=none`; `spctl --assess` fails.
4. `find apps/desktop/out ...` — only the unpacked `Tileborne-darwin-arm64` application tree is
   present; there is no DMG, Squirrel installer, deb, rpm, checksum, update manifest, or
   `out/make` tree.
5. `pnpm release:gates:matrix` and `.github/workflows/ci.yml` — the canonical workflow uses
   `ubuntu-latest` only. It has no native OS matrix, make/sign/notarize/install/publish step, and
   the required `packaged-runtime` suite is macOS-only.
6. Source search across `apps/desktop`, release scripts, workflow, and lockfile found no configured
   desktop publisher, updater lifecycle, or Electron crash reporter. The transitive Forge
   `publisher-base` package is not a configured publisher.
7. `apps/desktop/src/main/main.ts`, `packages/services-build/src/support/`, and their tests prove
   local fail-fast startup reporting and manual redacted support-bundle primitives, not remote
   crash reporting.
8. `apps/game-host/src/build/manifest.ts`, `@tileborne/services-build`, and the CLI ship-pipeline
   tests prove content hashes for shipped games. No equivalent desktop distribution manifest or
   checksum contract exists.

## Contract slice required by this audit

This minimum source slice has since been implemented without broadening platform support. Every
listed item still requires executable release evidence before the candidate may be called GO:

1. hard-code/document the support promise as **macOS arm64 only** and make every other maker
   non-claiming;
2. implement a deterministic desktop release manifest/checksum verifier;
3. add macOS signing/notarization configuration with a fail-closed credential boundary;
4. make a signed/notarized DMG and Gatekeeper-aware install/launch smoke the native release gate;
5. define manual upgrade and rollback, while explicitly marking automatic updates and remote crash
   reporting unsupported;
6. leave publish as an explicit operator-approved step and record its exact blocker when approval
   or credentials are unavailable.

Until items 2–5 have executable evidence, the desktop binary decision remains **NO-GO** even when
all source-level release gates pass.

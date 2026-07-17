# Release Readiness

## Packaging

- Behavior sources/modules have stable versioning and content hashes.
- RuntimeMapPackage contains all required modules/manifests without resolving back
  into the workspace; copied packaged-app/artifact smoke executes the behavior.
- No compiler or developer-only dependency leaks into production unintentionally.

## Documentation

- Creator guide for Event Editor, debugging, conversion, and error recovery.
- SDK reference, quickstart, examples, test guide, deterministic API rules, import
  policy, and migration/versioning policy for developers and agents.
- Plugin guide for contributing capabilities without genre leakage.
- Architecture/security docs record owners, process boundaries, and deferred graphs.

## Verification

- Focused and workspace-level typecheck/test/build/boundary suites are logged.
- Live Electron Goal Oracle and executed artifact evidence are attached to map logs.
- Material implementation/UI/runtime slices receive independent review and all
  findings are fixed/re-reviewed before audit.
- `planr plan audit pln-d39bcb7f --json` ends with `holds: true`.

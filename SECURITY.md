# Security Policy

## Supported Versions

| Version                | Supported   |
| ---------------------- | ----------- |
| 1.0 release candidates | Yes         |
| main pre-1.0 snapshots | Best effort |
| < 0.1.0                | No          |

Production 1.0 security fixes target the `main` branch until a release branch
exists.

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report privately via [GitHub Security Advisories](https://github.com/tileborne/tileborne/security/advisories/new) on this repository.

If GitHub Security Advisories are unavailable, email **security@tileborne.dev** with:

- A description of the vulnerability and affected component
- Steps to reproduce
- Impact assessment (data exposure, RCE, privilege escalation, etc.)
- Suggested fix, if any

We aim to acknowledge reports within **5 business days** and will coordinate disclosure once a fix is available.

## Security Boundaries

Tileborne defines these trust boundaries. Understanding them helps scope valid
reports.

### Plugin runtime isolation

- Plugins declare capabilities and permissions in `tileborne-plugin.json`.
- The desktop main process loads plugin server entries in a controlled host; renderer contributions are declarative only (no arbitrary executable code in the React shell).
- Plugin filesystem access is scoped to declared asset roots and workspace paths.

### Tileset path containment

- `@tileborne/sdk-tileset` resolves external Tiled tilesets (TSX) and LDtk level references with `isPathInsideFolder` hardening.
- Relative paths containing `..`, absolute escapes, and paths outside the project root are rejected.
- Regression tests live in `packages/sdk-tileset/src/tiled/__tests__/external-resolve.test.ts` and `packages/sdk-tileset/src/ldtk/__tests__/external-resolve.test.ts`.

### Bundled asset loader

- The runtime asset loader validates manifest entries and rejects failed fetches rather than silently falling back to empty manifests.
- Asset pack imports record license metadata and SHA-256 hashes for integrity checking.
- `@tileborne/asset-pipeline` applies path-traversal guards during import and pack indexing.

### Local playtest handoff tokens

- Multiplayer playtest uses HMAC-signed handoff tokens for WebSocket join.
- Tokens are ephemeral and scoped to a single playtest session; tampered tokens are rejected with connection close.

### Operator-owned production setup

- Cloudflare, Alchemy, and handoff signing secrets must be provided through the
  operator's secret store or Wrangler/Alchemy environment. Plaintext production
  secrets must not be committed.
- Credential rotation, Cloudflare account policy, and production resource
  deletion approvals remain operator-owned.
- npm package publishing and Electron auto-update channel security are not
  executed by this repository without explicit release approval.

## Dependency Audits

Release candidates must run `pnpm audit --audit-level moderate` locally before
handoff. CI currently runs install, lint, typecheck, tests, builds, and boundary
checks; dependency audit is a release gate, not a CI job, until the advisory
set is clear enough to make it non-flaky.

The Production 1.0 audit refresh removes mature patched advisories for
Playwright, Wrangler, Hono, Miniflare, Vite, `ws`, `qs`, `tmp`, `tar`,
`js-yaml`, and `@babel/core`. The remaining release blocker on 2026-06-15 is
`esbuild >=0.17.0 <0.28.1`: the patched `0.28.1` release is required by the
advisory, but the repository's seven-day `minimumReleaseAge` policy still
blocks adopting it without an explicit operator override.

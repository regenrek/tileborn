# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1.0 | No |

v0.1.0 is a local-first OSS snapshot. Security fixes target the `main` branch.

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

Tileborne v0.1.0 defines these trust boundaries. Understanding them helps scope valid reports.

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

### Out of scope for v0.1.0

- Cloudflare production deployment hardening (local miniflare only)
- npm package supply-chain signing (packages not yet published)
- Electron auto-update channel security

## Dependency Audits

The monorepo runs `pnpm audit` in CI. Known transitive advisories in dev/build tooling (Electron Forge, Playwright, Wrangler) are tracked in [`.refs/v0.1.0-security-scan.md`](.refs/v0.1.0-security-scan.md).

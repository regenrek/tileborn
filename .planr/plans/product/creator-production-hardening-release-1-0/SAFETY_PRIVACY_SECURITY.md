# Safety Privacy Security

## Data Handling

- Projects, recovery snapshots, backups, logs, crash receipts, and artifacts are local by default.
- Diagnostics use allowlisted structured fields and redact home paths, tokens, signing material, player/user identifiers, and project content not required for diagnosis.
- Recovery/backup retention and deletion behavior is documented and creator-controllable.

## Secrets

- `HANDOFF_SIGNING_KEY`, Cloudflare credentials, Apple/Windows signing credentials, npm tokens, and GitHub credentials never enter project files, artifacts, logs, or Planr evidence.
- CI uses least-privilege secret scopes and separates untrusted pull-request tests from credentialed release jobs.
- Missing secrets produce a precise blocked release step while all safe local gates continue.

## Abuse Cases

- Malicious project paths, archives, backups, manifests, or migration entries escaping the project root.
- Gameplay/plugin code attempting dynamic imports, nondeterminism, prototype reflection, filesystem/network access, runaway CPU/memory, or host process termination.
- Update or release artifacts without provenance/checksum verification.
- Crash reports leaking source, credentials, or personal paths.
- Recovery from corrupted or externally modified journals. Tests must fail closed and preserve original data.

# Safety Privacy Security

## Data Handling

Update state and redacted diagnostics may be stored under Electron user data.
Project content remains under existing persistence owners and is never uploaded
by the updater. Temporary native fixtures and isolated user data are outside the
repository and excluded from release assets.

## Secrets

Runtime update checks require no GitHub token for the public repository.
Developer ID/notarization and publication credentials remain external to the
repository and are consumed only by existing release boundaries. No credential
value appears in logs or receipts.

## Abuse Cases

- Feed URL substitution: production URL is compiled/configured in main and not
  accepted from renderer IPC.
- Malicious asset: require expected GitHub source, stable SemVer, macOS arm64
  naming/provenance, digest binding, and macOS signing continuity.
- Downgrade/replay: reject same or lower versions; no allow-any-version switch.
- Interrupted update: current installation and project data remain usable.
- Unauthorized publication: fixture verification is local; remote mutation still
  requires explicit approval plus scoped credentials.

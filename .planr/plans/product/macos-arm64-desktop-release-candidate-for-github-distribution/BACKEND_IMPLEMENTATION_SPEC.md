# Backend Implementation

## Storage

## Services

- Add one Electron-main update coordinator around the selected updater runtime.
- Accept only the configured GitHub release channel and macOS arm64 artifacts;
  surface a closed update-state contract to the renderer.
- Keep feed generation and artifact metadata in the desktop release pipeline.
  Candidate verification must use a local/non-publishing fixture feed.

## Tests

- Cover no-update, newer signed update, stale version, invalid metadata,
  interrupted download, and restart-ready transitions.
- Verify every failure preserves the installed app and does not invoke project
  persistence or migration owners.

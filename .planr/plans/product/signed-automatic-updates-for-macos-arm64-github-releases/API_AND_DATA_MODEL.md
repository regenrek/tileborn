# API And Data Model

## Objects

- `DesktopUpdateState`: `disabled | idle | checking | available | downloading |
  ready | up-to-date | error`, current/target version, progress when available,
  last checked time, and bounded diagnostic code/message.
- `DesktopUpdatePolicy`: immutable owner/repository/channel/platform/architecture,
  bundle id, and expected signing team identifier.
- `DesktopUpdateReceipt`: source/target versions, ZIP digest/provenance, lifecycle
  timestamps, relaunch version, and project-persistence evidence; no secrets.

## Commands

- `getUpdateState()`
- `checkForUpdates()`
- `restartToApplyUpdate()`

Commands are main-owned, serialized, valid only in packaged supported builds,
and reject renderer-provided feed URLs or artifact paths.

## Events

- `updateStateChanged(DesktopUpdateState)`
- Existing close/save lifecycle events remain authoritative before restart.

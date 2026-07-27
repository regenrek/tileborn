# Architecture Decisions

## ADR-001

Status: accepted

Decision: Use Electron's built-in `autoUpdater`/Squirrel.Mac directly. Production
checks the public `update.electronjs.org/regenrek/tileborn/darwin-arm64/<version>`
channel and consumes a signed macOS arm64 ZIP published with the existing DMG.
Tileborne owns a typed main-process state machine instead of delegating user
state and restart coordination to an opaque second updater stack.

Consequences: `@electron-forge/maker-zip` is added to release mode; the existing
Developer ID identity and bundle id remain continuous across versions. A local
fixture feed is injectable only for packaged verification. GitHub publication
remains operator-blocked. Downgrade, rollback, retained-installer, and LKG
semantics are prohibited.

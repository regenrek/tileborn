# UX Flows

## Primary Flow

1. Packaged Tileborne checks the stable channel after startup or by user action.
2. No newer release: show Up to date and continue normally.
3. New signed release: download in the background and expose progress.
4. Ready: offer Restart to Update or Later.
5. Restart requests the existing save/close flow, applies the update, relaunches,
   and confirms the new version while preserving the project.

## Empty States

- Development/unsupported platform: update controls explain unsupported scope.
- Never checked: show current version and Check for Updates.

## Error States

- Offline/service unavailable: keep current app, offer retry, avoid modal loops.
- Invalid/stale/untrusted update: reject, log a bounded diagnostic, and direct the
  user to the normal current-version download/support path.
- User cancels close/save: remain on current session; staged update waits for a
  later normal exit. No rollback language is shown.

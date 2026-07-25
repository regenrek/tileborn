# Client Implementation

## CLI

No new user-facing CLI command is required. Existing build/deploy commands may
be used by the live oracle and must redact provider details.

## MCP

No MCP protocol or server is added. Planr coordinates the work; Electron,
browser, and native test tools are verification surfaces only.

## UI

- Preserve existing multiplayer lobby, live HUD, results, and explicit
  leave/retry UX.
- Renderer-visible state may distinguish connecting, live, reconnecting,
  disconnected, and terminal error when the canonical runtime transport emits
  them.
- UI code must not calculate retry delays, own reconnect budgets, retain an
  outbound queue, refresh reconnect tokens, or classify close codes.
- Accessibility and keyboard/focus behavior of existing dialogs must not
  regress.

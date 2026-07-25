# UX Flows

## Primary Flow

1. Creator starts or joins multiplayer using the existing UI.
2. Runtime transport connects and projects `connecting` then `live`.
3. If the server isolate is reconstructed, the room silently restores the
   accepted socket and authoritative stream; no user action is required.
4. On an unexpected transport close, the runtime performs bounded reconnect
   through the existing token endpoint and projects reconnecting state.
5. Success returns to live state with the same player identity; exhaustion
   shows an actionable retry/leave choice.

## Empty States

- No room: preserve current create/join guidance.
- No reconnect token: do not loop; show a terminal reconnect-unavailable error.
- Finished match: show results and do not reconnect.

## Error States

- Kicked/match-ended/normal close: existing terminal UI, no automatic retry.
- Reconnect budget exhausted: concise error plus explicit user Retry/Leave.
- Protocol or malformed attachment rejection: safe generic message to the user,
  detailed redacted diagnostic for maintainers.
- Provider unavailable in Ship/deploy verification: report without exposing
  profile credentials and clean any partial disposable resource.

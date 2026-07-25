# API And Data Model

## Objects

- `RoomSocketAttachment`: provider-local, validated identity envelope for an
  accepted socket. Version only if evolution is necessary.
- `RoomSocketRecord`: transient authoritative transport state reconstructed
  from an attachment and current WebSocket.
- Existing room storage, reconnect seat, snapshot ack, transport stats, and
  runtime frame objects remain canonical.

## Commands

- Existing room create/join/ready/reconnect/destroy commands remain unchanged.
- Reconnect continues through the existing HTTP endpoint and token refresh
  path.
- No provider-specific command enters `packages/core` or a game-mode plugin.

## Events

- Existing authoritative frames and close codes remain the wire contract.
- Add no new wire event unless a user-visible connection state cannot be
  derived from existing transport events.
- Internal initialization/rehydration diagnostics are observability records,
  not gameplay events.

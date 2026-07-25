# Safety Privacy Security

## Data Handling

- Socket attachments contain only internal player/socket identity, never auth
  cookies, reconnect tokens, profile data, or provider credentials.
- Logs and Planr evidence redact room tickets, reconnect tokens, account ids,
  cookies, and Cloudflare profile details.
- Malformed attachments and protocol frames fail closed.

## Secrets

- Authenticate a new default Cloudflare profile interactively.
- Never copy Alchemy/Cloudflare credential files from another machine.
- Never commit profile data, API tokens, cookies, generated state credentials,
  or unredacted provider responses.

## Abuse Cases

- Forged attachment attempts to assume another player.
- Stale socket attempts to close or send as its replacement.
- Reconnect storm attempts to exhaust CPU or memory.
- Unbounded outbound queue or snapshot lag.
- Malformed/future/stale snapshot acknowledgements.
- Partial deploy leaves one disposable Worker behind.

# Safety Privacy Security

## Data Handling

- Asset provenance and public deployment metadata are durable; credentials and provider tokens are not.
- Multiplayer MVP minimizes participant data to ephemeral ids, room state, diagnostics, and results required by the game.
- Audio/fonts/images are packaged only when classification permits redistribution.

## Secrets

- Use environment/provider-native auth and subprocess-safe argument/env handling.
- Redact known secret fields and token-like values from UI, logs, errors, receipts, and tests.
- Never embed `.env`, cloud config homes, auth caches, or absolute user paths in artifacts.

## Abuse Cases

- Participant attempts owner-only stop/destroy operations.
- Malicious shell action or behavior tries to escape registered capabilities.
- Crafted asset paths traverse project roots or smuggle unlicensed content.
- Deployment config injects commands, provider args, paths, or log-control sequences.
- Public room/deployment is unintentionally exposed; MVP defaults to private codes and explicit provider configuration.

## Release Gates

Run secret/leak, dependency/supply-chain, path containment, license/provenance,
artifact closure, and provider credential-redaction tests before external deploy.

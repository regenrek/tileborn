# Safety Privacy Security

## Data Handling

- Project backup/restore must be non-destructive and must never overwrite the
  sole copy during install, migration, or rollback verification.
- Installers, project backups, native receipts, and unredacted logs stay outside
  Git and durable Planr evidence.

## Secrets

- Never commit or log certificate material, passwords, API keys, Apple account
  credentials, notarization secrets, Keychain exports, provisioning data, or
  release tokens.
- Resolve secrets from protected Keychain/provider-native references at runtime;
  check presence and identity without printing values.
- Use least-privilege workflow permissions and keep publication disabled unless
  a separate explicit maintainer approval is present.

## Abuse Cases

- Reject artifact or receipt tampering, source/version substitution, unsupported
  architecture, stale last-known-good identity, and forged signing/notary claims.
- Fail closed when expected evidence is missing or unverifiable.
- Scan repository changes and generated logs for secret leakage before review.

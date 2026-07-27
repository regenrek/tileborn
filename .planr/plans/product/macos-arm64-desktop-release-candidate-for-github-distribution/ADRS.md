# Architecture Decisions

## ADR-001

Status: accepted

Decision: The signed automatic-update channel remains a future requirement for
its own implementation, tests, and review; the current cleanup does not mark it
supported. The first direct-download release does not claim automatic downgrade
or retain a synthetic prior installer. Update lifecycle is owned by the Electron
main process, release feed metadata by the desktop release pipeline, and project
migrations/backups by the existing persistence services.

Consequences: v0.0.1 verification uses a local/non-publishing fixture feed and
failure-path tests. A real cross-version upgrade can be proven once a subsequent
signed release exists. Removing the app and reinstalling the current release is
documented as recovery, not rollback.

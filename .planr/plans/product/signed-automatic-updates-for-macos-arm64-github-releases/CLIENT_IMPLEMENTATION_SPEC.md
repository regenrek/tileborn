# Client Implementation

## CLI

Add non-publishing commands for update artifact/feed validation and local
fixture verification. Publication commands remain separately approval-gated.

## MCP

No MCP surface is added.

## UI

- Settings/About exposes current version, last check, Check for Updates, update
  progress/status, Restart to Update, and Later.
- Background checks use non-blocking notifications; errors are actionable and
  do not imply data loss or rollback.
- Restart uses the existing document-close/save flow and honors cancellation.
- Status is keyboard accessible, announced to assistive technology, and does not
  trap focus.

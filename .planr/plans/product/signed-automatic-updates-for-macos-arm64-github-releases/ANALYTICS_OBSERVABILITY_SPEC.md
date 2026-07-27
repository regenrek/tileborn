# Analytics Observability

## Events

Local lifecycle events: check started, no update, update available, download
progress, update ready, restart requested/cancelled, applied/relaunched, and
failure code. No remote analytics are added.

## Diagnostics

Use bounded stable codes without feed tokens, filesystem paths, user content, or
raw Electron errors. The native receipt records versions, artifact digest,
signature/team identity, timestamps, and pass/fail evidence.

## Privacy

Checks disclose only normal HTTP request metadata to the public Electron update
service/GitHub. No project or account data is transmitted.

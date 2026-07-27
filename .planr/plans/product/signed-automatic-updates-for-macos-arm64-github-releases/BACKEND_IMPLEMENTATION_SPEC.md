# Backend Implementation

## Storage

No Tileborne backend storage is introduced. GitHub Releases and
`update.electronjs.org` are the production distribution channel. Local fixture
files live in temporary verification directories only.

## Services

No Cloudflare/AWS application service is added. Release scripts validate and
name the GitHub update asset; Electron's public update service derives the feed
from stable public GitHub Releases.

## Tests

Use a loopback/local Squirrel.Mac-compatible feed for deterministic success and
failure tests. Do not create a tag, release, upload, Worker, bucket, or DNS state.

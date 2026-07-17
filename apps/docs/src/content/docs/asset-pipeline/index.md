---
title: Asset Pipeline
description: Importers, license model, integrity hashing, and asset pack format.
---

# Asset Pipeline

`@tileborne/asset-pipeline` owns atomic asset import, pack indexing, license reporting, and security guards. CLI `tileborne asset import` and desktop asset library flows call the same Effect services.

## Import lifecycle

```text
1. User selects path or archive
2. Staging directory under ~/.tileborne/cache/imports/
3. Archive inspection (caps, traversal, symlinks)
4. Importer selection by file kind
5. License validation
6. Content hash per file
7. Pack manifest written
8. Atomic rename into ~/.tileborne/assets/packs/<pack-id>/
9. Asset index refreshed
```

Failed steps roll back staging; partial packs never land in the home directory.

## Importers

Default importers (`defaultImporters`):

| Importer          | Handles                               |
| ----------------- | ------------------------------------- |
| `imageImporter`   | PNG, JPEG, WebP (magic-byte verified) |
| `tilesetImporter` | Tileset sheets and metadata           |
| `audioImporter`   | OGG, MP3, WAV                         |
| `tmxImporter`     | Tiled TMX maps                        |
| `ldtkImporter`    | LDtk JSON projects                    |

Each importer implements the shared `AssetImporter` contract: detect, validate, normalize paths, emit pack entries.

## License model

Every imported third-party pack requires license metadata:

```json
{
  "license": {
    "spdxId": "CC0-1.0",
    "sourceUrl": "https://example.invalid/source"
  }
}
```

The pipeline can emit license reports (`license-report.ts`) for compliance audits. Missing or unknown SPDX IDs fail import unless explicitly allowed by policy.

OSS sample fixtures ship under `@tileborne/test-fixtures` with CC0 `PROVENANCE.md` files — real art migration is deferred.

## Integrity hashing

- Algorithm: **SHA-256** (`hashBytes` from `@tileborne/core`)
- Manifest stores `hash: "sha256:..."` per asset file
- Pack-level content hash supports delta merges and rebuild detection
- Mismatch on re-import or verify → hard error

## Asset pack format

Canonical manifest: `tileborne-asset-pack.json`

```json
{
  "id": "pack:550e8400-e29b-41d4-a716-446655440099",
  "name": "Example Pack",
  "version": "1.0.0",
  "license": { "spdxId": "CC0-1.0", "sourceUrl": "https://example.invalid" },
  "assets": [
    {
      "id": "asset:550e8400-e29b-41d4-a716-446655440098",
      "path": "tiles/terrain.png",
      "mime": "image/png",
      "size": 8,
      "hash": "sha256:…",
      "license": { "spdxId": "CC0-1.0" }
    }
  ]
}
```

Branded IDs (`pack:`, `asset:`) are validated at decode time via Effect Schema.

## Security guards

Re-exported from `@tileborne/asset-pipeline/security`:

- Extension and MIME allowlists
- Magic-byte verification
- Size limits (archive, extracted bytes, file count, image dimensions)
- Path traversal and symlink escape rejection

See [Security model](/security/) for how services compose these guards.

## API reference

Generated TypeDoc for `@tileborne/asset-pipeline` lives under [API Reference](/reference/). Key modules:

- `importers/` — format-specific import
- `pack/` — manifest, merge, validation
- `license/` — SPDX reporting
- `security/` — path and content guards

## CLI

```bash
tileborne asset import ./art/tiles.png --kind tileset
tileborne asset list
tileborne asset verify <pack-id>
```

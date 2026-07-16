---
title: Plugins
description: Plugin manifests, contribution points, trusted execution, and the supported CLI lifecycle.
---

# Plugins

Tileborne plugins extend authoring and runtime through a decoded `PluginManifest`. Declarative contributions are data consumed by generic editor/runtime owners. Executable entries load only in trusted main, CLI, or host contexts; Phase A never executes plugin modules in the Electron renderer.

## Manifest

Every plugin root contains `tileborne-plugin.json`, decoded by the `PluginManifest` Effect Schema in `@tileborne/plugin-api`:

```json
{
  "schemaVersion": 1,
  "id": "@tileborne-plugins/example-gameplay",
  "name": "@tileborne-plugins/example-gameplay",
  "version": "0.1.0",
  "displayName": "Example Gameplay",
  "description": "Example declarative and runtime contributions.",
  "author": "Example Studio",
  "license": "MIT",
  "engines": { "tileborne": "^0.1.0" },
  "entry": { "runtime": "./dist/runtime.js", "server": "./dist/server.js" },
  "contributes": {},
  "permissions": [],
  "dependsOn": []
}
```

`repository`, `homepage`, `entry`, and `migrations` are optional. All other fields shown above are required. Entry and contribution paths are plugin-relative and must remain inside the verified plugin root. There is no manifest `integrity` field: installs compute a directory hash and store it in `lock.json`; tarball callers may supply an expected `sha256:<64 hex>` hash to the installer.

See the generated [plugin-api reference](/reference/plugin-api/) for the complete contribution schema.

## Contribution points

The manifest's `contributes` object includes top-level panels/tools/assets, typed `editor`, `runtime`, and `server` buckets, game modes, behavior entries/templates, and migration declarations. Examples include:

| Point | Purpose |
| --- | --- |
| `behaviorEntries` / `behaviorTemplates` | Typed declarative WHEN/IF/DO blocks and starters |
| `editor.gameSettingsForms` | Schema-driven settings without renderer plugin code |
| `runtime.systems` / `runtime.events` | Runtime registration metadata |
| `runtime.gameObjectCatalogs` / `runtime.weaponCatalogs` | Contained, decoded catalogs |
| `server.mapValidators` | Named server-side validation entrypoints |
| `gameModes` | One linked game-mode registration and capability ids |

Declarative data is validated before use. Executable contributions are ordinary trusted plugin code, not an OS sandbox: permission declarations are reviewed capability intent and checked by the owning host where implemented, but they do not make arbitrary Node code safe. Install only code you trust. Gameplay project TypeScript has a separate restricted behavior runtime described in [Gameplay Behaviors](/gameplay-behaviors/).

## Supported CLI lifecycle

```bash
tileborne plugin create my-mode
tileborne plugin install --local ./my-mode
tileborne plugin install --dev-symlink ./my-mode
tileborne plugin install @example/my-mode@1.2.3
tileborne plugin pack ./my-mode --out dist/my-mode.tbpack
tileborne plugin list
tileborne plugin info @tileborne-plugins/my-mode
tileborne plugin verify @tileborne-plugins/my-mode
tileborne plugin disable @tileborne-plugins/my-mode
tileborne plugin enable @tileborne-plugins/my-mode
tileborne plugin remove @tileborne-plugins/my-mode
```

Use `plugin install --tarball <local-path> --integrity <sha256:...>` for integrity-pinned local archives, or `--git <url> --ref <tag-or-commit>` for a remote Git source. The current CLI resolves `--tarball` as a local filesystem path; use the npm or Git source forms for remote retrieval. `plugin verify` without an id verifies all installed plugins.

Installed copies live under `$TILEBORNE_HOME/plugins/<encodeURIComponent(id)>-<version>/` (the default home is platform-resolved). Each contains the manifest and computed `lock.json`; do not construct this path from an unencoded id.

## Reference implementations

The bundled Battle Royale plugin demonstrates event/condition/action entries, a complete game mode, catalogs, validators, runtime adapter, and Ship wiring. Example Arena is the neutral second-genre fixture proving orchestration does not switch on Battle Royale ids.

Executable references: [Battle Royale manifest](https://github.com/tileborne/tileborne/blob/main/packages/plugin-battle-royale/tileborne-plugin.json), [Battle Royale runtime adapter](https://github.com/tileborne/tileborne/blob/main/packages/plugin-battle-royale/src/runtime-adapter.ts), and [Example Arena runtime adapter](https://github.com/tileborne/tileborne/blob/main/packages/plugin-example-arena/src/runtime-adapter.ts).

## Related docs

- [Plugin SDK](/plugins/sdk/)
- [Gameplay Behaviors](/gameplay-behaviors/)
- [Battle Royale Creator Guide](/battle-royale/creator-guide/)
- [Security model](/security/)
- [API Reference: @tileborne/plugin-api](/reference/plugin-api/)

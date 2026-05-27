---
title: Plugin SDK
description: Manifest schema, contributions, executable adapter contract, and distribution.
---

# Plugin SDK

This guide extends [Plugins](/plugins/) with author-facing SDK details. Import types from `@tileborne/plugin-api` in plugin repos; never import Node or Electron from renderer-facing plugin UI.

## Manifest schema

Each plugin ships `tileborne-plugin.json` at its root:

```json
{
  "schemaVersion": 1,
  "id": "example.gameplay",
  "name": "example.gameplay",
  "version": "0.1.0",
  "displayName": "Example Gameplay",
  "engines": { "tileborne": "^0.1.0" },
  "contributes": {},
  "permissions": [],
  "dependsOn": []
}
```

Validation runs through Effect Schema (`manifest.schema.ts`). Engine range mismatch fails install.

Optional `integrity` block (`algorithm: sha256`, `hash`) is verified on install.

Full field reference: [plugin-api API docs](/reference/plugin-api/).

## Contribution model

### Declarative (renderer-safe)

Serialized JSON/metadata consumed by `@tileborne/ui` and the editor shell:

- Palette categories, inspector panels, overlays
- Validator configs, exporter metadata, generator dialogs
- Asset metadata, commands, presets

These never execute arbitrary code in the renderer during Phase A.

### Executable (main / CLI / game-host only)

Functions exported from the plugin `dist/` entry:

| Hook | Purpose |
| --- | --- |
| `validateProject` / `validateMap` | Lint before export or playtest |
| `exportArtifact` | Target-specific export pipelines |
| `generateMap` | Procedural generation |
| `importAsset` / `postProcessAssetPack` | Custom import transforms |
| `createRuntimeAdapter` | Register runtime systems |

Executable modules are loaded on demand in trusted contexts only.

## Runtime adapter contract

Game plugins bundled into `@tileborne/runtime` / game-host expose a runtime module default export:

```ts
export default {
  id: "@tileborne-plugins/battle-royale",
  onInit(ctx) { /* register ECS systems, load assets */ },
  onTick(ctx, dt) { /* optional per-frame hook */ },
  onMessage(ctx, msg) { /* net/event bus */ },
  onShutdown(ctx) { /* cleanup */ },
};
```

The game-host `PluginHost` calls lifecycle hooks during room boot, alarm ticks, and teardown. Client-side systems register through the same plugin bundle at build time — there is no dynamic `require` on Workers.

## Distribution model

| Channel | Use case |
| --- | --- |
| npm package | `tileborne plugin add <spec>` |
| Local path | `tileborne plugin install --local ./my-plugin` |
| Git URL / tarball | CI and private registries |
| Dev symlink | Monorepo plugin development |

Installed plugins land in `~/.tileborne/plugins/<id>/` with lock metadata. Cloudflare deploy bundles the selected plugin at **`tileborne game build --target cloudflare --plugin <id>`** — see [Cloudflare deploy](/deploy/cloudflare/).

## Reference plugin

The OSS [`tileborne-plugins`](https://github.com/tileborne/tileborne-plugins) repository publishes **battle-royale**:

- Declarative editor contributions (palette, validators)
- Executable export and runtime systems
- Cloudflare bundle consumed by game-host smoke tests

```bash
tileborne plugin add battle-royale
tileborne plugin validate
```

## Permissions

Plugins declare `permissions` for filesystem roots, network, and IPC channels. Undeclared access is rejected at load time. All writes go through Tileborne services — plugins cannot silently escape allowed directories.

## Related reading

- [ADR-0001: Plugin UI model, declarative first](/adrs/0001-plugin-ui-model-declarative-first/)
- [ADR-0004: Cloudflare build-time plugin bundling](/adrs/0004-cloudflare-build-time-plugin-bundling/)
- [Security model](/security/)
- [Runtime SDK](/runtime/sdk/)

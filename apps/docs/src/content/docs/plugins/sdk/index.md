---
title: Plugin SDK
description: Exact manifest, contribution, executable entry, packaging, and installation contracts.
---

# Plugin SDK

Import public contracts from `@tileborne/plugin-api`. Use `PluginManifest` (also exported as `PluginManifestSchema`) to decode manifests; the implementation is `packages/plugin-api/src/manifest.ts`.

## Minimal valid manifest

```json
{
  "schemaVersion": 1,
  "id": "@tileborne-plugins/example-gameplay",
  "name": "@tileborne-plugins/example-gameplay",
  "version": "0.1.0",
  "displayName": "Example Gameplay",
  "description": "Example Tileborne plugin.",
  "author": "Example Studio",
  "license": "MIT",
  "engines": { "tileborne": "^0.1.0" },
  "entry": { "runtime": "./dist/runtime.js", "server": "./dist/server.js" },
  "contributes": {},
  "permissions": [],
  "dependsOn": []
}
```

The schema requires npm-style scoped plugin ids, a strict semantic version, and a Tileborne semver range. `repository`, `homepage`, `entry`, and `migrations` are optional. Manifests do not carry integrity metadata. Installation hashes the verified directory into `lock.json`; tarball installation can independently require an expected content hash.

## Declarative authoring

Prefer schema-driven contributions. Behavior blocks, templates, game settings forms, catalogs, HUD/input/audio declarations, and game-mode links remain serialized data and need no executable renderer UI. The renderer receives decoded IPC data and maps stable capability/icon ids through its own registries.

```json
{
  "contributes": {
    "behaviorEntries": [
      {
        "id": "example.enemy-defeated",
        "kind": "event",
        "label": "Enemy defeated",
        "category": "Example",
        "description": "Runs after an enemy is defeated.",
        "capability": "example.combat",
        "inputs": [],
        "outputs": []
      }
    ],
    "behaviorTemplates": [
      {
        "id": "example.next-wave",
        "label": "Next wave",
        "description": "Start a new wave.",
        "category": "Example",
        "requiredCapabilities": ["example.combat"],
        "when": { "entryId": "example.enemy-defeated", "arguments": {} },
        "do": []
      }
    ]
  }
}
```

## Executable entries

`PluginLoaderService.loadExecutable` verifies the installed directory and lock, contains the selected entry path, then imports it only in an allowed process. Its generic selection order is `entry.server`, then `entry.runtime`, then `entry.editor`; declare separate files when their contracts differ.

The shipped game-host bundle statically consumes the runtime entry's **named** `createRuntimeAdapter` export. The public worker-safe structural types live in `@tileborne/plugin-api`:

```ts
import type { CreateRuntimeAdapter, RuntimeAdapterHost } from '@tileborne/plugin-api';

interface ExampleHost extends RuntimeAdapterHost {
  readonly emit: (event: { readonly kind: string; readonly tick: number }) => void;
}

export const createRuntimeAdapter: CreateRuntimeAdapter<ExampleHost> = (host) => ({
  id: '@tileborne-plugins/example-gameplay',
  onInit(context, world) {
    world.registerComponent<{ readonly started: boolean }>('example.started');
    host.emit({ kind: `${context.pluginId}.started`, tick: 0 });
  },
  onTick(world, deltaSeconds, tick) {
    host.emit({ kind: 'example.tick', tick });
  },
});
```

Do not publish a default runtime object and expect the game host to discover it. Server validators/exporters use the named exports referenced by their owned contribution contracts. Cloudflare Ship bundles selected plugin modules at build time; Workers do not perform dynamic package discovery.

The repository's [runtime adapter example](https://github.com/tileborne/tileborne/blob/main/packages/plugin-api/examples/runtime-adapter.ts) is compiled by `@tileborne/plugin-api` typecheck. Its [manifest fixture](https://github.com/tileborne/tileborne/blob/main/packages/plugin-api/examples/tileborne-plugin.json) is decoded with the production `PluginManifest` and the adapter is executed by the package test suite.

Executable plugins are trusted code. Phase A blocks them in the renderer, validates paths/symlinks/integrity, and checks declared contribution contracts, but does not sandbox arbitrary main/CLI Node APIs. Keep renderer UX declarative and install only trusted executable plugins.

## Package and verify

```bash
pnpm --filter @tileborne/plugin-example-arena test
pnpm --filter @tileborne/plugin-example-arena build
tileborne plugin pack ./packages/plugin-example-arena --out dist/example-arena.tbpack
tileborne plugin install --tarball ./dist/example-arena.tbpack --integrity sha256:<64-hex-digest>
tileborne plugin verify @tileborne-plugins/example-arena
```

Local iteration can use `tileborne plugin install --dev-symlink <directory>` or the equivalent `tileborne plugin link <directory>`. Installed roots use `$TILEBORNE_HOME/plugins/<encodeURIComponent(id)>-<version>/` and contain `tileborne-plugin.json` plus computed `lock.json`.

## Release checklist

- Decode the exact manifest and every referenced contribution.
- Keep paths relative, traversal-free, and symlink-contained.
- Test missing, disabled, malformed, incompatible, and integrity-drift states.
- Export `createRuntimeAdapter` by name from the runtime entry.
- Keep neutral orchestration free of plugin-id branching.
- Run plugin unit tests, CLI install/verify, build/Ship, and copied-artifact execution.
- Document creator workflow, known limits, and version/migration policy.

## Related reading

- [Plugins](/plugins/)
- [Gameplay Behaviors](/gameplay-behaviors/)
- [API: @tileborne/plugin-api](/reference/plugin-api/)
- [API: @tileborne/game-sdk](/reference/game-sdk/)
- [Security model](/security/)
- [Battle Royale runtime adapter source](https://github.com/tileborne/tileborne/blob/main/packages/plugin-battle-royale/src/runtime-adapter.ts)

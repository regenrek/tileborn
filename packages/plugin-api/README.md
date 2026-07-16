# `@tileborne/plugin-api`

Public schemas and types for Tileborne plugin manifests, declarative contribution points, permissions, registries, game-mode contracts, and project content.

```ts
import { PluginManifest, resolveBehaviorAuthoringRegistry } from '@tileborne/plugin-api';
import { Schema } from 'effect';

const manifest = Schema.decodeUnknownSync(PluginManifest)(manifestJson);
const behaviorRegistry = resolveBehaviorAuthoringRegistry([
  { pluginId: manifest.id, contributions: manifest.contributes },
]);
```

The package does not load code or grant authority. `@tileborne/services-plugin` owns installation, containment, integrity locks, registry state, and trusted executable loading. Renderer consumers use decoded declarative data only. Runtime plugins selected for Ship export a named `createRuntimeAdapter`; project gameplay scripts instead use the isolated `@tileborne/game-sdk` behavior runtime.

The public worker-safe adapter interfaces are exported as `RuntimeAdapterHost`, `RuntimeAdapterWorld`, `RuntimeAdapter`, and `CreateRuntimeAdapter`. [The compile-checked example](./examples/runtime-adapter.ts) and its [decoded manifest fixture](./examples/tileborne-plugin.json) are exercised by the package test suite.

Manifest schema version 1 requires `schemaVersion`, scoped `id`, `name`, semantic `version`, `displayName`, `description`, `author`, `license`, `engines.tileborne`, `contributes`, `permissions`, and `dependsOn`. See the published [Plugin SDK](../../apps/docs/src/content/docs/plugins/sdk/index.md); the docs prebuild generates the `/reference/plugin-api/` API route from [the package exports](./src/index.ts).

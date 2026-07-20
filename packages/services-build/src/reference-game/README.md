# Battle Royale Reference Game

`@tileborne/services-build/reference-game/battle-royale` provides a checked-in bootstrap workflow for the Battle Royale reference game. It is intended for downstream smoke tests, release checks, and examples that need a complete project without hand-authoring transient fixtures.

The workflow:

1. Installs a Battle Royale plugin package through `PluginInstallerService` and `LocalPluginSource`.
2. Creates a deterministic, valid Battle Royale map with spawn points, a shrink-zone anchor, loot, and fast match-ending zone settings.
3. Imports the plugin's core asset pack.
4. Saves the project manifest with the Battle Royale plugin, startup map, asset pack, and local ship target.
5. Applies shell defaults and audio cue bindings from installed plugin runtime contributions through `applyInstalledPluginRuntimeDefaults`.
6. Authors a deterministic TypeScript behavior through `ProjectBehaviorService.createTypeScript` so builds ship non-empty behavior manifests and compiled modules.

Consumers call `bootstrapBattleRoyaleReferenceProject` inside `ServicesBuildLayer` after creating a project:

```ts
import { bootstrapBattleRoyaleReferenceProject } from '@tileborne/services-build/reference-game/battle-royale';

const reference =
  yield *
  bootstrapBattleRoyaleReferenceProject({
    pluginPackagePath,
    projectId,
    mapId,
  });
```

The returned `projectId`, `mapId`, `assetPackId`, `assetPackVersion`, and `behaviorId` are ready for `BuildService.buildGame`. The shell/audio hydration and authored behavior paths use public services, so tests and examples should not translate plugin manifest runtime contributions or patch behavior artifacts by hand.

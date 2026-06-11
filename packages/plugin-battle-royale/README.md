# @tileborne/plugin-battle-royale

Official Tileborne battle royale plugin (`@tileborne-plugins/battle-royale`).

## Gameplay loop (v0.1.0 target)

This package scaffolds the plugin surface that later P2 tasks build into a full
local-first battle royale loop:

- **Spawn** — perimeter spawn points authored on the map (minimum 4).
- **Movement** — deterministic player movement using shared runtime parity helpers (P2.3).
- **Combat** — projectile / weapon systems (P2.4+).
- **Shrink zone** — single authoritative `ZoneState` component; damage outside radius (P2.5–P2.6).
- **Loot** — tiered loot crates with pickup radius and table weights.
- **Win condition** — single `MatchWon` emission when one player remains (P2.6).

## Capabilities

| Capability | Entry / contribution |
| --- | --- |
| `runtime.adapter` | `entry.runtime` → `./dist/runtime.js` |
| `map.validate` | `validateMap` in `./dist/server.js` |
| `map.generate` | `generateMap` in `./dist/server.js` |
| `assets.metadata` | declarative asset pack + metadata indexes |

## Tunable gameplay constants

Canonical defaults live in `src/constants.ts` as grouped sub-objects:

| Group | Keys | Default | Used by |
| --- | --- | --- | --- |
| `MOVEMENT` | `speed` | `120` | Player movement (world units / sec) |
| | `radius` | `12` | Player collision circle |
| | `footprintOffsetY` | `0` | Vertical offset to collision center |
| | `tickRate` | `20` | Simulation tick rate (Hz) |
| `ZONE` | `damagePerSecond` | `5` | Outside-zone damage at init |
| | `schedule.waitSec` | `60` | Initial safe-zone wait |
| | `schedule.shrinkSec` | `30` | Shrink animation duration |
| | `schedule.holdSec` | `30` | Hold after each shrink |
| | `schedule.shrinkPhases` | `3` | Number of shrink phases |
| | `schedule.radiusFactor` | `0.5` | Radius multiplier per phase |
| `PROJECTILE` | `speed` | `400` | Projectile travel speed |
| | `damage` | `25` | Hit damage |
| | `ttlTicks` | `40` | Lifetime (~2s at 20Hz) |
| | `shootCooldownTicks` | `8` | Min ticks between shots |
| | `radius` | `4` | Projectile hit radius |
| `DAMAGE` | `playerHealth` | `100` | Spawn / respawn health |
| `RESPAWN` | `delayTicks` | `100` | Respawn delay when enabled (5s at 20Hz) |

## Per-room overrides

Runtime merges overrides in this order (later wins):

1. Package defaults (`constants.ts`)
2. Authored shrink schedule (zone anchor placement in the runtime map package)
3. `map.properties.battleRoyale` (read from the package map at boot)
4. `RuntimePluginHost.config` (room / host factory overrides)

### Map property path

Set on the map root:

```json
{
  "properties": {
    "battleRoyale": {
      "projectile": { "speed": 600 },
      "zone": { "damagePerSecOutside": 10 },
      "movement": { "speed": 140 }
    }
  }
}
```

### Host factory path

`createRuntimeAdapter` accepts a partial `BattleRoyaleConfig` Effect schema on `host.config`:

```typescript
createRuntimeAdapter({
  getMapPackage: () => mapPackage,
  config: {
    projectile: { speed: 600 },
    roomRules: { respawnEnabled: true },
  },
});
```

Schema and merge helpers are exported from `runtime-adapter.ts` (`BattleRoyaleConfig`, `resolveBattleRoyaleConfig`).

## Build

```bash
pnpm --filter @tileborne/plugin-battle-royale build
pnpm --filter @tileborne/plugin-battle-royale test
```

The built artifact lives beside `tileborne-plugin.json` under `packages/plugin-battle-royale/`.
Tileborne desktop and CLI resolve this workspace package before external repos or the smoke stub.

## License

MIT — see [LICENSE](./LICENSE).

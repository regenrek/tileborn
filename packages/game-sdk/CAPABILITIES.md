# Tileborne game SDK capabilities

This file is generated from `capabilities.registry.json`. Agents and tools can read the JSON inventory through the `@tileborne/game-sdk/capabilities.json` export.

| Capability           | Label                 | Purpose                                                                                | Built-in members                                                            |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `lifecycle.core`     | Behavior lifecycle    | Deterministic behavior start, stop, reload, and error lifecycle hooks.                 | `lifecycle.started`, `lifecycle.stopped`, `lifecycle.reloaded`              |
| `state.core`         | Behavior state        | Read and update the behavior's typed, serializable local state.                        | `state.set`                                                                 |
| `time.deterministic` | Deterministic time    | Simulation ticks, seeded random values, and tick-based timers without wall-clock APIs. | `runtime.tick`, `timer.fired`, `timer.after`, `timer.every`, `timer.cancel` |
| `shell.navigation`   | Game shell navigation | Typed game-shell events and shell-owned navigation actions.                            | `shell.event`, `shell.invoke-action`, `shell.emit-event`                    |

Plugins extend the open TypeScript registries through declaration merging. Their generated project declarations remain normal native TypeScript and do not introduce a language subset.

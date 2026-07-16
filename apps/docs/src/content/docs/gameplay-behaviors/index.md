---
title: Gameplay Behaviors
description: Visual WHEN/IF/DO and native TypeScript authoring on one deterministic runtime.
---

# Gameplay Behaviors

Tileborne has two first-class authoring surfaces and one execution model:

- Creators use the visual **WHEN / IF / DO** event editor.
- Developers and coding agents use normal TypeScript through `@tileborne/game-sdk`.
- Both compile to the same versioned `BehaviorModule`, execute in the same authoritative scheduler, and produce the same validated commands, state changes, events, diagnostics, and traces.

Visual definitions and TypeScript source are durable project resources. Generated JavaScript, source maps, and visual-to-TypeScript output are derived artifacts. A behavior has exactly one canonical source. Visual-to-TypeScript conversion is intentional and one-way; TypeScript is never presented as round-trippable visual data.

## Creator workflow

1. Open **Behaviors** and create a visual behavior from a Core or game-mode template.
2. Choose one typed **WHEN** event, zero or more **IF** conditions, and ordered **DO** actions. Pickers only offer references valid for the selected parameter kind.
3. Resolve errors in **Problems**. Missing references, unknown registry entries, missing capabilities, and schema incompatibilities block playtest and Ship without deleting the source.
4. Start playtest and open **Runtime** to inspect the event payload, active source/block, state, chosen branch, emitted actions, diagnostics, and the bounded per-instance trace. Pause, step, or continue without changing the project.
5. Save and reopen the project before shipping. A failed compile or hot reload keeps the last-known-good module running and links back to the owning source or block.

Use **Convert to TypeScript** only when the behavior needs ordinary TypeScript composition or developer tooling. Tileborne shows an irreversible-conversion warning, emits readable stable source, and atomically switches the canonical source after validation.

## Native TypeScript SDK

```ts
import { defineBehavior, refs } from '@tileborne/game-sdk';

export default defineBehavior({
  id: 'example.open-exit',
  state: { opened: false },
  refs: { exit: refs.entity<'door'>('object:exit') },
  requiredCapabilities: ['state.core'],
  on: {
    'lifecycle.started': ({ state }) => state.set('opened', true),
  },
});
```

This is native TypeScript, not a proprietary language or restricted dialect. Project-local modules, functions, types, generics, editor completion, and ordinary unit tests remain available. Gameplay receives only the typed deterministic context: state, queries/actions, simulation clock, seeded RNG, and tick timers. Node, Electron, DOM, network, environment, wall-clock, ambient randomness, dynamic code construction, and imports escaping the project root are rejected with stable `TBSDK` diagnostics.

Package reference surfaces:

- `@tileborne/game-sdk` — `defineBehavior`, typed context, references, commands, and test harness.
- `@tileborne/game-sdk/authoring` — source validator used by editor/build tooling.
- `@tileborne/game-sdk/capabilities` — generated built-in capability inventory.
- `@tileborne/game-sdk/capabilities.json` — machine-readable inventory for agents and tools.
- [`packages/game-sdk/examples/open-exit.ts`](https://github.com/tileborne/tileborne/blob/main/packages/game-sdk/examples/open-exit.ts) — core example.
- [`packages/game-sdk/examples/plugin-event.ts`](https://github.com/tileborne/tileborne/blob/main/packages/game-sdk/examples/plugin-event.ts) — declaration-merging example.

## Agent workflow

Agents should treat the schemas and generated inventories as the API, not scrape UI labels or invent registry ids:

1. Read `capabilities.json` and the active project/plugin behavior registry.
2. Inspect the owning event, condition, action, capability, parameter types, and reference kinds.
3. Create either a schema-valid visual `BehaviorDefinition` or native TypeScript using `defineBehavior`.
4. Run the authoring validator and relevant type tests before saving.
5. Run deterministic harness tests for TypeScript logic; assert commands and state, not wall time.
6. Use Problems and source/block diagnostics to repair errors. Never bypass trust, capability, or readiness failures.
7. During playtest, compare the authoritative trace and visible game result. Do not add client-side gameplay execution.

For machine edits, preserve behavior ids and source ownership, allocate new visual node ids, avoid hand-editing generated modules, and make visual-to-TypeScript conversion only through the owned conversion operation.

## Plugin behavior contributions

Plugins contribute JSON-only `behaviorEntries` and `behaviorTemplates` in `tileborne-plugin.json`. Entries are typed as `event`, `condition`, or `action`; each entry declares one capability and typed inputs/outputs. Templates declare every capability required by the blocks they invoke.

The effective registry is deterministic and fail-closed:

- Core entries load first; plugin sources and entries are sorted by stable id.
- Entry, template, and capability ids have one owner. Duplicate ids or cross-owner capability claims fail registration.
- A template cannot reference a missing/wrong-kind entry, unknown capability, or omit an invoked entry's capability.
- The renderer consumes decoded registry data and resolves safe icon names. It never imports or executes contribution code.

Battle Royale and the neutral Example Arena fixture prove this contract without a game-mode switch in neutral orchestration. Native TypeScript plugins extend `GameEventRegistry`, `GameActionRegistry`, `GameQueryRegistry`, and `GameCapabilityRegistry` with normal declaration merging; runtime implementations still require an explicitly approved host capability.

## Ownership and versioning

| Concern                                                        | Canonical owner             |
| -------------------------------------------------------------- | --------------------------- |
| Durable ids, definitions, registry metadata, package schemas   | `@tileborne/core`           |
| Public TypeScript API, validator, generated inventory, harness | `@tileborne/game-sdk`       |
| Plugin contribution decoding and deterministic projection      | `@tileborne/plugin-api`     |
| Visual/TypeScript compilation, conversion, hashes, source maps | `@tileborne/services-build` |
| Scheduler, budgets, state, traces, hot reload                  | `@tileborne/runtime`        |
| Isolated Node/Workerd execution                                | `apps/game-host`            |
| Project persistence and trust state                            | `@tileborne/services-app`   |
| Typed renderer transport                                       | `@tileborne/ipc-contracts`  |

`BehaviorDefinition`, behavior package, registry, outer runtime-map package, and runtime release versions evolve independently. Readers reject unknown future schema versions; migrations must be explicit, sequential, tested, and owned by the package that owns the durable schema. Capability and registry ids are public contracts: additions are backward-compatible, while removal or semantic reuse requires a major version and project migration. Shipped artifacts embed their runtime version and integrity hashes.

## Security and retention

Imported TypeScript starts as `imported-untrusted` and cannot compile or execute until the project is explicitly trusted. Trust does not grant ambient authority: static import/API validation and isolated execution still apply. Local playtest uses a resource-limited Node worker; authoritative and shipped hosts use a separate Workerd behavior service. Project code never executes in Electron renderer, preload, or main.

The scheduler caps handler time, state/memory, queue/recursion depth, actions, traces, and diagnostics. Supervisors terminate runaway workers and restore the last-known-good modules and state. Debug data stays project-local unless the user invokes an explicit export/publish path; collections and payload sizes are bounded, secret-like keys and host paths are redacted, and only the newest bounded trace/diagnostic window is retained in memory.

See [Security Model](/security/) for the adversarial-test matrix and exact process policy.

For a complete no-code game workflow, continue with the [Battle Royale Creator Guide](/battle-royale/creator-guide/).

## Deferred specialized graphs

V1 intentionally uses the accessible, ordered WHEN/IF/DO event-sheet model. A universal Blueprint-style free-form canvas is not part of this release. Future specialized dialogue, quest, state-machine, animation, or behavior-tree graphs must compile through the same registry, `BehaviorModule`, diagnostics, deterministic scheduler, isolation, and versioning contracts. They may add a purpose-built authoring projection; they may not create a second gameplay runtime, source of truth, or client-authoritative execution path.

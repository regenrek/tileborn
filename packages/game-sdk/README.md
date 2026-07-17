# `@tileborne/game-sdk`

The first-class native TypeScript authoring API for Tileborne gameplay behaviors. It is normal TypeScript: project-relative modules, functions, types, generics, and tests remain available. Safety and determinism are enforced at the SDK capability and build boundary rather than by inventing a proprietary language subset.

The supported authoring contract is the exported SDK and generated capability registry, not ambient
Node/Electron APIs. Game behaviors must not read release credentials, operator environments,
desktop project storage, or arbitrary network/filesystem state. Keep secrets outside project source;
project behaviors and shipped game artifacts are user content and may be inspected or shared.

```ts
import { defineBehavior, refs } from '@tileborne/game-sdk';

export default defineBehavior({
  id: 'example.open-exit',
  state: { opened: false, activations: 0 },
  refs: { exit: refs.entity<'door'>('object:exit') },
  requiredCapabilities: ['state.core', 'time.deterministic'],
  on: {
    'lifecycle.started': ({ event, state, clock, rng, timers }) => {
      const activation = state.set('activations', state.get('activations') + 1);
      const retry = timers.after(clock.ticksPerSecond, `retry-${rng.integer(1, 10)}`);
      return event.reason === 'initial' ? [activation, retry] : activation;
    },
  },
});
```

Projects and plugins add strongly typed events, actions, queries, and capabilities with standard declaration merging:

```ts
declare module '@tileborne/game-sdk' {
  interface GameEventRegistry {
    'world.player-entered-zone': { playerId: string; zoneId: string };
  }
  interface GameActionRegistry {
    'world.open-door': (doorId: string) => void;
  }
  interface GameQueryRegistry {
    'inventory.has-item': (playerId: string, itemId: string) => boolean;
  }
  interface GameCapabilityRegistry {
    'world.doors': true;
  }
}
```

`createBehaviorTestHarness` executes a handler with deterministic time and seeded random values and records its commands. Build tools use `@tileborne/game-sdk/authoring` to reject Node/Electron/DOM/network access, wall-clock time, ambient randomness, dynamic loading, and imports outside the project root with stable `TBSDKxxxx` diagnostics.

The machine-readable built-in inventory is exported as `@tileborne/game-sdk/capabilities.json`; generated human documentation lives in [CAPABILITIES.md](./CAPABILITIES.md).

## Supported workflow

- Read the generated capability inventory and active plugin registry; never invent event, action, query, or capability ids.
- Validate source through `@tileborne/game-sdk/authoring`, then typecheck and exercise deterministic logic with `createBehaviorTestHarness`.
- Assert emitted commands and state. Do not depend on wall time, network, filesystem, environment, or client-side execution.
- Treat visual-to-TypeScript conversion as one-way and edit the generated `.ts` source only after the conversion operation succeeds.

The core example is [examples/open-exit.ts](./examples/open-exit.ts); plugin declaration merging is demonstrated by [examples/plugin-event.ts](./examples/plugin-event.ts). The complete creator, developer, agent, plugin, ownership, versioning, security, and deferred-graph contract is published in the [Gameplay Behaviors guide](../../apps/docs/src/content/docs/gameplay-behaviors/index.md).

Capability availability does not imply desktop platform support. SDK behavior compilation,
playtest, and Ship evidence are separate from the signed desktop distribution decision. See the
[desktop release runbook](../../docs/desktop-release-runbook.md) for the current macOS arm64
candidate and explicit unsupported surfaces.

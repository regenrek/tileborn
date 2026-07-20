# Architecture Decisions

## ADR-001: Separate neutral multiplayer capability from game-mode rules

Status: proposed

Decision: Keep Battle Royale as a game-mode plugin. Move only reusable room,
participant, readiness, reconnect, authority, result, diagnostic, and metrics
contracts into neutral ownership and prove them with a second mode.

Consequences: Other multiplayer games reuse infrastructure without inheriting BR
rules. Migration requires hard boundary tests and preservation of current BR semantics.

## ADR-002: Declarative Game Shell with typed behavior integration

Status: proposed

Decision: Store screens/themes/actions as versioned project data. Core/runtime
owns navigation state and accessibility semantics. Existing visual/TypeScript
behaviors may consume/emit registered shell events but do not own routing.

Consequences: Non-programmers can compose common screens; plugin authors extend
events and defaults through typed registries; arbitrary scripted UI remains out of scope.

## ADR-003: Essential two-bus audio MVP

Status: proposed

Decision: Ship music/SFX classification, typed event bindings, basic volume/mute,
looping and overlap policy. Deterministic runtime emits commands; client playback
is an effect. Advanced mixing/spatial/DSP is deferred.

Consequences: Complete games gain necessary sound now without committing to a DAW architecture.

## ADR-004: Provider-neutral deployment with Alchemy first

Status: proposed

Decision: Ship one neutral deployment manifest/adapter contract. Implement Local
and Alchemy v2; prove Alchemy on Cloudflare. The adapter owns a committed Effect
stack, Cloudflare providers and remote state, provider-profile/OAuth authentication,
and multi-Worker/Durable-Object bindings. Contain Wrangler/provider details within
the adapter and leave AWS as a future adapter. Alchemy 0.93 and dynamic inline
deployment stacks are not supported compatibility paths.

Consequences: Creators can self-host now without core vendor lock-in. Real cloud
proof needs user-owned credentials and disposable-resource cleanup evidence.
Alchemy v2/Effect upgrades must be treated as an adapter boundary change and
verified for first-create, adoption/redeploy, remote-state, and cleanup semantics.

## ADR-005: License provenance is a Ship gate

Status: proposed

Decision: Every distributed asset must resolve to canonical provenance and an
allowed redistribution class; unknown/incompatible rights block Ship.

Consequences: Some historical samples may need removal/replacement, but releases
gain an auditable legal boundary rather than relying on filenames or convention.

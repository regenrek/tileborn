# ADR-0010: WebGPU postponed, WebGL2 default

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: rendering, pixi, webgl, webgpu

## Context

PixiJS supports both WebGL2 and WebGPU backends. Tileborne targets Electron desktop (Chromium) and Cloudflare-served browser clients. WebGPU offers future perf wins but adds adapter complexity, uneven support in older Electron baselines, and testing surface. v1 must prioritize stable tilemap editing and deterministic runtime rendering over bleeding-edge GPU APIs.

## Decision

**WebGL2 is the default rendering backend** for Pixi in v1 (editor viewport and runtime client). **WebGPU is postponed** to a post-v1 milestone. The `RendererAdapter` abstraction (ADR-0006) allows a future WebGPU backend without rewriting ECS or UI code.

## Options considered

- **A — WebGPU-first**: Best long-term perf; risky for Electron LTS channels and complicates CI smoke tests.
- **B — Dual-backend runtime with auto-detect in v1**: More code paths; doubles QA matrix for marginal v1 benefit.
- **C (chosen) — WebGL2 default, WebGPU deferred**: Matches Pixi’s mature WebGL2 tilemap path; aligns with “desktop-first v1” scope.

## Consequences

- Positive: Predictable rendering across editor and game client; simpler Pixi renderer smoke tests.
- Positive: WebGPU can be evaluated behind a feature flag once Electron baseline and Pixi WebGPU tilemap story mature.
- Negative: Some GPU-heavy effects may be capped on WebGL2 until WebGPU lands.
- Follow-up: Revisit when Electron minimum version and Pixi WebGPU + `@pixi/tilemap` support are confirmed; document in runtime perf notes.

## References

- `docs/01-spec.md` §11 (viewport rendering rules)
- [PixiJS](https://github.com/pixijs/pixijs)
- Related: [ADR-0006](./0006-runtime-renderer-abstraction-pixi-default.md)

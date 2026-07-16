# `@tileborne/test-fixtures`

Private workspace package of sample fixtures for tests, smoke suites, and documentation examples.

## Layout

```text
fixtures/
  maps/           # Minimal map JSON stubs
  asset-packs/    # tileborne-asset-pack.json + tiles/
  plugins/        # tileborne-plugin.json + dist/
  projects/       # tileborne-project.json stubs
  performance/    # Versioned, deterministic large-project recipes and budgets
```

Each fixture directory includes a `PROVENANCE.md` with source and license attribution.

## Usage

```ts
import { getFixturePath, listFixtures } from '@tileborne/test-fixtures';

const pluginRoot = getFixturePath('plugins', 'smoke-fixture');
const packRoot = getFixturePath('asset-packs', 'smoke-pack');
const categories = listFixtures('plugins');
```

The bundled sample asset pack is generated from the SDK Tiled source importer.

## Creator performance contract

`fixtures/performance/creator-v1/` is the canonical release-1.0 large-project
corpus. It commits a compact deterministic recipe rather than thousands of
repetitive generated records. `fixture.json` fixes the seed, ordering, counts,
and payload sizes; `budgets.json` fixes count/size/operation limits for startup,
reopen, 2,000+ assets, large behavior/reference sets, validation, incremental
save, playtest start, package, and Ship.

Consumers must load both files through `loadCreatorPerformanceContract()`. A
new corpus or incompatible measurement meaning requires a new directory and
schema version; do not mutate `creator-v1` to represent a different workload.
The loader is a closed schema: unknown keys, reordered/omitted flows or metrics,
and changes to a v1 metric's id, unit, limit, or value are rejected. Explanatory
rationales remain required non-empty text.
The v1 contract intentionally contains no wall-clock limits. CI enforcement and
native Electron timing calibration are owned by the follow-up hardening item
named in `measurementPolicy`.

### Metric semantics and owners

- `count` measures records at the named owner boundary, after deduplication.
- `bytes` measures UTF-8 bytes or final file bytes, never JavaScript heap
  estimates.
- `operations` counts completed named owner-boundary invocations or durable
  phase transitions. Harness setup and assertions are excluded.
- `exact` fixes corpus inputs and required workload operations so an
  under-processing harness fails. `max` is reserved for output, batching, and
  amplification ceilings. A future `min` may only describe an explicit output
  floor, never a fixed input total.
- A run must report every metric for its flow. Missing metrics are failures, not
  zeroes. Wall-clock milliseconds are not valid v1 metric units.

| Flow                       | Measurement owner                                                              |
| -------------------------- | ------------------------------------------------------------------------------ |
| startup, reopen            | `apps/desktop` Electron main/renderer lifecycle                                |
| asset-library-2000         | `@tileborne/services-app` asset library plus desktop paged/virtualized queries |
| large-behaviors-references | `@tileborne/services-app` behavior service plus desktop reference queries      |
| validation                 | application-service readiness/catalog/behavior validation                      |
| save                       | `packages/services-app/src/internal/project-revision-transaction.ts`           |
| playtest-start             | `@tileborne/services-build` `PlaytestService`                                  |
| package                    | `packages/services-build/src/map-package/assemble.ts`                          |
| ship                       | `@tileborne/services-build` `BuildService`                                     |

The follow-up enforcement harness may instrument those owners, but it must not
reinterpret a metric or silently substitute elapsed time. Any correction to a
v1 metric meaning creates a new contract version.

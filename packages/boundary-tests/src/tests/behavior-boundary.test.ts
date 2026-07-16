import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../lib/repo-root.js';
import { walkFiles } from '../lib/walk-files.js';

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('ADR-0031 canonical behavior boundaries', () => {
  it('keeps the durable behavior owner genre-neutral and platform-free', () => {
    const files = walkFiles({
      rootDir: path.join(repoRoot, 'packages/core/src/behavior'),
      extensions: ['.ts'],
    }).filter((file) => !file.endsWith('.test.ts'));
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

    expect(source).not.toMatch(
      /plugin-battle-royale|@tileborne-plugins\/|\belectron\b|from\s+["']node:/iu,
    );
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|node:vm/gu);
  });

  it('requires one typed behavior payload in the map package and loader', () => {
    const mapPackage = read('packages/core/src/map-package/index.ts');
    const loader = read('packages/runtime/src/map-package/loader.ts');

    expect(mapPackage).toContain('behaviors: RuntimeBehaviorPackage');
    expect(loader).toMatch(/behaviors:\s*["']behaviors\.json["']/u);
    expect(loader).toContain('RuntimeBehaviorPackage');
    expect(loader).not.toMatch(/eval\s*\(|new\s+Function\s*\(/u);
  });

  it('keeps compilation in services-build and execution in the canonical runtime owner', () => {
    const compiler = read('packages/services-build/src/behavior/compiler.ts');
    const servicesBuildIndex = read('packages/services-build/src/index.ts');
    const scheduler = read('packages/runtime/src/behavior/scheduler.ts');
    const supervisor = read('packages/runtime/src/behavior/worker-supervisor.ts');
    const workerEntry = read('apps/game-host/src/behavior/node/node-worker-entry.ts');
    const isolatedHost = read('apps/game-host/src/behavior/node/isolated-runtime-host.ts');
    const desktopExecutableFiles = walkFiles({
      rootDir: path.join(repoRoot, 'apps/desktop/src'),
      extensions: ['.ts', '.tsx'],
    });
    const desktopSource = desktopExecutableFiles
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(compiler).toContain('tileborne-restricted-gameplay-resolution');
    expect(compiler).toMatch(/platform:\s*["']neutral["']/u);
    expect(scheduler).toContain('class DeterministicBehaviorScheduler');
    expect(supervisor).toContain('timedOutWorker.terminate()');
    expect(workerEntry).toContain('new vm.SourceTextModule');
    expect(workerEntry).toContain('codeGeneration: { strings: false, wasm: false }');
    expect(workerEntry).toContain('loadBehaviorModuleNamespace');
    expect(workerEntry).toContain('new DeterministicBehaviorScheduler');
    expect(isolatedHost).toContain('new Worker(url');
    expect(isolatedHost).toContain('resourceLimits:');
    expect(isolatedHost).toContain('new BehaviorWorkerSupervisor');
    expect(isolatedHost).toContain('#restoreLastKnownGood');
    expect(servicesBuildIndex).not.toContain('isolated-runtime-host');
    expect(
      fs.existsSync(
        path.join(repoRoot, 'packages/services-build/src/behavior/node-worker-entry.ts'),
      ),
    ).toBe(false);
    expect(desktopSource).not.toMatch(
      /compileTypeScriptBehavior|compileVisualBehavior|DeterministicBehaviorScheduler|loadBehaviorModuleNamespace/u,
    );
    expect(`${scheduler}\n${supervisor}`).not.toMatch(
      /from\s+["']node:|\beval\s*\(|new\s+Function\s*\(/u,
    );
  });

  it('keeps plugin behavior registration declarative and renderer-free', () => {
    const registry = read('packages/plugin-api/src/behavior-registry.ts');
    const contributions = read('packages/plugin-api/src/contributions.ts');
    const rendererFiles = walkFiles({
      rootDir: path.join(repoRoot, 'apps/desktop/src/renderer'),
      extensions: ['.ts', '.tsx'],
    });
    const renderer = rendererFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

    expect(registry).toContain('resolveBehaviorAuthoringRegistry');
    expect(registry).toContain('claimCapability');
    expect(registry).toContain('does not require capability');
    expect(registry).not.toMatch(/from\s+["'](?:react|electron|node:)|\beval\s*\(|new\s+Function/u);
    expect(contributions).toContain('behaviorEntries:');
    expect(contributions).toContain('behaviorTemplates:');
    expect(renderer).not.toMatch(/from\s+["']@tileborne\/plugin-api\/src\/behavior-registry/u);
  });

  it('wires the runtime owner into desktop, authoritative rooms, and shipped workers', () => {
    const desktopHost = read('apps/desktop/src/main/playtest-runtime-host.ts');
    const room = read('apps/game-host/src/rooms/room-object.ts');
    const gameHostBehavior = read('apps/game-host/src/behavior-runtime.ts');
    const workerdBehavior = read('apps/game-host/src/behavior/workerd/service-worker.ts');
    const shipBuilder = read('apps/game-host/src/build/cloudflare.ts');

    expect(desktopHost).toContain('new NodeIsolatedBehaviorRuntimeHost');
    expect(desktopHost).toContain('stepPlaytestBehaviorRuntime');
    expect(room).toContain('createWorkerdBehaviorRuntimeClient');
    expect(room).toContain('this.behaviorRuntime?.step(storage.tick + 1)');
    expect(room).not.toContain('AuthoritativeBehaviorRuntimeHost');
    expect(gameHostBehavior).not.toContain('AuthoritativeBehaviorRuntimeHost');
    expect(gameHostBehavior).toContain('BEHAVIOR_RUNTIME service binding');
    expect(workerdBehavior).toContain('new AuthoritativeBehaviorRuntimeHost');
    expect(workerdBehavior).toContain('host.restore');
    expect(workerdBehavior).toContain('packaged.createNamespace()');
    expect(workerdBehavior).toContain('input.operation.targetBehaviorId');
    expect(shipBuilder).toContain('buildBundledBehaviorsSource');
    expect(shipBuilder).toContain('bundled-behaviors-stub');
    expect(shipBuilder).toContain('esbuildTransform(code');
    expect(shipBuilder).toMatch(/format:\s*["']iife["']/u);
    expect(shipBuilder).toContain('createNamespace: () =>');
    expect(shipBuilder).not.toContain('import * as ${importName}');
    expect(shipBuilder).toContain('behavior-worker.js');
    expect(shipBuilder).toContain('wrangler.behavior.toml');
  });

  it('records the rejected owners and canonical vocabulary reuse', () => {
    const adr = read('docs/adrs/0031-canonical-gameplay-behavior-authoring.md');

    expect(adr).toContain('will not create a custom textual DSL');
    expect(adr).toMatch(/will not\s+create a restricted TypeScript dialect/u);
    expect(adr).toContain('one scheduler');
    expect(adr).toContain('never execute in Electron renderer, preload, or main');
    expect(adr).toContain('Battle Royale cannot own');
    expect(adr).toContain('canonical `GameplayEvent` stream');
    expect(adr).toContain('existing `ReadinessDiagnostic` contract');
  });

  it('enforces the executable ADR-0029 GameplayEvent owner and hard cut', () => {
    const gameplayEvent = read('packages/ipc-contracts/src/contracts/gameplay-event.ts');
    const playtest = read('packages/ipc-contracts/src/contracts/playtest.ts');

    expect(gameplayEvent).toContain('export const GameplayEvent = Schema.Union');
    for (const tag of [
      'WeaponFired',
      'DamageApplied',
      'EntityDefeated',
      'ItemGranted',
      'ItemDropped',
      'ItemConsumed',
      'StatusApplied',
      'StatusExpired',
      'ZonePhaseChanged',
      'MatchPhaseChanged',
    ]) {
      expect(gameplayEvent).toMatch(new RegExp(`["']${tag}["']`, 'u'));
    }
    expect(playtest).toContain('gameplayEvents: Schema.Array(GameplayEvent)');
    expect(playtest).not.toMatch(/PlaytestRuntimeHudEvent|recentEvents/u);
  });
});

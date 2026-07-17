import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BehaviorDiagnostic,
  MapObject,
  gameObjectTypeIdForKey,
  hashJsonStable,
  makeLayerId,
  makeBehaviorId,
  makeBehaviorNodeId,
  makeMapId,
  makeObjectId,
  makeProjectId,
  makeTileborneMap,
} from '@tileborne/core';
import { ReadinessNavigationTarget, type ReadinessDiagnostic } from '@tileborne/ipc-contracts';
import type { BehaviorCompileDiagnostic } from '@tileborne/services-build';
import { PluginManifest } from '@tileborne/plugin-api';
import { describe, expect, it } from 'vitest';
import { materializePluginManifestInput, type InstalledPlugin } from '@tileborne/services-plugin';
import { DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS } from '@tileborne/plugin-battle-royale/player-models';
import { Option, Schema } from 'effect';

import {
  assertReadiness,
  assertExecutionReadiness,
  behaviorReadinessDiagnostics,
  mainExecutionPurpose,
  type MainExecutionEntryPoint,
  diagnosePlayerModelReference,
  loadPluginMapValidator,
  makeReadinessReport,
  readinessDiagnostic,
} from './readiness.js';

const projectId = makeProjectId('00000000-0000-4000-8000-000000000101');

const diagnostic = (severity: ReadinessDiagnostic['severity'], id: string): ReadinessDiagnostic =>
  readinessDiagnostic({
    id,
    code: id,
    severity,
    source: 'map',
    title: id,
    message: `${id} message`,
    projectId,
    navigation: new ReadinessNavigationTarget({ kind: 'map', projectId }),
  });

describe('canonical readiness report', () => {
  it('preserves visual block and TypeScript source deep links for behavior failures', () => {
    const behaviorId = makeBehaviorId('00000000-0000-4000-8000-000000000201');
    const nodeId = makeBehaviorNodeId('00000000-0000-4000-8000-000000000202');
    const visualPath = 'behaviors/sources/visual.behavior.json';
    const tsPath = '/project/behaviors/sources/script.ts';
    const projectIssues = [
      new BehaviorDiagnostic({
        id: 'reference',
        code: 'behavior.reference-missing',
        severity: 'error',
        title: 'Missing reference',
        message: 'Reference is missing.',
        behaviorId,
        sourceKind: 'visual',
        nodeId,
        path: visualPath,
      }),
      new BehaviorDiagnostic({
        id: 'version',
        code: 'behavior.version-unsupported',
        severity: 'error',
        title: 'Unsupported version',
        message: 'Upgrade the source.',
        behaviorId,
        sourceKind: 'typescript',
        path: tsPath,
      }),
    ];
    const compileIssues: BehaviorCompileDiagnostic[] = [
      {
        code: 'TBBUILD2101',
        severity: 'error',
        message: 'Unknown visual block.',
        fileName: visualPath,
        suggestion: 'Replace the block.',
        behaviorId,
        sourceKind: 'visual',
        nodeId,
        line: 12,
        column: 7,
      },
      {
        code: 'TBBUILD2201',
        severity: 'error',
        message: 'Capability unavailable.',
        fileName: visualPath,
        suggestion: 'Enable its plugin.',
        behaviorId,
        sourceKind: 'visual',
      },
      {
        code: 'TBSDK1001',
        severity: 'error',
        message: 'Import unavailable.',
        fileName: tsPath,
        suggestion: 'Use the gameplay SDK.',
        behaviorId,
        sourceKind: 'typescript',
      },
    ];

    const diagnostics = behaviorReadinessDiagnostics(projectId, projectIssues, compileIssues);
    const byCode = (code: string) => diagnostics.find((entry) => entry.code === code);
    expect(byCode('behavior.reference-missing')?.navigation).toMatchObject({
      kind: 'behavior',
      behaviorId,
      behaviorNodeId: nodeId,
      path: visualPath,
    });
    expect(byCode('TBBUILD2101')?.navigation).toMatchObject({
      kind: 'behavior',
      behaviorId,
      behaviorNodeId: nodeId,
      sourceKind: 'visual',
      path: visualPath,
      line: 12,
      column: 7,
    });
    expect(byCode('TBBUILD2101')).toMatchObject({
      behaviorId,
      behaviorNodeId: nodeId,
      sourceKind: 'visual',
      path: visualPath,
      line: 12,
      column: 7,
    });
    expect(byCode('TBBUILD2201')?.navigation).toMatchObject({
      kind: 'behavior',
      behaviorId,
      path: visualPath,
    });
    expect(byCode('behavior.version-unsupported')?.navigation).toMatchObject({
      kind: 'behavior',
      behaviorId,
      path: tsPath,
    });
    expect(byCode('TBSDK1001')?.navigation).toMatchObject({
      kind: 'behavior',
      behaviorId,
      sourceKind: 'typescript',
      path: tsPath,
    });
  });

  it('reports missing model refs, required clips, and referenced atlas assets', () => {
    const model = DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS[0]!;
    expect(diagnosePlayerModelReference(model, undefined)[0]?.code).toBe(
      'player-model.asset-missing',
    );
    expect(diagnosePlayerModelReference(model, { assets: [], placeables: [] })[0]?.path).toBe(
      `playerModels.${model.id}.ref.refId`,
    );

    const idleClip = String(model.clips.idle);
    const diagnostics = diagnosePlayerModelReference(model, {
      assets: [],
      placeables: [
        {
          id: model.ref.refId,
          clips: [{ id: idleClip, frames: [{ assetId: 'asset:missing' }] }],
        },
      ],
    });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'player-model.asset-missing',
          path: `playerModels.${model.id}.clips.idle`,
        }),
        expect.objectContaining({
          code: 'player-model.clip-missing',
          path: `playerModels.${model.id}.clips.shoot`,
        }),
      ]),
    );
  });

  it('sorts stable diagnostics by severity and blocks on errors', () => {
    const report = makeReadinessReport('playtest', [
      diagnostic('info', 'info'),
      diagnostic('warning', 'warning'),
      diagnostic('error', 'error'),
    ]);

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((entry) => entry.id)).toEqual(['error', 'warning', 'info']);
    expect(() => assertReadiness(report)).toThrow('Game is not ready for playtest: error message');
  });

  it('allows warnings and information without weakening the gate', () => {
    const report = makeReadinessReport('build', [
      diagnostic('warning', 'warning'),
      diagnostic('info', 'info'),
    ]);

    expect(report.ok).toBe(true);
    expect(() => assertReadiness(report)).not.toThrow();
  });

  it.each([
    ['builds:build', 'build'],
    ['ship:start', 'build'],
    ['playtest:start', 'playtest'],
    ['runtime:prepareLocalRoomArtifact', 'playtest'],
  ] satisfies readonly (readonly [MainExecutionEntryPoint, 'playtest' | 'build'])[])(
    'hard-gates main execution entry %s with %s readiness',
    (entryPoint, purpose) => {
      expect(mainExecutionPurpose(entryPoint)).toBe(purpose);
      const blocked = makeReadinessReport(purpose, [diagnostic('error', entryPoint)]);
      expect(() => assertExecutionReadiness(entryPoint, blocked)).toThrow('Game is not ready');
      expect(() =>
        assertExecutionReadiness(entryPoint, makeReadinessReport(purpose, [])),
      ).not.toThrow();
    },
  );

  it('executes the installed Battle Royale map validator for invalid and fixed maps', async () => {
    const rootPath = path.resolve('../../packages/plugin-battle-royale');
    const manifestPath = path.join(rootPath, 'tileborne-plugin.json');
    const manifestJson = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    const manifest = Schema.decodeUnknownSync(PluginManifest)(
      materializePluginManifestInput(manifestJson),
    );
    const rawManifest = manifestJson as {
      readonly id: InstalledPlugin['id'];
      readonly version: string;
    };
    const installedPlugin = {
      id: rawManifest.id,
      version: rawManifest.version,
      enabled: true,
      rootPath,
      manifestPath,
      manifest,
      integrity: hashJsonStable(manifestJson),
    } satisfies InstalledPlugin;
    await expect(loadPluginMapValidator(installedPlugin, undefined)).resolves.toBeUndefined();
    await expect(loadPluginMapValidator(installedPlugin, 'validate-mpa')).rejects.toThrow(
      /unknown server map validator validate-mpa/,
    );
    const validator = await loadPluginMapValidator(installedPlugin, 'validate-map');
    const layerId = makeLayerId('00000000-0000-4000-8000-000000000401');
    const object = (index: number, kind: string, x: number, y: number) =>
      new MapObject({
        id: makeObjectId(`00000000-0000-4000-8000-${String(402 + index).padStart(12, '0')}`),
        kind: gameObjectTypeIdForKey(kind),
        x,
        y,
        width: Option.none(),
        height: Option.none(),
        layerId,
        properties: {},
      });
    const validMap = makeTileborneMap({
      id: makeMapId('00000000-0000-4000-8000-000000000410'),
      width: 64,
      height: 64,
      tileWidth: 32,
      tileHeight: 32,
      objects: [
        object(0, 'spawn-point', 1, 1),
        object(1, 'spawn-point', 12, 1),
        object(2, 'spawn-point', 1, 12),
        object(3, 'spawn-point', 12, 12),
        object(4, 'shrink-zone-anchor', 32, 32),
        object(5, 'loot-crate', 10, 10),
      ],
    });
    const invalidMap = makeTileborneMap({
      id: validMap.id,
      width: validMap.size.width,
      height: validMap.size.height,
      tileWidth: validMap.tileSize.width,
      tileHeight: validMap.tileSize.height,
      objects: [],
    });

    expect(validator).toBeTypeOf('function');
    expect(validator!(invalidMap).ok).toBe(false);
    expect(validator!(invalidMap).issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('spawn-point'),
        expect.stringContaining('shrink-zone-anchor'),
        expect.stringContaining('loot-crate'),
      ]),
    );
    expect(validator!(validMap)).toEqual({ ok: true, issues: [] });
  }, 20_000);
});

import {
  BehaviorManifest,
  BehaviorRegistryManifest,
  ProjectId,
  makeBehaviorNodeId,
} from '@tileborne/core';
import type { ProjectBehaviorSnapshot } from '@tileborne/services-app';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileProjectBehaviorModule, compileProjectBehaviorPackage } from './project-package.js';

const UUID = '12345678-1234-4234-8234-123456789abc';
const projectId = Schema.decodeUnknownSync(ProjectId)(`project:${UUID}`);
const manifest = Schema.decodeUnknownSync(BehaviorManifest)({
  schemaVersion: 1,
  id: `behavior:${UUID}`,
  label: 'Award loot',
  source: {
    _tag: 'typescript',
    sourcePath: `behaviors/sources/${UUID}.ts`,
    exportName: 'default',
  },
  requiredCapabilities: [],
});
const registry = new BehaviorRegistryManifest({ schemaVersion: 1, entries: [] });

const snapshot = (trust: ProjectBehaviorSnapshot['trust']): ProjectBehaviorSnapshot => ({
  projectId,
  projectRoot: '/virtual/project',
  revision: 1,
  trust,
  resources: [
    {
      kind: 'typescript',
      manifest: manifest as ProjectBehaviorSnapshot['resources'][number]['manifest'] & {
        readonly source: Extract<typeof manifest.source, { readonly _tag: 'typescript' }>;
      },
      source: 'export default Object.freeze({ on: {} });\n',
    },
  ],
  useSites: [],
  diagnostics:
    trust === 'trusted'
      ? []
      : [
          {
            id: 'untrusted',
            code: 'behavior.project-untrusted',
            severity: 'error',
            title: 'Untrusted',
            message: 'Imported scripts are disabled.',
            behaviorId: manifest.id,
            sourceKind: 'typescript',
            path: manifest.source._tag === 'typescript' ? manifest.source.sourcePath : '',
          },
        ],
});

describe('compileProjectBehaviorPackage', () => {
  it('preserves project node locations and capability source ownership', async () => {
    const nodeId = makeBehaviorNodeId('00000000-0000-4000-8000-000000000203');
    const withReference = await compileProjectBehaviorPackage(
      {
        ...snapshot('trusted'),
        diagnostics: [
          {
            id: 'missing-reference',
            code: 'behavior.reference-missing',
            severity: 'error',
            title: 'Missing reference',
            message: 'Reference missing.',
            behaviorId: manifest.id,
            sourceKind: 'visual',
            nodeId,
            path: 'behaviors/sources/visual.behavior.json',
          },
        ],
      },
      registry,
    );
    expect(withReference.diagnostics[0]).toMatchObject({
      behaviorId: manifest.id,
      sourceKind: 'visual',
      nodeId,
      fileName: 'behaviors/sources/visual.behavior.json',
    });

    const capabilityManifest = Schema.decodeUnknownSync(BehaviorManifest)({
      ...Schema.encodeSync(BehaviorManifest)(manifest),
      requiredCapabilities: ['inventory.core'],
    });
    const withCapability = await compileProjectBehaviorPackage(
      {
        ...snapshot('trusted'),
        resources: [
          {
            kind: 'typescript',
            manifest:
              capabilityManifest as ProjectBehaviorSnapshot['resources'][number]['manifest'] & {
                readonly source: Extract<
                  typeof capabilityManifest.source,
                  { readonly _tag: 'typescript' }
                >;
              },
            source: 'export default Object.freeze({ on: {} });\n',
          },
        ],
      },
      registry,
    );
    expect(withCapability.diagnostics[0]).toMatchObject({
      code: 'TBBUILD2201',
      behaviorId: manifest.id,
      sourceKind: 'typescript',
      fileName: manifest.source._tag === 'typescript' ? manifest.source.sourcePath : '',
    });
  });

  it('emits the package and exact module payload from the canonical snapshot', async () => {
    const result = await compileProjectBehaviorPackage(snapshot('trusted'), registry);
    expect(result.ok).toBe(true);
    expect(result.behaviorPackage?.modules).toHaveLength(1);
    expect(result.modules?.[0]?.path).toBe(result.behaviorPackage?.modules[0]?.modulePath);
  });

  it('blocks imported TypeScript until the project is trusted', async () => {
    const result = await compileProjectBehaviorPackage(snapshot('imported-untrusted'), registry);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'behavior.project-untrusted' }),
    ]);
  });

  it('hot-compiles a valid target while an unrelated behavior remains broken', async () => {
    const brokenId = 'behavior:22345678-1234-4234-8234-123456789abc' as const;
    const brokenManifest = Schema.decodeUnknownSync(BehaviorManifest)({
      ...Schema.encodeSync(BehaviorManifest)(manifest),
      id: brokenId,
      label: 'Broken neighbor',
      source: {
        _tag: 'typescript',
        sourcePath: 'behaviors/sources/broken.ts',
        exportName: 'default',
      },
    });
    const twoBehaviors: ProjectBehaviorSnapshot = {
      ...snapshot('trusted'),
      resources: [
        ...snapshot('trusted').resources,
        {
          kind: 'typescript',
          manifest: brokenManifest as ProjectBehaviorSnapshot['resources'][number]['manifest'] & {
            readonly source: Extract<typeof brokenManifest.source, { readonly _tag: 'typescript' }>;
          },
          source: 'fetch("/nondeterministic"); export default Object.freeze({ on: {} });',
        },
      ],
    };

    const target = await compileProjectBehaviorModule(twoBehaviors, registry, manifest.id);
    expect(target.ok, JSON.stringify(target)).toBe(true);
    if (target.ok) expect(target.artifact.behaviorId).toBe(manifest.id);

    const broken = await compileProjectBehaviorModule(twoBehaviors, registry, brokenManifest.id);
    expect(broken.ok).toBe(false);
    if (!broken.ok)
      expect(broken.diagnostics).toEqual([
        expect.objectContaining({ behaviorId: brokenManifest.id, code: 'TBSDK1002' }),
      ]);
  });
});

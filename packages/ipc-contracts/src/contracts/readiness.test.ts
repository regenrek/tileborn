import { makeBehaviorId, makeBehaviorNodeId, makeMapId, makeProjectId } from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ReadinessCheckContract,
  ReadinessDiagnostic,
  ReadinessNavigationTarget,
  ReadinessReport,
} from './readiness.js';

const projectId = makeProjectId('00000000-0000-4000-8000-000000000301');
const mapId = makeMapId('00000000-0000-4000-8000-000000000302');
const behaviorId = makeBehaviorId('00000000-0000-4000-8000-000000000303');
const behaviorNodeId = makeBehaviorNodeId('00000000-0000-4000-8000-000000000304');

describe('readiness IPC contract', () => {
  it('round-trips stable diagnostics with navigation targets', () => {
    const request = Schema.decodeUnknownSync(ReadinessCheckContract.request)({
      projectId,
      mapId,
      purpose: 'playtest',
    });
    const response = Schema.decodeUnknownSync(ReadinessCheckContract.response)({
      report: new ReadinessReport({
        ok: false,
        purpose: 'playtest',
        diagnostics: [
          new ReadinessDiagnostic({
            id: `map:${mapId}:spawn-count`,
            code: 'game-mode.map-validation',
            severity: 'error',
            source: 'map',
            title: 'Missing spawn points',
            message: 'Expected four spawn points.',
            projectId,
            mapId,
            path: 'objects',
            navigation: new ReadinessNavigationTarget({
              kind: 'map',
              projectId,
              mapId,
              path: 'objects',
            }),
          }),
        ],
      }),
    });

    expect(request.purpose).toBe('playtest');
    expect(response.report.diagnostics[0]?.navigation?.kind).toBe('map');
  });

  it('reuses readiness diagnostics for actionable behavior problems', () => {
    const diagnostic = Schema.decodeUnknownSync(ReadinessDiagnostic)({
      id: `behavior:${behaviorId}:missing-capability`,
      code: 'behavior.missing-capability',
      severity: 'error',
      source: 'behavior',
      title: 'Behavior capability is unavailable',
      message: 'The behavior requires world.doors.',
      projectId,
      behaviorId,
      behaviorNodeId,
      sourceKind: 'visual',
      path: 'requiredCapabilities[0]',
      line: 17,
      column: 4,
      navigation: {
        kind: 'behavior',
        projectId,
        behaviorId,
        behaviorNodeId,
        sourceKind: 'visual',
        path: 'requiredCapabilities[0]',
        line: 17,
        column: 4,
      },
    });

    expect(diagnostic.navigation?.behaviorId).toBe(behaviorId);
    expect(diagnostic).toMatchObject({ behaviorId, behaviorNodeId, sourceKind: 'visual', line: 17, column: 4 });
    expect(diagnostic.navigation).toMatchObject({ behaviorId, behaviorNodeId, sourceKind: 'visual', line: 17, column: 4 });
  });
});

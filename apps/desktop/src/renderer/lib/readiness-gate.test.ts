import { makeProjectId, makeMapId } from '@tileborne/core';
import { ReadinessDiagnostic, ReadinessReport } from '@tileborne/ipc-contracts';
import { describe, expect, it } from 'vitest';

import {
  blockingReadinessDiagnostics,
  readinessGateMessage,
  readinessWarnings,
  rendererExecutionAction,
  type RendererExecutionEntryPoint,
} from './readiness-gate.js';

const projectId = makeProjectId('00000000-0000-4000-8000-000000000201');
const mapId = makeMapId('00000000-0000-4000-8000-000000000202');

const report = new ReadinessReport({
  ok: false,
  purpose: 'playtest',
  diagnostics: [
    new ReadinessDiagnostic({
      id: 'missing-spawns',
      code: 'game-mode.map-validation',
      severity: 'error',
      source: 'map',
      title: 'Missing spawns',
      message: 'Expected four spawn points.',
      projectId,
      mapId,
    }),
    new ReadinessDiagnostic({
      id: 'close-spawns',
      code: 'game-mode.map-validation',
      severity: 'warning',
      source: 'map',
      title: 'Close spawns',
      message: 'Spawn points are close.',
      projectId,
      mapId,
    }),
  ],
});

describe('readiness gate model', () => {
  it('uses only errors to block while preserving warnings', () => {
    expect(blockingReadinessDiagnostics(report)).toHaveLength(1);
    expect(readinessWarnings(report)).toHaveLength(1);
    expect(readinessGateMessage(report, 'playtest')).toBe('Fix 1 readiness error before playtest.');
  });

  it('does not treat a missing async report as ready', () => {
    expect(readinessGateMessage(undefined, 'build')).toBe(
      'Readiness is still being checked before build.',
    );
  });

  it.each([
    ['topbar.playtest.single', 'playtest'],
    ['topbar.playtest.host', 'playtest'],
    ['topbar.build', 'build'],
    ['command-palette.playtest', 'playtest'],
    ['command-palette.build', 'build'],
  ] satisfies readonly (readonly [RendererExecutionEntryPoint, 'playtest' | 'build'])[])(
    'routes %s through the %s readiness gate',
    (entryPoint, action) => {
      expect(rendererExecutionAction(entryPoint)).toBe(action);
      expect(readinessGateMessage(report, rendererExecutionAction(entryPoint))).toContain('Fix 1');
    },
  );
});

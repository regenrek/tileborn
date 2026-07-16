import { ReadinessDiagnostic, ReadinessReport } from '@tileborne/ipc-contracts';
import { makeProjectId } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import { buildCreatorReadinessChecklist } from './creator-readiness-checklist';

describe('creator readiness checklist', () => {
  it('derives checklist state from the canonical readiness report', () => {
    const projectId = makeProjectId('00000000-0000-4000-8000-000000000901');
    const report = new ReadinessReport({
      ok: false,
      purpose: 'authoring',
      diagnostics: [
        new ReadinessDiagnostic({
          id: 'map-error',
          code: 'map.error',
          severity: 'error',
          source: 'map',
          title: 'Map',
          message: 'Fix map',
          projectId,
        }),
        new ReadinessDiagnostic({
          id: 'asset-warning',
          code: 'asset.warning',
          severity: 'warning',
          source: 'asset',
          title: 'Asset',
          message: 'Check asset',
          projectId,
        }),
      ],
    });
    const checklist = buildCreatorReadinessChecklist(report, [
      { id: 'spawn-layout', label: 'Spawn layout', sources: ['map', 'game-mode'] },
    ]);
    expect(checklist.find((entry) => entry.id === 'world')?.status).toBe('blocked');
    expect(checklist.find((entry) => entry.id === 'visuals')?.status).toBe('warning');
    expect(checklist.find((entry) => entry.id === 'ready')?.status).toBe('blocked');
    expect(checklist.find((entry) => entry.id === 'mode-fact:spawn-layout')?.status).toBe(
      'blocked',
    );
  });
});

import { validatePlayerModelRef, type PlayerModelRef } from '@tileborne/core';

import type { ResolvedPlayerModelPolicy } from '@/lib/player-model-policy';

export type VisualModelDiagnosticSeverity = 'error' | 'warning';

export type VisualModelDiagnosticCode =
  | 'player-model.policy-missing'
  | 'player-model.model-missing'
  | 'player-model.invalid-ref'
  | 'player-model.clip-missing'
  | 'player-model.placeholder';

export interface VisualModelDiagnostic {
  readonly severity: VisualModelDiagnosticSeverity;
  readonly code: VisualModelDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly modelId?: string | undefined;
}

const missingClipDiagnostics = (
  model: PlayerModelRef,
  requiredClipKeys: readonly string[],
): readonly VisualModelDiagnostic[] =>
  requiredClipKeys.flatMap((key): readonly VisualModelDiagnostic[] => {
    const clip = model.clips[key as keyof PlayerModelRef['clips']];
    return clip === undefined || String(clip).trim().length === 0
      ? [
          {
            severity: 'error',
            code: 'player-model.clip-missing',
            message: `${model.label} is missing the ${key} clip binding.`,
            path: `playerModels.${model.id}.clips.${key}`,
            modelId: model.id,
          },
        ]
      : [];
  });

export const diagnosePlayerModelPolicy = (
  policy: ResolvedPlayerModelPolicy | undefined,
): readonly VisualModelDiagnostic[] => {
  if (policy === undefined) {
    return [
      {
        severity: 'error',
        code: 'player-model.policy-missing',
        message: 'No player-model policy is active for the enabled plugins.',
        path: 'playerModels',
      },
    ];
  }
  const diagnostics: VisualModelDiagnostic[] = [];
  const placeholderModelIds = new Set(policy.placeholderModelIds);
  if (policy.models.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'player-model.model-missing',
      message: 'The active player-model policy has no playable models.',
      path: 'playerModels',
    });
  }
  for (const model of policy.models) {
    if (placeholderModelIds.has(model.id)) {
      diagnostics.push({
        severity: 'warning',
        code: 'player-model.placeholder',
        message: `${model.label} uses a deprecated placeholder model id.`,
        path: `playerModels.${model.id}`,
        modelId: model.id,
      });
    }
    for (const issue of validatePlayerModelRef(model)) {
      diagnostics.push({
        severity: 'error',
        code: 'player-model.invalid-ref',
        message: issue.message,
        path: `playerModels.${model.id}.${issue.path}`,
        modelId: model.id,
      });
    }
    diagnostics.push(...missingClipDiagnostics(model, policy.requiredClipKeys ?? []));
  }
  return diagnostics;
};

export const diagnoseVisualModelAuthoring = ({
  playerModelPolicy,
}: {
  readonly playerModelPolicy: ResolvedPlayerModelPolicy | undefined;
}): readonly VisualModelDiagnostic[] => [...diagnosePlayerModelPolicy(playerModelPolicy)];

export const hasBlockingVisualModelDiagnostics = (
  diagnostics: readonly VisualModelDiagnostic[],
): boolean => diagnostics.some((diagnostic) => diagnostic.severity === 'error');

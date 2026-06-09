import {
  validatePlayerModelRef,
  validateVisualAssetRoleRef,
  type PlayerModelRef,
  type VisualAssetRoleRef,
} from '@tileborne/core';

import type { ResolvedPlayerModelPolicy } from '@/lib/player-model-policy';
import type {
  ResolvedVisualRolePolicy,
  VisualRoleDefinition,
} from '@/lib/visual-role-policy';

export type VisualModelDiagnosticSeverity = 'error' | 'warning';

export type VisualModelDiagnosticCode =
  | 'visual-role.policy-missing'
  | 'visual-role.role-missing'
  | 'visual-role.invalid-ref'
  | 'visual-role.anchor-missing'
  | 'visual-role.placeholder'
  | 'visual-role.weapon-muzzle-overlap'
  | 'visual-role.weapon-muzzle-behind-hand'
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
  readonly roleKind?: string | undefined;
  readonly roleId?: string | undefined;
  readonly modelId?: string | undefined;
}

const roleKindKey = (role: VisualAssetRoleRef | VisualRoleDefinition): string =>
  String('roleKind' in role ? role.roleKind : role.kind);

const roleByKind = (
  roles: readonly VisualAssetRoleRef[],
): ReadonlyMap<string, VisualAssetRoleRef> =>
  new Map(roles.map((role) => [roleKindKey(role), role]));

const normalizedPointDistance = (
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number => Math.hypot(left.x - right.x, left.y - right.y);

export const diagnoseVisualRolePolicy = (
  policy: ResolvedVisualRolePolicy | undefined,
): readonly VisualModelDiagnostic[] => {
  if (policy === undefined) {
    return [
      {
        severity: 'error',
        code: 'visual-role.policy-missing',
        message: 'No visual-role policy is active for the enabled plugins.',
        path: 'visualRoles',
      },
    ];
  }
  const diagnostics: VisualModelDiagnostic[] = [];
  const roles = roleByKind(policy.roles);
  const placeholderRoleIds = new Set(policy.placeholderRoleIds);

  for (const definition of policy.roleDefinitions) {
    const kind = roleKindKey(definition);
    const role = roles.get(kind);
    if (role === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'visual-role.role-missing',
        message: `${definition.label} is required but has no visual role assignment.`,
        path: `visualRoles.${kind}`,
        roleKind: kind,
      });
      continue;
    }
    if (placeholderRoleIds.has(role.id)) {
      diagnostics.push({
        severity: 'warning',
        code: 'visual-role.placeholder',
        message: `${definition.label} uses a placeholder visual role.`,
        path: `visualRoles.${kind}`,
        roleKind: kind,
        roleId: role.id,
      });
    }
    for (const issue of validateVisualAssetRoleRef(role)) {
      diagnostics.push({
        severity: 'error',
        code: 'visual-role.invalid-ref',
        message: issue.message,
        path: `visualRoles.${kind}.${issue.path}`,
        roleKind: kind,
        roleId: role.id,
      });
    }
    for (const requirement of definition.requiredAnchors ?? []) {
      const anchor = role.anchors[requirement.id];
      if (anchor === undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'visual-role.anchor-missing',
          message: `${definition.label} is missing the ${requirement.label} anchor.`,
          path: `visualRoles.${kind}.anchors.${requirement.id}`,
          roleKind: kind,
          roleId: role.id,
        });
      }
    }
    if (definition.previewScenario === 'weapon-attachment') {
      const hand = role.anchors.hand;
      const muzzle = role.anchors.muzzle;
      if (hand !== undefined && muzzle !== undefined) {
        if (normalizedPointDistance(hand.point, muzzle.point) < 0.04) {
          diagnostics.push({
            severity: 'warning',
            code: 'visual-role.weapon-muzzle-overlap',
            message: `${definition.label} hand and muzzle anchors are nearly identical.`,
            path: `visualRoles.${kind}.anchors.muzzle`,
            roleKind: kind,
            roleId: role.id,
          });
        }
        if (muzzle.point.x <= hand.point.x) {
          diagnostics.push({
            severity: 'warning',
            code: 'visual-role.weapon-muzzle-behind-hand',
            message: `${definition.label} muzzle anchor is not in front of the hand anchor.`,
            path: `visualRoles.${kind}.anchors.muzzle`,
            roleKind: kind,
            roleId: role.id,
          });
        }
      }
    }
  }

  return diagnostics;
};

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
  visualPolicy,
  playerModelPolicy,
}: {
  readonly visualPolicy: ResolvedVisualRolePolicy | undefined;
  readonly playerModelPolicy: ResolvedPlayerModelPolicy | undefined;
}): readonly VisualModelDiagnostic[] => [
  ...diagnoseVisualRolePolicy(visualPolicy),
  ...diagnosePlayerModelPolicy(playerModelPolicy),
];

export const hasBlockingVisualModelDiagnostics = (
  diagnostics: readonly VisualModelDiagnostic[],
): boolean => diagnostics.some((diagnostic) => diagnostic.severity === 'error');

import type { ProjectManifest, VisualAssetRoleRef, VisualRoleKind } from '@tileborne/core';

export interface VisualRolePolicyContext {
  readonly project?: ProjectManifest | undefined;
}

export type VisualRoleAnchorKind = 'pivot' | 'hand' | 'muzzle' | 'anchor';

export interface VisualRoleAnchorRequirement {
  readonly id: string;
  readonly label: string;
  readonly kind: VisualRoleAnchorKind;
}

export interface VisualRoleDefinition {
  readonly kind: VisualRoleKind;
  readonly label: string;
  readonly requiredAnchors?: readonly VisualRoleAnchorRequirement[] | undefined;
  readonly previewScenario?: string | undefined;
}

export interface VisualRolePolicyContribution {
  readonly pluginId: string;
  readonly roleDefinitions?: readonly VisualRoleDefinition[] | undefined;
  readonly placeholderRoleIds?: readonly string[] | undefined;
  readonly resolveRoles: (context: VisualRolePolicyContext) => readonly VisualAssetRoleRef[];
}

export interface ResolvedVisualRolePolicy {
  readonly pluginId: string;
  readonly roleDefinitions: readonly VisualRoleDefinition[];
  readonly placeholderRoleIds: readonly string[];
  readonly roles: readonly VisualAssetRoleRef[];
}

const definitionsFromRoles = (
  roles: readonly VisualAssetRoleRef[],
): readonly VisualRoleDefinition[] =>
  roles.map((role) => ({ kind: role.roleKind, label: role.label }));

export const resolveVisualRolePolicy = (
  enabledPluginIds: Iterable<string>,
  contributions: readonly VisualRolePolicyContribution[],
  context: VisualRolePolicyContext,
): ResolvedVisualRolePolicy | undefined => {
  const enabled = new Set(enabledPluginIds);
  const contribution = contributions.find((entry) => enabled.has(entry.pluginId));
  if (contribution === undefined) {
    return undefined;
  }
  const roles = contribution.resolveRoles(context);
  return {
    pluginId: contribution.pluginId,
    roleDefinitions: contribution.roleDefinitions ?? definitionsFromRoles(roles),
    placeholderRoleIds: contribution.placeholderRoleIds ?? [],
    roles,
  };
};

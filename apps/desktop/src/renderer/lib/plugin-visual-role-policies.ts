import { BATTLE_ROYALE_VISUAL_ROLE_POLICY } from '@tileborne/plugin-battle-royale/visual-roles';

import type { VisualRolePolicyContribution } from '@/lib/visual-role-policy';

export const PLUGIN_VISUAL_ROLE_POLICIES: readonly VisualRolePolicyContribution[] = [
  BATTLE_ROYALE_VISUAL_ROLE_POLICY,
];
